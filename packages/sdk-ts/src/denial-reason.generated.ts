// @generated — do not edit; run pnpm gen:denial-reason
//
// Mirror of DENIAL_REASON_PRECEDENCE in packages/types/src/constants.ts.
// Order matches the canonical precedence (top-wins). Relying-party SDK
// consumers switch on this union to handle each denial reason.

export const DENIAL_REASONS = [
  "PLAN_LIMIT_EXCEEDED",
  "AGENT_NOT_FOUND",
  "AGENT_REVOKED",
  "INVALID_SIGNATURE",
  "POLICY_REVOKED",
  "POLICY_EXPIRED",
  "SCOPE_NOT_GRANTED",
  "TRIAL_EXHAUSTED",
  "SPEND_LIMIT_EXCEEDED",
  "TRUST_SCORE_TOO_LOW",
  "ANOMALY_FLAGGED",
] as const;

export type DenialReason = (typeof DENIAL_REASONS)[number];
