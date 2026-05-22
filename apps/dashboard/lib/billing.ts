// Typed billing fetchers for the dashboard.
//
// Wraps the api-client with billing-domain semantics:
//   - getBillingPlan() → server-side fetch of /v1/billing/plan, or null on
//     unauthenticated/error so the page can render a graceful empty state.
//   - openBillingPortal() → POST /v1/billing/portal, returns null on 404 so
//     deployments where the portal endpoint hasn't shipped yet (Round 21
//     follow-up) degrade gracefully instead of crashing the page.
//
// CLAUDE.md invariant 4 — no fabricated data: when a field the UI wants
// (e.g. trialUsedCount, trialExhaustedAt) is not yet exposed by the API,
// callers must render a "Usage data unavailable" placeholder rather than
// guess. See `derivePlanView()` below for the per-field policy.

import 'server-only';

import {
  OkoroApiError,
  OkoroAuthMissingError,
  getPlanSummary,
  type PlanSummary,
} from './api-client';

export type PlanTier = PlanSummary['planTier'];

export interface PlanLoadOk {
  ok: true;
  plan: PlanSummary;
}

export interface PlanLoadErr {
  ok: false;
  code: string;
  message: string;
}

export type PlanLoad = PlanLoadOk | PlanLoadErr;

export async function loadPlan(): Promise<PlanLoad> {
  try {
    const plan = await getPlanSummary();
    return { ok: true, plan };
  } catch (err) {
    if (err instanceof OkoroAuthMissingError) {
      return {
        ok: false,
        code: err.code,
        message: 'Set OKORO_DASHBOARD_API_KEY to populate billing.',
      };
    }
    if (err instanceof OkoroApiError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return {
      ok: false,
      code: 'UNKNOWN',
      message: 'Unexpected error contacting OKORO API.',
    };
  }
}

// ── Trial-projection helpers ────────────────────────────────────────────
//
// API surface gap (TODO Round 21): /v1/billing/plan does not yet expose
// `trialUsedCount` or `trialExhaustedAt`. For FREE tier we fall back to
// `monthVerifyCount` / `monthlyQuota` as a proxy — semantically correct
// because FREE's monthly quota IS the trial cap. When the API surfaces
// dedicated trial counters, swap the proxy for the canonical fields here
// and at the component edge.

export interface TrialView {
  /** True when canonical fields are unavailable and we are using a proxy. */
  proxied: boolean;
  used: number | null;
  quota: number | null;
  remaining: number | null;
  pct: number | null;
}

export function deriveTrialView(plan: PlanSummary): TrialView {
  // FREE plan: monthly quota IS the trial. -1 means unlimited (shouldn't
  // happen on FREE but guard anyway).
  if (plan.planTier !== 'FREE') {
    return { proxied: false, used: null, quota: null, remaining: null, pct: null };
  }
  if (plan.monthlyQuota <= 0 || plan.monthVerifyCount < 0) {
    return { proxied: true, used: null, quota: null, remaining: null, pct: null };
  }
  const used = plan.monthVerifyCount;
  const quota = plan.monthlyQuota;
  const remaining = Math.max(0, quota - used);
  const pct = Math.min(100, (used / quota) * 100);
  return { proxied: true, used, quota, remaining, pct };
}

export interface UsageView {
  used: number | null;
  quota: number | null;
  remaining: number | null;
  pct: number | null;
  unlimited: boolean;
}

export function deriveUsageView(plan: PlanSummary): UsageView {
  if (plan.monthlyQuota === -1) {
    return {
      used: plan.monthVerifyCount >= 0 ? plan.monthVerifyCount : null,
      quota: null,
      remaining: null,
      pct: null,
      unlimited: true,
    };
  }
  if (plan.monthlyQuota <= 0 || plan.monthVerifyCount < 0) {
    return { used: null, quota: null, remaining: null, pct: null, unlimited: false };
  }
  const used = plan.monthVerifyCount;
  const quota = plan.monthlyQuota;
  const remaining = Math.max(0, quota - used);
  const pct = Math.min(100, (used / quota) * 100);
  return { used, quota, remaining, pct, unlimited: false };
}

export function isPastDue(plan: PlanSummary): boolean {
  const s = (plan.subscriptionStatus ?? '').toUpperCase();
  return s === 'PAST_DUE' || s === 'UNPAID';
}
