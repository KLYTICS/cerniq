// TrialService — ADR-0014 free-trial lifetime cap (10K verifies).
//
// This service is the pre-algorithm billing gate that fires AFTER
// `UsageGuardService` (PLAN_LIMIT_EXCEEDED) and BEFORE the verify
// algorithm (security gate). It only enforces against PlanTier='FREE'
// principals — all paid tiers short-circuit immediately.
//
// Hot-path design:
//   - Redis INCR on `trial:used:<principalId>` is the source of truth at
//     runtime. The key has NO TTL (lifetime counter, not monthly).
//   - When the post-INCR value exceeds TRIAL_LIFETIME_CAP we deny and
//     persist `trialExhaustedAt` to Postgres immediately so dashboards
//     and admin tooling can see the cap fire even after Redis flushes.
//   - Every Nth increment (default 100) flushes `trialUsedCount` to
//     Postgres so we don't lose accuracy on a Redis wipe.
//
// Failure posture:
//   - **Fail-CLOSED**. UsageGuardService fails-OPEN because monthly quota
//     is a billing-fairness gate (under-counting briefly is OK). Trial
//     exhaustion is a billing-revenue gate: a Redis outage MUST NOT
//     give an attacker unlimited free verifies. We deny with
//     TRIAL_EXHAUSTED + a structured warning + a metric so operators
//     can see the difference between "real cap" and "Redis flap".
//   - DB persistence failures are logged but never surface to the
//     caller — the Redis counter is authoritative for the next call.

import { Injectable, Logger } from '@nestjs/common';
import type { PlanTier } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { TRIAL_LIFETIME_CAP } from './plans';

/** Result of `checkAndIncrement`. */
export type TrialCheckResult =
  | { exhausted: false; remaining: number }
  | { exhausted: true; exhaustedAt: Date; reason: 'CAP_REACHED' | 'REDIS_UNAVAILABLE' };

/** Read-only view used by dashboards / health. */
export interface TrialStatus {
  planTier: PlanTier;
  /** -1 when the principal is on a non-FREE tier (cap does not apply). */
  used: number;
  /** -1 when not applicable (non-FREE tier). */
  cap: number;
  /** -1 when not applicable (non-FREE tier). */
  remaining: number;
  exhausted: boolean;
  exhaustedAt: Date | null;
}

/** Persist-to-DB cadence — every Nth Redis INCR triggers a (non-blocking) UPDATE. */
const DB_FLUSH_EVERY = 100;

