// Shared constants — single source of truth across API, SDK, and dashboard.
// Importing the same constant from a worker vs. the API guarantees they
// agree on enum names, header names, and TTL boundaries.

export const AEGIS_HEADER_API_KEY = 'X-AEGIS-API-Key' as const;
export const AEGIS_HEADER_VERIFY_KEY = 'X-AEGIS-Verify-Key' as const;
export const AEGIS_HEADER_REQUEST_ID = 'X-Request-Id' as const;
export const AEGIS_HEADER_TOKEN = 'X-AEGIS-Token' as const;
export const AEGIS_HEADER_SIGNATURE = 'X-AEGIS-Signature' as const;
export const AEGIS_HEADER_IDEMPOTENCY = 'Idempotency-Key' as const;

// Trust band thresholds — exposed so relying parties can use the same logic
// AEGIS uses, without round-tripping the band classification.
export const TRUST_BAND_THRESHOLDS = {
  PLATINUM: 750,
  VERIFIED: 500,
  WATCH: 250,
  FLAGGED: 0,
} as const;

// Token TTL boundaries (seconds). Hard upper bound enforced server-side.
export const TOKEN_TTL_MIN_SECONDS = 30;
export const TOKEN_TTL_MAX_SECONDS = 60;
export const POLICY_TTL_MAX_DAYS = 365;

// Trial-cliff UX thresholds — Round 24. AEGIS has two independent trial
// cliffs that both surface a banner on the dashboard before the user hits
// the hard `TRIAL_EXHAUSTED` denial:
//
//   1. **Counter trial** (FREE tier, 10K lifetime verifies per ADR-0014).
//      Warn when `trialUsedCount / trialCap` is at or above this percent.
//   2. **Stripe time trial** (paid tier with `trial_period_days` set on
//      the Stripe product). Warn when `stripeTrialEndsAt` is within this
//      many days. Stripe itself emits `customer.subscription.trial_will_end`
//      exactly 3 days before, but we pre-warn earlier to give the operator
//      time to update card details without urgency.
//
// Both constants are part of the cross-package parity contract — the
// dashboard imports them so the API + dashboard never disagree on when
// the banner should appear.
export const TRIAL_WARN_THRESHOLD_PERCENT = 80;
export const TRIAL_WARN_THRESHOLD_DAYS = 7;

// Verify-response cache TTL — how long a relying party may cache a 200 result.
export const VERIFY_RESULT_DEFAULT_TTL_SECONDS = 30;

// Cache key prefixes — keep in sync with apps/api/src/common/redis/* usage.
export const REDIS_KEY = {
  agent: (id: string) => `agent:${id}`,
  agentTrust: (id: string) => `agent:${id}:trust`,
  policy: (id: string) => `policy:${id}`,
  spendDay: (policyId: string, dateKey: string) => `spend:${policyId}:day:${dateKey}`,
  spendMonth: (policyId: string, monthKey: string) => `spend:${policyId}:month:${monthKey}`,
  apiKey: (hash: string) => `apikey:${hash}`,
  verifyResult: (tokenHash: string, action: string) => `verify:${tokenHash}:${action}`,
  rpReport: (rpId: string, dateKey: string) => `rp:${rpId}:reports:${dateKey}`,
} as const;

// Webhook event names — clients subscribe to these strings.
export const WEBHOOK_EVENT = {
  AGENT_TRUST_SCORE_CHANGED: 'aegis.agent.trust_score_changed',
  AGENT_ANOMALY_DETECTED: 'aegis.agent.anomaly_detected',
  AGENT_POLICY_EXPIRED: 'aegis.agent.policy_expired',
  AGENT_FLAGGED_BY_RELYING_PARTY: 'aegis.agent.flagged_by_relying_party',
  AGENT_REVOKED: 'aegis.agent.revoked',
} as const;

export type WebhookEvent = (typeof WEBHOOK_EVENT)[keyof typeof WEBHOOK_EVENT];

// Denial reason precedence (top wins). Public API contract — see SECURITY.md
// + ADR-0004. The order is part of the wire-level contract: relying parties
// build retry / escalation logic on it. Adding new reasons is non-breaking
// only when they go at the END of this list.
//
// PLAN_LIMIT_EXCEEDED is listed first because it fires as a billing pre-gate
// BEFORE the security algorithm chain — it never competes with the 10-step
// algorithm reasons. Relying parties receiving this code should direct the
// user to upgrade their AEGIS plan, not retry the request.
//
// TRIAL_EXHAUSTED was added 2026-05-05 per ADR-0014 (free-trial design).
// It sits between SCOPE_NOT_GRANTED and SPEND_LIMIT_EXCEEDED because trial
// exhaustion is a billing-tier gate that fires after the agent + policy
// have been validated but before any spend accounting — a trial principal
// has no "spend limit" in the policy sense; their cap is the lifetime
// verify counter. HTTP 402 (Payment Required).
export const DENIAL_REASON_PRECEDENCE = [
  'PLAN_LIMIT_EXCEEDED', // billing gate — pre-algorithm; not part of the 10-step chain
  'AGENT_NOT_FOUND',
  'AGENT_REVOKED',
  'INVALID_SIGNATURE',
  'POLICY_REVOKED',
  'POLICY_EXPIRED',
  'SCOPE_NOT_GRANTED',
  'TRIAL_EXHAUSTED',
  'SPEND_LIMIT_EXCEEDED',
  'TRUST_SCORE_TOO_LOW',
  'ANOMALY_FLAGGED',
] as const;

export type DenialReason = (typeof DENIAL_REASON_PRECEDENCE)[number];

/**
 * Rank of a denial reason in the precedence — `0` is the highest priority.
 * Returns `Number.POSITIVE_INFINITY` for unknown reasons (forward-compat for
 * relying-party SDKs that haven't upgraded to recognize a newly-added reason).
 *
 * Use case: when relying parties want to compare two reasons (e.g. to log
 * the strictest one across a multi-call workflow) without re-implementing
 * the ordering. Algorithm code SHOULD NOT depend on this for control flow —
 * the algorithm enforces precedence by the order of its checks. This is for
 * downstream consumers only.
 */
export function denialReasonRank(reason: string): number {
  const idx = (DENIAL_REASON_PRECEDENCE as readonly string[]).indexOf(reason);
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

/**
 * Returns the higher-precedence (top-of-list) reason. When either input is
 * unknown the known one wins; when both are unknown the first wins.
 */
export function moreSeverDenialReason(a: DenialReason, b: DenialReason): DenialReason {
  return denialReasonRank(a) <= denialReasonRank(b) ? a : b;
}
