// Pricing tiers — operator decision OD-003 (CLOSED 2026-05-05 by ADR-0014).
//
// Source of truth: this file + ADR-0014 (`docs/decisions/0014-pricing-and-
// free-trial.md`). `OPERATOR_DECISIONS.md` row OD-003 is now closed.
//
// ADR-0014 final tier table:
//   Free trial : $0,    10K verifies LIFETIME (not monthly), HTTP 402 at cap
//   Developer  : $49,   50K  verifies/mo, $0.0008/verify overage
//   Team       : $299,  500K verifies/mo, $0.0008/verify overage  (rebrand of GROWTH; see ROUND_18 schema migration to add SCALE)
//   Scale      : $1499, 5M   verifies/mo, $0.0008/verify overage  [PENDING — needs PlanTier enum migration]
//   Enterprise : custom
//
// Round 17 (this file) ships the overage-rate fix and display-name rebrand
// against the existing PlanTier enum (FREE | DEVELOPER | GROWTH | ENTERPRISE).
// The lifetime-trial counter ships in `trial.service.ts`. Adding a SCALE
// PlanTier value requires a Prisma migration that is gated on the
// operator's go-ahead (Round 18).
//
// Used by:
//   - `usage.service.ts` to gate verify calls when the monthly meter
//     exceeds `monthlyVerifyQuota`.
//   - `billing/stripe.service.ts` to map our internal plan ids to Stripe
//     product/price ids (env-driven, see `STRIPE_*` envs).
//   - The dashboard's plan picker.
//
// Pure constants. No NestJS, no DI — importable anywhere.

import type { PlanTier } from '@prisma/client';

export const PRICING_VERSION = 'v1.1.0-adr0014-2026-05-05';

/**
 * ADR-0014: lifetime verify cap for FREE-tier principals. Once a trial
 * principal accumulates this many successful verifies — counted across
 * their entire account lifetime, NOT per month — `TrialService` returns
 * `denialReason: 'TRIAL_EXHAUSTED'` (HTTP 402) on every subsequent
 * verify until the principal upgrades.
 */
export const TRIAL_LIFETIME_CAP = 10_000;

export interface PlanDefinition {
  /** Stable internal identifier (matches `PlanTier` enum). */
  tier: PlanTier;
  /** Human-readable display name. */
  displayName: string;
  /** Monthly base price in USD cents. `null` for custom Enterprise pricing. */
  monthlyPriceCents: number | null;
  /** Maximum verify calls per month before overage / hard-stop. */
  monthlyVerifyQuota: number;
  /**
   * Per-call price for overage above the quota in **ten-thousandths of a
   * dollar** (USD × 10⁻⁴). I.e. `1` = $0.0001, `8` = $0.0008/verify.
   *
   * Naming rationale: the previous suffix `Cents` was a landmine — anything
   * trusting the suffix (Stripe metering, dashboard display, internal
   * billing reports) would be off by 100×. `E4` reads as "ten to the
   * negative four" mantissa. There is no SI prefix for 10⁻⁴ ("MicroDollars"
   * means 10⁻⁶ — wrong by 100×), so `E4` is the cleanest neutral suffix.
   *
   * `null` = hard stop (no metered billing — `UsageGuardService` denies
   * with `PLAN_LIMIT_EXCEEDED` once `monthlyVerifyQuota` is hit).
   *
   * Convert to Stripe's metering unit (cents) via `overageToCents()`.
   *
   * type-rationale: if operator prefers `overagePerCallTenthOfCent` for
   * customer-facing clarity, swap the field name; the unit semantics are
   * unchanged (1 unit = $0.0001 = 1/10 of a cent).
   */
  overagePerCallE4: number | null;
  /** Maximum agents the principal can have registered. */
  agentCap: number;
  /** Audit log retention in days. */
  auditRetentionDays: number;
  /** Whether the principal sees BATE trust scores in dashboards / API. */
  bateAccess: boolean;
  /** Whether webhook subscriptions are available. */
  webhooks: boolean;
  /** Stripe environment-variable suffix used by `stripe.service.ts` to look up the price id. */
  stripeEnvSuffix: string | null;
  /** Hard SLA target for `/v1/verify` p99 ms. Informational. */
  verifyP99TargetMs: number;
  /**
   * Per-plan rate limit applied by `PlanAwareThrottlerGuard` on `/v1/verify`.
   * `limit` calls allowed per `ttlMs` window. Sized to reflect rps × burst:
   * sustainable rps roughly equals limit / (ttlMs/1000) divided by 2 (burst
   * headroom). `Number.POSITIVE_INFINITY` is the unlimited sentinel — the
   * throttler short-circuits before any storage hit. (OD-006 default)
   */
  verifyRateLimit: { limit: number; ttlMs: number };
}