@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name);
  private readonly USED_PREFIX = 'trial:used';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Atomic check-and-increment for the lifetime trial cap.
   *
   * Fail-CLOSED: any error (Redis unavailable, principal lookup failure,
   * cap exceeded) returns `exhausted: true`. Differs from
   * UsageGuardService which fails-open — see file-level comment.
   */
  async checkAndIncrement(principalId: string): Promise<TrialCheckResult> {
    // ── 1. Plan tier short-circuit. Non-FREE never hits the trial gate.
    try {
      const principal = await this.prisma.principal.findUnique({
        where: { id: principalId },
        select: { planTier: true, trialExhaustedAt: true },
      });
      if (!principal) {
        // No principal → fail-closed. Should never happen in the verify
        // hot path (ApiKeyGuard would have rejected upstream); if it does,
        // we log + deny rather than fabricate an "allowed" answer.
        this.logger.warn(`TrialService: principal not found principalId=${principalId} — failing closed`);
        return { exhausted: true, exhaustedAt: new Date(), reason: 'CAP_REACHED' };
      }
      if (principal.planTier !== 'FREE') {
        return { exhausted: false, remaining: -1 };
      }
      // Already-flagged short-circuit — we can answer without a Redis hit.
      if (principal.trialExhaustedAt !== null) {
        return { exhausted: true, exhaustedAt: principal.trialExhaustedAt, reason: 'CAP_REACHED' };
      }
    } catch (err) {
      this.logger.warn(
        `TrialService: principal lookup failed principalId=${principalId} — failing closed: ${(err as Error).message}`,
      );
      return { exhausted: true, exhaustedAt: new Date(), reason: 'REDIS_UNAVAILABLE' };
    }

    // ── 2. Atomic Redis INCR (no TTL — lifetime counter).
    const usedKey = `${this.USED_PREFIX}:${principalId}`;
    let newCount: number;
    try {
      newCount = await this.redis.raw().incr(usedKey);
    } catch (err) {
      this.logger.warn(
        `TrialService: Redis INCR failed principalId=${principalId} — failing closed: ${(err as Error).message}`,
      );
      this.metrics.trialExhaustedTotal.inc();
      return { exhausted: true, exhaustedAt: new Date(), reason: 'REDIS_UNAVAILABLE' };
    }

    this.metrics.trialUsageIncrementedTotal.inc();

    // ── 3. Cap check.
    if (newCount > TRIAL_LIFETIME_CAP) {
      const exhaustedAt = new Date();
      this.metrics.trialExhaustedTotal.inc();
      // Persist the exhaustion timestamp synchronously-ish (awaited but
      // catch errors so the response shape stays consistent). The next
      // verify call short-circuits on the DB flag without hitting Redis.
      await this.prisma.principal
        .update({
          where: { id: principalId },
          data: { trialUsedCount: newCount, trialExhaustedAt: exhaustedAt },
        })
        .catch((err) =>
          this.logger.error(
            `TrialService: failed to persist trialExhaustedAt principalId=${principalId}: ${(err as Error).message}`,
          ),
        );
      return { exhausted: true, exhaustedAt, reason: 'CAP_REACHED' };
    }

    // ── 4. Periodic DB flush (best-effort, non-blocking).
    if (newCount % DB_FLUSH_EVERY === 0) {
      void this.prisma.principal
        .update({
          where: { id: principalId },
          data: { trialUsedCount: newCount },
        })
        .catch((err) =>
          this.logger.warn(
            `TrialService: periodic flush failed principalId=${principalId} count=${newCount}: ${(err as Error).message}`,
          ),
        );
    }

    return { exhausted: false, remaining: TRIAL_LIFETIME_CAP - newCount };
  }

  /**
   * Read-only status for dashboards / health endpoints.
   * Reads Redis first (live) then falls back to the DB column.
   */
  async getStatus(principalId: string): Promise<TrialStatus | null> {
    const principal = await this.prisma.principal.findUnique({
      where: { id: principalId },
      select: { planTier: true, trialUsedCount: true, trialExhaustedAt: true },
    });
    if (!principal) {
      // Round-19 fix per peer review F-04: return `null` for not-found
      // instead of -1 sentinels. Forces callers (dashboards, ops endpoints)
      // to handle the not-found case explicitly — no fabricated numbers.
      return null;
    }
    if (principal.planTier !== 'FREE') {
      return {
        planTier: principal.planTier,
        used: -1,
        cap: -1,
        remaining: -1,
        exhausted: false,
        exhaustedAt: principal.trialExhaustedAt,
      };
    }

    let liveCount = principal.trialUsedCount;
    try {
      const raw = await this.redis.raw().get(`${this.USED_PREFIX}:${principalId}`);
      if (raw !== null) {
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed)) liveCount = parsed;
      }
    } catch (err) {
      this.logger.warn(
        `TrialService.getStatus: Redis GET failed principalId=${principalId} — using DB mirror: ${(err as Error).message}`,
      );
    }

    const exhausted = principal.trialExhaustedAt !== null || liveCount >= TRIAL_LIFETIME_CAP;
    return {
      planTier: 'FREE',
      used: liveCount,
      cap: TRIAL_LIFETIME_CAP,
      remaining: Math.max(0, TRIAL_LIFETIME_CAP - liveCount),
      exhausted,
      exhaustedAt: principal.trialExhaustedAt,
    };
  }

  /**
   * Operator escape hatch — clears the trial counter on plan upgrade.
   * Called by the Stripe webhook handler when a FREE principal moves to
   * a paid tier. Logs a structured event so admin actions are auditable
   * via log aggregation (we deliberately do NOT couple to AuditService
   * here to keep BillingModule free of audit-chain dependencies; a
   * future ADR can lift this into the signed audit chain if SOC2 scope
   * grows to cover trial resets).
   */
  async reset(principalId: string): Promise<void> {
    // Round-19 fix per peer review F-02: use SET 0 (idempotent — Redis lands
    // in a known good state) instead of DEL (failure leaves stale counter
    // that would cause a paying customer to receive HTTP 402 on the next
    // verify after upgrade). If Redis SET fails we throw — the Stripe
    // webhook handler retries on non-200, which gives us another chance to
    // converge. Better to surface the upgrade failure than to ship a
    // corrupted state.
    try {
      await this.redis.raw().set(`${this.USED_PREFIX}:${principalId}`, '0');
    } catch (err) {
      this.logger.error(
        `TrialService.reset: Redis SET failed principalId=${principalId} — throwing so Stripe webhook can retry: ${(err as Error).message}`,
      );
      throw err;
    }
    await this.prisma.principal.update({
      where: { id: principalId },
      data: { trialUsedCount: 0, trialExhaustedAt: null },
    });
    this.logger.log(`TrialService.reset principalId=${principalId} reset=ok`);
  }
}
