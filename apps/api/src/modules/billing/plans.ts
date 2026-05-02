// Pricing tiers — operator decision OD-003 (default until DECIDED).
//
// Source of truth: this file. `docs/spec/04_COMMERCIAL_STRATEGY.md` PART V
// covers the strategy; `OPERATOR_DECISIONS.md` row OD-003 is the decision
// state. The default below is the conservative reconciliation; the spec
// proposes more aggressive tiers (Free 10K / Dev $29 / Growth $149).
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

export const PRICING_VERSION = 'v1.0.0-default-2026-05-01';

export interface PlanDefinition {
  /** Stable internal identifier (matches `PlanTier` enum). */
  tier: PlanTier;
  /** Human-readable display name. */
  displayName: string;
  /** Monthly base price in USD cents. `null` for custom Enterprise pricing. */
  monthlyPriceCents: number | null;
  /** Maximum verify calls per month before overage / hard-stop. */
  monthlyVerifyQuota: number;
  /** Per-call price for overage above the quota, USD cents. `null` = hard stop. */
  overagePerCallCents: number | null;
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
}

export const PLANS: Readonly<Record<PlanTier, PlanDefinition>> = Object.freeze({
  FREE: {
    tier: 'FREE',
    displayName: 'Free',
    monthlyPriceCents: 0,
    monthlyVerifyQuota: 1_000,
    overagePerCallCents: null, // hard stop — see OD-003
    agentCap: 2,
    auditRetentionDays: 30,
    bateAccess: false, // upgrade trigger — locked dashboard widget
    webhooks: false,
    stripeEnvSuffix: null,
    verifyP99TargetMs: 250,
  },
  DEVELOPER: {
    tier: 'DEVELOPER',
    displayName: 'Developer',
    monthlyPriceCents: 4_900,
    monthlyVerifyQuota: 50_000,
    overagePerCallCents: 2, // $0.0002 / call
    agentCap: 10,
    auditRetentionDays: 90,
    bateAccess: true,
    webhooks: true,
    stripeEnvSuffix: 'DEVELOPER',
    verifyP99TargetMs: 200,
  },
  GROWTH: {
    tier: 'GROWTH',
    displayName: 'Growth',
    monthlyPriceCents: 29_900,
    monthlyVerifyQuota: 500_000,
    overagePerCallCents: 1, // $0.0001 / call
    agentCap: 100,
    auditRetentionDays: 365,
    bateAccess: true,
    webhooks: true,
    stripeEnvSuffix: 'GROWTH',
    verifyP99TargetMs: 120,
  },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    displayName: 'Enterprise',
    monthlyPriceCents: null, // custom — invoiced
    monthlyVerifyQuota: Number.POSITIVE_INFINITY,
    overagePerCallCents: null,
    agentCap: Number.POSITIVE_INFINITY,
    auditRetentionDays: 7 * 365, // OD-004 default
    bateAccess: true,
    webhooks: true,
    stripeEnvSuffix: 'ENTERPRISE',
    verifyP99TargetMs: 80,
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
  if (plan.overagePerCallCents == null) {
    return { allowed: false, remaining: 0, reason: 'PLAN_LIMIT_EXCEEDED' };
  }
  return { allowed: true, remaining: 0 }; // metered overage
}