export const PLANS: Readonly<Record<PlanTier, PlanDefinition>> = Object.freeze({
  FREE: {
    tier: 'FREE',
    displayName: 'Free trial',
    monthlyPriceCents: 0,
    // ADR-0014: free trial is LIFETIME-capped at 10K verifies, not
    // monthly. `monthlyVerifyQuota: POSITIVE_INFINITY` means
    // `UsageGuardService` (which fires PLAN_LIMIT_EXCEEDED) skips
    // the FREE tier entirely — `TrialService` is the canonical gate
    // for FREE principals and fires `TRIAL_EXHAUSTED` (HTTP 402) at
    // `TRIAL_LIFETIME_CAP` (10K). Round-19 fix per peer review F-08
    // (the prior 10_000 here double-gated with the trial counter and
    // FREE customers always saw PLAN_LIMIT_EXCEEDED instead of the
    // ADR-0014 mandated TRIAL_EXHAUSTED).
    monthlyVerifyQuota: Number.POSITIVE_INFINITY,
    overagePerCallE4: null, // hard stop — TrialService owns the gate; UsageGuard is short-circuited
    agentCap: 2,
    auditRetentionDays: 30,
    bateAccess: false, // upgrade trigger — locked dashboard widget
    webhooks: false,
    stripeEnvSuffix: null,
    verifyP99TargetMs: 250,
    // 20 calls / 1s = ~10 rps sustained + 20 burst (OD-006).
    verifyRateLimit: { limit: 20, ttlMs: 1_000 },
  },
  DEVELOPER: {
    tier: 'DEVELOPER',
    displayName: 'Developer',
    monthlyPriceCents: 4_900,
    monthlyVerifyQuota: 50_000,
    // ADR-0014 fixes overage at $0.0008/verify uniformly across paid tiers.
    // Unit: ten-thousandths of a dollar (1 = $0.0001). 8 = $0.0008. See
    // `PlanDefinition.overagePerCallE4` doc + `overageToCents()` helper.
    overagePerCallE4: 8,
    agentCap: 10,
    auditRetentionDays: 90,
    bateAccess: true,
    webhooks: true,
    stripeEnvSuffix: 'DEVELOPER',
    verifyP99TargetMs: 200,
    // 200 calls / 1s = ~100 rps sustained + 200 burst (OD-006).
    verifyRateLimit: { limit: 200, ttlMs: 1_000 },
  },
  GROWTH: {
    tier: 'GROWTH',
    // Display name "Team" per ADR-0014. The Prisma enum value remains
    // GROWTH until Round 18 schema migration. Customer-facing surfaces
    // (dashboard, pricing page) read displayName.
    displayName: 'Team',
    monthlyPriceCents: 29_900,
    monthlyVerifyQuota: 500_000,
    // ADR-0014 uniform $0.0008/verify overage.
    overagePerCallE4: 8,
    agentCap: 100,
    auditRetentionDays: 365,
    bateAccess: true,
    webhooks: true,
    stripeEnvSuffix: 'TEAM', // Stripe price id env reads STRIPE_PRICE_ID_TEAM
    verifyP99TargetMs: 120,
    // 1_000 calls / 1s = ~500 rps sustained + burst headroom (OD-006).
    verifyRateLimit: { limit: 1_000, ttlMs: 1_000 },
  },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    displayName: 'Enterprise',
    monthlyPriceCents: null, // custom — invoiced
    monthlyVerifyQuota: Number.POSITIVE_INFINITY,
    overagePerCallE4: null,
    agentCap: Number.POSITIVE_INFINITY,
    auditRetentionDays: 7 * 365, // OD-004 default
    bateAccess: true,
    webhooks: true,
    stripeEnvSuffix: 'ENTERPRISE',
    verifyP99TargetMs: 80,
    // Unlimited sentinel — PlanAwareThrottlerGuard short-circuits before
    // any storage hit when limit === Number.POSITIVE_INFINITY.
    verifyRateLimit: { limit: Number.POSITIVE_INFINITY, ttlMs: 1_000 },
  },
});

export function getPlan(tier: PlanTier): PlanDefinition {
  return PLANS[tier];
}

/**
 * Decide whether a verify call should be allowed given the plan and the
 * current month-to-date usage. Hard-stop tiers reject above quota; metered
 * tiers permit the call and the billing service records the overage.
 */
export function isVerifyCallAllowed(plan: PlanDefinition, monthVerifyCount: number): {
  allowed: boolean;
  remaining: number;
  reason?: 'PLAN_LIMIT_EXCEEDED';
} {
  const remaining = Math.max(0, plan.monthlyVerifyQuota - monthVerifyCount);

  if (monthVerifyCount < plan.monthlyVerifyQuota) {
    return { allowed: true, remaining };
  }
  if (plan.overagePerCallE4 == null) {
    return { allowed: false, remaining: 0, reason: 'PLAN_LIMIT_EXCEEDED' };
  }
  return { allowed: true, remaining: 0 }; // metered overage
}

/**
 * Convert an `overagePerCallE4` value (ten-thousandths of a dollar, 10⁻⁴ USD)
 * to **cents** (hundredths of a dollar, 10⁻² USD) — the unit Stripe's metered
 * billing API expects in `quantity` × `unit_amount`.
 *
 * Math: `cents = e4 × 10⁻⁴ ÷ 10⁻² = e4 / 100`.
 *
 * Examples:
 *   `overageToCents(8)   === 0.08`  ($0.0008 = 0.08 cents)
 *   `overageToCents(100) === 1`     ($0.01   = 1 cent)
 *
 * NOTE: Stripe's `unit_amount` field is an integer count of cents, so for
 * sub-cent rates ($0.0008/verify) Stripe metering needs a `unit_amount` of
 * 1 cent with `quantity = ceil(verifies / 1250)` OR a custom price tier —
 * see `stripe.service.ts` when metered overage shipping is implemented.
 * This helper exists so any consumer that needs cents has a single audited
 * conversion site instead of inlining `/ 100` and forgetting the units.
 */
export function overageToCents(e4: number): number {
  return e4 / 100;
}
