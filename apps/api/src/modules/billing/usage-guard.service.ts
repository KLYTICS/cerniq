// Usage guard — enforces plan-tier monthly verify quotas before any
// verify call reaches the algorithm. This is the G-2 gate: Stripe billing
// may not be wired yet, but plan limits ARE enforced for paid tiers.
//
// Round-20 cleanup: FREE tier delegated to TrialService per Round-19 F-08.
// FREE.monthlyVerifyQuota is Number.POSITIVE_INFINITY (see plans.ts), so
// `checkQuota` always returns allowed=true / remaining=Infinity for FREE
// principals — the lifetime trial cap is enforced by `TrialService` which
// fires `TRIAL_EXHAUSTED` (HTTP 402). This service deliberately retains
// no FREE-specific branch; the generic precedence in `isVerifyCallAllowed`
// is what produces the short-circuit. Tests in usage-guard.service.spec.ts
// keep one regression guard ("FREE tier never fires PLAN_LIMIT_EXCEEDED").
//
// Hot path design:
//   - Redis INCR on `aegis:usage:{principalId}:{monthKey}` is the fast
//     path. The counter auto-expires at start of next month (plus 1-day
//     buffer to survive DST edge cases).
//   - On Redis miss (first call of the month or after Redis eviction) we
//     backfill from the AuditEvent table — a single COUNT(*) query.
//   - The principal's planTier is cached in Redis under the same key
//     namespace so we avoid a principal DB read on every call.
//   - CLAUDE.md invariant #4 (no silent failures): if Redis is
//     unavailable, we fail-open for plan enforcement (not security-
//     critical) but log a warning; the SpendGuardService remains the
//     security gate.

import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PlanTier } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { getPlan, isVerifyCallAllowed } from './plans';
import { StripeService } from './stripe.service';

export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
  planTier: PlanTier;
  monthlyQuota: number;
  reason?: 'PLAN_LIMIT_EXCEEDED';
}

/** One YYYY-MM key per principal per calendar month (UTC). */
function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Seconds until the start of next month (UTC), plus 1-day buffer. */
function secondsUntilEndOfMonth(): number {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.ceil((nextMonth.getTime() - now.getTime()) / 1000) + 86_400;
}

@Injectable()
export class UsageGuardService {
  private readonly logger = new Logger(UsageGuardService.name);

