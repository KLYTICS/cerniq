// Plan-aware rate limiter for /v1/verify (OD-006).
//
// Replaces the flat 1000-rpm `@Throttle({ verify })` decorator with a
// per-plan-tier dynamic throttle. Tiers and their limits live in
// `modules/billing/plans.ts.verifyRateLimit`. The mapping is:
//   FREE        →  20 calls / 1s  (≈10 rps sustained + 20 burst)
//   DEVELOPER   →  200 calls / 1s (≈100 rps sustained + 200 burst)
//   GROWTH      →  1_000 calls / 1s (≈500 rps + headroom)
//   ENTERPRISE  →  POSITIVE_INFINITY → guard short-circuits, no Redis hit.
//
// Hot-path design notes:
//   1. `getTracker` resolves to the principalId (when authenticated) so
//      shared-NAT customers aren't lumped together. Anonymous requests
//      (e.g. /health/ready, /.well-known/jwks — though those don't import
//      this guard) fall back to `req.ip` and the FREE limit, so abuse
//      from unauthenticated callers is still capped.
//   2. The throttler key embeds the plan tier (`generateKey` suffix) so a
//      plan upgrade — followed by `UsageGuardService.invalidatePlanCache` —
//      starts a fresh bucket immediately. No "trapped at FREE limit until
//      bucket TTL expires" UX papercut.
//   3. `UsageGuardService.getPlanTier` is the single principal-tier lookup
//      reused across the quota gate and this rate limiter (Redis cache,
//      5 min TTL). We do NOT introduce a second cache.
//   4. On limit exceeded we emit a 429 with `Retry-After` and a JSON body
//      whose `details` carries `{planTier, limit, windowMs, retryAfter}` —
//      everything a customer needs to back-off intelligently and decide
//      whether to upgrade. The HttpExceptionFilter at apps/api/src/common
//      /filters/http-exception.filter.ts forwards `error`, `message` and
//      `details` to the wire envelope.
//
// CLAUDE.md invariants honoured:
//   - No silent failures: a `getPlanTier` exception inside this guard
//     fails-OPEN (request passes, log warn). Same posture as the quota
//     gate (UsageGuardService) — rate-limiting is a fairness/billing
//     gate, not a security gate. SpendGuard remains the security gate.
//   - Multi-tenant isolation: storage key prefix already namespaces the
//     class+handler+throttler-name; we add tracker = principalId so
//     buckets cannot collide across principals.

import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import type { PlanTier } from '@prisma/client';
import type { Request, Response } from 'express';

import type { AuthenticatedKey } from '../../modules/auth/api-key.service';
import { UsageGuardService } from '../../modules/billing/usage-guard.service';
import { getPlan } from '../../modules/billing/plans';

/** Default fallback when no principal is on the request (anonymous traffic). */
const ANONYMOUS_FALLBACK_TIER: PlanTier = 'FREE';

@Injectable()
export class PlanAwareThrottlerGuard extends ThrottlerGuard {
  // Logger is private here (not protected) — parent ThrottlerGuard does
  // not declare one, so there's no shadow.
  private readonly planAwareLogger = new Logger(PlanAwareThrottlerGuard.name);

  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly usageGuard: UsageGuardService,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Tracker = principalId for authenticated requests, IP otherwise.
   * Per-principal tracking is far more accurate than per-IP for shared-NAT
   * customers (corporate egress, mobile carriers, CI fleets).
   */
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const auth = (req as { auth?: AuthenticatedKey }).auth;
    if (auth?.principalId) {
      return `principal:${auth.principalId}`;
    }
    const ip = (req as { ip?: string }).ip;
    return `ip:${ip ?? 'unknown'}`;
  }

  /**
   * Plan-aware override. We resolve the principal's tier, look up its
   * `verifyRateLimit`, short-circuit on the unlimited sentinel, and
   * otherwise call into the parent's bucket logic with the tier-resolved
   * limit/ttl plus a tier-suffixed tracker so upgrades reset cleanly.
   */
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler, blockDuration, generateKey } = requestProps;

    const { req, res } = this.getRequestResponse(context) as {
      req: Request;
      res: Response;
    };

    const auth = (req as Request & { auth?: AuthenticatedKey }).auth;
    const planTier = auth?.principalId
      ? await this.usageGuard.getPlanTier(auth.principalId)
      : ANONYMOUS_FALLBACK_TIER;

    const { limit, ttlMs } = getPlan(planTier).verifyRateLimit;

    // ENTERPRISE / unlimited sentinel — skip throttling entirely.
    // No Redis call, no headers, no bookkeeping.
    if (!Number.isFinite(limit)) {
      return true;
    }

    // Build the tracker. Embedding the tier means a tier upgrade clears
    // the bucket cleanly — the storage key changes, so the new tier
    // starts with an empty counter.
    const baseTracker = await this.getTracker(req as unknown as Record<string, unknown>);
    const tracker = `${baseTracker}|${planTier}`;
    // Throttler name defaults to 'default' in onModuleInit but the type
    // remains `string | undefined`; coalesce so storage keys are stable.
    const throttlerName = throttler.name ?? 'default';
    const key = generateKey(context, tracker, throttlerName);

    const { totalHits, timeToExpire, isBlocked, timeToBlockExpire } =
      await this.storageService.increment(key, ttlMs, limit, blockDuration, throttlerName);

    if (isBlocked) {
      // Emit a Retry-After header up front — many HTTP clients honour it
      // on 429 specifically, and the value belongs in the response even
      // though the body also carries it for programmatic consumers.
      try {
        res.header('Retry-After', String(timeToBlockExpire));
      } catch {
        // type-rationale: response.header is missing in raw mocks during
        // unit tests; swallowing keeps the throw path test-friendly.
      }
      throw new HttpException(
        {
          error: 'rate_limit_exceeded',
          message: `Plan tier ${planTier} allows ${limit} verify calls per ${ttlMs}ms. Slow down or upgrade.`,
          details: {
            planTier,
            limit,
            windowMs: ttlMs,
            retryAfter: timeToBlockExpire,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Mirror parent's informational headers so clients can see remaining
    // capacity. We use the same X-RateLimit-* prefix so existing dashboards
    // continue to work.
    try {
      res.header('X-RateLimit-Limit', String(limit));
      res.header('X-RateLimit-Remaining', String(Math.max(0, limit - totalHits)));
      res.header('X-RateLimit-Reset', String(timeToExpire));
    } catch {
      // type-rationale: see above — header() is mocked away in unit tests.
    }

    return true;
  }

  /**
   * Wrap the standard `canActivate` so a transient lookup failure inside
   * `handleRequest` (e.g. UsageGuardService → Redis blip) fails-OPEN with
   * a logged warning rather than 500-ing the verify hot path. Same posture
   * as the quota gate.
   */
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(context);
    } catch (err) {
      // Re-raise our intentional 429s.
      if (err instanceof HttpException && err.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        throw err;
      }
      this.planAwareLogger.warn(
        `PlanAwareThrottlerGuard: failing open due to internal error: ${(err as Error).message}`,
      );
      return true;
    }
  }
}
