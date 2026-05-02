import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { ServiceUnavailableError } from '../../common/errors';

export interface SpendLimit {
  currency: string;
  maxPerTransaction?: number;
  maxPerDay?: number;
  maxPerMonth?: number;
}

export interface SpendCheckResult {
  allowed: boolean;
  remainingDay: number;
  remainingMonth: number;
}

const REDIS_DAY_TTL_SECONDS = 60 * 60 * 24 * 2; // 2 days
const REDIS_MONTH_TTL_SECONDS = 60 * 60 * 24 * 35; // 35 days
const REDIS_REHYDRATE_TTL_SECONDS = 60; // sticky DB-aggregate cache

@Injectable()
export class SpendGuardService {
  private readonly logger = new Logger(SpendGuardService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Verify the supplied amount fits within per-tx / per-day / per-month limits.
   *
   * **Fail-closed semantics** (audit ae59f056 fixed F-1/F-2):
   *
   * `redis.get` returns null in two indistinguishable cases — key absent
   * (no spend yet today) and Redis outage. The previous implementation
   * collapsed both to "0 spent", which means a single Redis flap caused
   * spend caps to disappear entirely. We now rehydrate the day/month
   * totals from Postgres `SpendRecord` on every cache miss (paying ~1
   * extra DB query for correctness) and cache the result back to Redis
   * with a short TTL.
   *
   * If Postgres also fails, we throw `ServiceUnavailableError` — verify
   * then denies the request, which is the only safe behavior under
   * unknown spend state.
   */
  async check(
    agentId: string,
    policyId: string,
    amount: number,
    _currency: string,
    limit: SpendLimit,
  ): Promise<SpendCheckResult> {
    if (limit.maxPerTransaction !== undefined && amount > limit.maxPerTransaction) {
      return { allowed: false, remainingDay: 0, remainingMonth: 0 };
    }

    const { dateKey, monthKey } = todayKeys();
    const dayCacheKey = `spend:day:${agentId}:${policyId}:${dateKey}`;
    const monthCacheKey = `spend:month:${agentId}:${policyId}:${monthKey}`;

    const [dayRaw, monthRaw] = await Promise.all([
      this.redis.get<number>(dayCacheKey),
      this.redis.get<number>(monthCacheKey),
    ]);

    let daySpend = dayRaw;
    let monthSpend = monthRaw;

    // Redis miss → fall back to durable aggregate. Source of truth for
    // spend totals is Postgres, not Redis.
    if (daySpend === null || monthSpend === null) {
      const [dayAgg, monthAgg] = await Promise.all([
        daySpend === null
          ? this.prisma.spendRecord.aggregate({
              where: { agentId, policyId, dateKey },
              _sum: { amount: true },
            })
          : null,
        monthSpend === null
          ? this.prisma.spendRecord.aggregate({
              where: { agentId, policyId, monthKey },
              _sum: { amount: true },
            })
          : null,
      ]).catch((err: unknown) => {
        // Both Redis AND Postgres are down. Fail closed — verify denies.
        this.logger.error(
          `Spend rehydrate failed agent=${agentId} policy=${policyId}: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableError(
          'Spend store unavailable; cannot evaluate limit.',
          { cause: err },
        );
      });

      if (dayAgg) {
        daySpend = Number(dayAgg._sum.amount ?? 0);
        // Best-effort cache rehydrate; not awaited because verify hot path.
        this.redis
          .set(dayCacheKey, daySpend, REDIS_REHYDRATE_TTL_SECONDS)
          .catch((err: unknown) =>
            this.logger.warn(`Redis day cache rehydrate failed: ${(err as Error).message}`),
          );
      }
      if (monthAgg) {
        monthSpend = Number(monthAgg._sum.amount ?? 0);
        this.redis
          .set(monthCacheKey, monthSpend, REDIS_REHYDRATE_TTL_SECONDS)
          .catch((err: unknown) =>
            this.logger.warn(`Redis month cache rehydrate failed: ${(err as Error).message}`),
          );
      }
    }

    // After rehydrate path, both must be numbers. Anything else is a bug.
    if (daySpend === null || monthSpend === null) {
      throw new ServiceUnavailableError('Spend rehydrate produced null totals.');
    }

    const dayCap = limit.maxPerDay ?? Number.POSITIVE_INFINITY;
    const monthCap = limit.maxPerMonth ?? Number.POSITIVE_INFINITY;

    const wouldExceedDay = daySpend + amount > dayCap;
    const wouldExceedMonth = monthSpend + amount > monthCap;

    if (wouldExceedDay || wouldExceedMonth) {
      return {
        allowed: false,
        remainingDay: Math.max(0, dayCap - daySpend),
        remainingMonth: Math.max(0, monthCap - monthSpend),
      };
    }

    return {
      allowed: true,
      remainingDay: Math.max(0, dayCap - daySpend - amount),
      remainingMonth: Math.max(0, monthCap - monthSpend - amount),
    };
  }

  /**
   * Record an approved spend.
   *
   * **Postgres is source of truth** (audit ae59f056 fixed F-3): we write
   * the durable record FIRST, then increment Redis. If the Postgres
   * write fails, we throw and the caller can decide what to do (verify's
   * current contract is fire-and-forget, which is acceptable so long as
   * approved verifies are *also* enqueued to the BATE pipeline so the
   * outbox eventually consistency-repairs anything Postgres dropped).
   *
   * If the Postgres write succeeds and the Redis increment fails, we log
   * loudly and return — the next verify will rehydrate from Postgres.
   */
  async recordSpend(
    agentId: string,
    policyId: string,
    amount: number,
    currency: string,
    merchantId?: string,
    domain?: string,
  ): Promise<void> {
    const { dateKey, monthKey } = todayKeys();

    // 1. Durable write first.
    await this.prisma.spendRecord.create({
      data: { agentId, policyId, amount, currency, merchantId, domain, dateKey, monthKey },
    });

    // 2. Counter increments — best-effort. Postgres aggregate is canonical.
    const dayCacheKey = `spend:day:${agentId}:${policyId}:${dateKey}`;
    const monthCacheKey = `spend:month:${agentId}:${policyId}:${monthKey}`;
    const [dayResult, monthResult] = await Promise.allSettled([
      this.redis.incrBy(dayCacheKey, amount, REDIS_DAY_TTL_SECONDS),
      this.redis.incrBy(monthCacheKey, amount, REDIS_MONTH_TTL_SECONDS),
    ]);
    if (dayResult.status === 'rejected') {
      this.logger.warn(`Redis day counter increment failed: ${String(dayResult.reason)}`);
    }
    if (monthResult.status === 'rejected') {
      this.logger.warn(`Redis month counter increment failed: ${String(monthResult.reason)}`);
    }
  }
}

function todayKeys(): { dateKey: string; monthKey: string } {
  const iso = new Date().toISOString();
  return {
    dateKey: iso.slice(0, 10),
    monthKey: iso.slice(0, 7),
  };
}