  private readonly USAGE_PREFIX = 'aegis:usage';
  private readonly PLAN_PREFIX = 'aegis:plan';
  /** Cache the principal's planTier for 5 minutes to avoid DB reads on every call. */
  private readonly PLAN_CACHE_TTL = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    // forwardRef breaks the StripeService ↔ UsageGuardService import cycle:
    // StripeService injects UsageGuardService for plan-cache invalidation,
    // and UsageGuardService now injects StripeService to fire metered
    // overage records on the verify hot path. @Optional so the unit-test
    // suite can construct the service with two args (existing call sites).
    @Optional()
    @Inject(forwardRef(() => StripeService))
    private readonly stripe?: StripeService,
  ) {}

  /**
   * Check whether `principalId` is within their plan's monthly verify quota.
   * If Redis is unavailable the check fails-open (returns allowed=true) to
   * avoid blocking verify calls due to an observability-layer outage.
   * This is intentionally different from SpendGuardService which fails-closed
   * because spend is a security gate; quota is a billing gate.
   */
  async checkQuota(principalId: string): Promise<QuotaCheckResult> {
    const mk = monthKey();
    const usageKey = `${this.USAGE_PREFIX}:${principalId}:${mk}`;

    let planTier: PlanTier;
    let monthCount: number;

    try {
      // ── 1. Resolve plan tier (cached) ───────────────────────────────────
      planTier = await this.resolvePlanTier(principalId);

      // ── 2. Get current month usage (Redis counter) ──────────────────────
      // Use redis.raw() to access the underlying ioredis client for integer
      // INCR/EXPIRE semantics — RedisService.incrBy uses INCRBYFLOAT which
      // is unsuitable for integer quota counters.
      const raw = await this.redis.raw().get(usageKey);
      if (raw !== null) {
        monthCount = parseInt(raw, 10);
      } else {
        // Redis miss: backfill from AuditEvent.
        // AuditEvent uses `timestamp` — not `createdAt` (schema field name).
        const startOfMonth = new Date(
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
        );
        const count = await this.prisma.auditEvent.count({
          where: { principalId, timestamp: { gte: startOfMonth } },
        });
        monthCount = count;
        // Seed the Redis counter so subsequent calls are fast.
        await this.redis.raw()
          .multi()
          .set(usageKey, String(count))
          .expire(usageKey, secondsUntilEndOfMonth())
          .exec();
      }
    } catch (err) {
      // Redis or DB failure — fail-open for quota (billing gate, not security).
      this.logger.warn(
        `UsageGuardService: quota check failed for principal=${principalId}, failing open. Error: ${(err as Error).message}`,
      );
      return { allowed: true, remaining: -1, planTier: 'FREE', monthlyQuota: -1 };
    }

    const plan = getPlan(planTier);
    const result = isVerifyCallAllowed(plan, monthCount);

    return {
      allowed: result.allowed,
      remaining: result.remaining,
      planTier,
      monthlyQuota: plan.monthlyVerifyQuota === Number.POSITIVE_INFINITY
        ? -1  // sentinel: unlimited
        : plan.monthlyVerifyQuota,
      reason: result.reason,
    };
  }

  /**
   * Increment the monthly counter after a verify call is approved.
   * Fire-and-forget — a missed increment means we slightly under-count;
   * the DB backfill on Redis miss self-corrects on the next cold start.
   *
   * Round 21 Lane B: when the post-increment count strictly exceeds the
   * principal's plan `monthlyVerifyQuota` AND the plan has a per-call
   * overage rate (`overagePerCallE4 != null` — paid+metered tiers only),
   * fire-and-forget a Stripe `usage_records.create` via
   * `StripeService.recordOverage`. CLAUDE.md invariant 2 (FREE owned by
   * TrialService) is enforced both here (FREE has overagePerCallE4 = null
   * and POSITIVE_INFINITY quota) and inside `recordOverage` itself.
   *
   * Fire-and-forget is deliberate: verify p99 must NOT take a Stripe
   * round-trip. A missed metering call is logged inside `recordOverage`
   * (under-billing > blocking the customer's verify).
   */
  incrementUsage(principalId: string): void {
    const mk = monthKey();
    const usageKey = `${this.USAGE_PREFIX}:${principalId}:${mk}`;
    void this.redis.raw()
      .multi()
      .incr(usageKey)
      // Re-set TTL on increment so the key doesn't expire mid-month if it
      // was seeded by the backfill path (which doesn't set TTL on INCR).
      .expire(usageKey, secondsUntilEndOfMonth())
      .exec()
      .then((replies) => {
        // ioredis `exec()` reply tuple shape: `[err, value][]`; first entry
        // is INCR's post-increment integer. Be defensive — if the shape is
        // unexpected, skip metering rather than spam errors.
        if (!Array.isArray(replies) || replies.length === 0) return;
        const incrReply = replies[0];
        if (!Array.isArray(incrReply) || incrReply.length < 2) return;
        const incrErr = incrReply[0];
        const incrVal = incrReply[1];
        if (incrErr) return;
        const post =
          typeof incrVal === 'number'
            ? incrVal
            : typeof incrVal === 'string'
              ? parseInt(incrVal, 10)
              : Number.NaN;
        if (!Number.isFinite(post)) return;
        // Look up plan tier from cache (no DB hit on the hot path) and
        // fire metered overage if applicable. Errors here are swallowed
        // by the same `.catch` below.
        void this.maybeRecordOverage(principalId, post);
      })
      .catch((err) =>
        this.logger.warn(`UsageGuardService: increment failed for principal=${principalId}: ${(err as Error).message}`),
      );
  }

  /**
   * Fire `StripeService.recordOverage` iff:
   *   - StripeService is injected (production wiring),
   *   - the principal's plan has a non-null `overagePerCallE4` (paid+metered),
   *   - `postIncrementCount > monthlyVerifyQuota` (strictly past the cap).
   *
   * Defence-in-depth: explicit FREE-tier short-circuit per CLAUDE.md
   * invariant 2 — TrialService owns the FREE gate, never UsageGuard.
   */
  private async maybeRecordOverage(
    principalId: string,
    postIncrementCount: number,
  ): Promise<void> {
    if (!this.stripe) return;
    let planTier: PlanTier;
    try {
      planTier = await this.resolvePlanTier(principalId);
    } catch {
      // Cache miss + Redis/DB failure — skip metering (under-bill, never
      // block). The next successful verify will retry the lookup.
      return;
    }
    if (planTier === 'FREE') return; // Invariant 2 defence-in-depth
    const plan = getPlan(planTier);
    if (plan.overagePerCallE4 == null) return; // ENTERPRISE / hard-stop tiers
    if (postIncrementCount <= plan.monthlyVerifyQuota) return;
    try {
      await this.stripe.recordOverage(principalId, 1);
    } catch (err) {
      this.logger.error(
        `UsageGuardService: recordOverage failed for principal=${principalId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Resolve the plan tier for `principalId`, hitting Redis first and the
   * `Principal` table on cache miss. Used by both `checkQuota` (monthly
   * quota gate) and `getPlanTier` (rate-limit lookup in
   * `PlanAwareThrottlerGuard`). Throws on Redis/Prisma failure — callers
   * decide their fail-open / fail-closed posture.
   */
  private async resolvePlanTier(principalId: string): Promise<PlanTier> {
    const planKey = `${this.PLAN_PREFIX}:${principalId}`;
    const cachedPlan = await this.redis.get<{ tier: PlanTier }>(planKey);
    if (cachedPlan) {
      return cachedPlan.tier;
    }
    const principal = await this.prisma.principal.findUnique({
      where: { id: principalId },
      select: { planTier: true },
    });
    const planTier: PlanTier = principal?.planTier ?? 'FREE';
    await this.redis.set(planKey, { tier: planTier }, this.PLAN_CACHE_TTL);
    return planTier;
  }

  /**
   * Public plan-tier lookup for the rate-limit hot path.
   *
   * `PlanAwareThrottlerGuard` calls this on every `/v1/verify` request that
   * carries an authenticated principal. The Redis cache (5 min TTL, shared
   * with `checkQuota`) keeps this O(1) on the hot path; the DB read fires
   * only on cold start or after `invalidatePlanCache` runs (e.g. on plan
   * upgrade webhook). Fails-open to FREE on Redis/Prisma error so a cache
   * outage caps abuse at the most restrictive tier rather than blocking
   * traffic.
   */
  async getPlanTier(principalId: string): Promise<PlanTier> {
    try {
      return await this.resolvePlanTier(principalId);
    } catch (err) {
      this.logger.warn(
        `UsageGuardService: plan tier lookup failed for principal=${principalId}, defaulting to FREE. Error: ${(err as Error).message}`,
      );
      return 'FREE';
    }
  }

  /**
   * Invalidate the plan cache for a principal — call this after a plan upgrade
   * or downgrade so the new tier takes effect immediately.
   */
  async invalidatePlanCache(principalId: string): Promise<void> {
    const planKey = `${this.PLAN_PREFIX}:${principalId}`;
    await this.redis.del(planKey);
  }
}
