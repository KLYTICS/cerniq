// BATE scoring weights — operator decision OD-001 (default until DECIDED).
//
// Source of truth: this file. `docs/BATE_ALGORITHM.md` mirrors these values
// in plain English. `OPERATOR_DECISIONS.md` row OD-001 tracks the decision
// state. If the operator updates the decision, change the table here, the
// doc, and the row in the same change.
//
// Versioning: bump `WEIGHTS_VERSION` whenever the table changes so the
// scoring history can be replayed against the exact weights of the day.
//
// Pure constants. No NestJS, no DI, no I/O — required so this module is
// importable from the Cloudflare Worker (CLAUDE.md invariant #2).

import type { BateSignalType, SignalSeverity, TrustBand } from '@prisma/client';

export const WEIGHTS_VERSION = 'v1.1.0-dpop-2026-05-02';

/**
 * Per-signal-occurrence delta. Applied for every occurrence of the signal
 * within the scoring window (subject to per-window caps below).
 */
export const SIGNAL_DELTA: Readonly<Record<BateSignalType, number>> = Object.freeze({
  // Positive
  CLEAN_TRANSACTION: 1,
  PRINCIPAL_KYC_VERIFIED: 25,
  CONSISTENT_GEOGRAPHY: 5,
  NORMAL_VELOCITY: 0, // handled via "7+ distinct days" bonus, not per-occurrence

  // Negative — RELYING_PARTY_FRAUD_REPORT uses severity table below, not this
  RELYING_PARTY_FRAUD_REPORT: 0,
  VELOCITY_ANOMALY: -50,
  GEOGRAPHIC_INCONSISTENCY: -30,
  SPEND_PATTERN_DEVIATION: -20,
  POLICY_VIOLATION_ATTEMPT: -75,
  FAILED_VERIFY_SPIKE: -40,
  DELEGATION_CHAIN_ANOMALY: -60,

  // ── DPoP — RFC 9449 / ADR-0010 (M-024) ────────────────────────────
  // AGENT_NO_DPOP: low-grade nudge while DPoP is optional (v1.0); when
  //   v1.1 makes DPoP mandatory, the absence becomes INVALID_SIGNATURE
  //   at verify time and this signal stops firing.
  // AGENT_DPOP_REPLAY_ATTEMPT: same DPoP `jti` seen twice within the 90s
  //   window. Strong indicator of credential exfiltration.
  AGENT_NO_DPOP: -15,
  AGENT_DPOP_REPLAY_ATTEMPT: -200,
});

/**
 * Severity table for RELYING_PARTY_FRAUD_REPORT signals.
 * Verified relying parties are weighted up to 1.5× (see RELYING_PARTY_WEIGHT_CAP).
 */
export const FRAUD_REPORT_SEVERITY_PENALTY: Readonly<Record<SignalSeverity, number>> = Object.freeze({
  LOW: -25,
  MEDIUM: -100,
  HIGH: -250,
  CRITICAL: -500,
});

/**
 * Per-scoring-window caps. Prevent any one signal type from dominating a
 * recompute. The sum of (occurrences × delta) is clamped to ±cap.
 */
export const PER_TYPE_CAP_PER_WINDOW: Readonly<Record<BateSignalType, number>> = Object.freeze({
  CLEAN_TRANSACTION: 20,
  PRINCIPAL_KYC_VERIFIED: 25,
  CONSISTENT_GEOGRAPHY: 5,
  NORMAL_VELOCITY: 10,

  RELYING_PARTY_FRAUD_REPORT: 500, // a single CRITICAL is allowed to dominate
  VELOCITY_ANOMALY: 200,
  GEOGRAPHIC_INCONSISTENCY: 120,
  SPEND_PATTERN_DEVIATION: 80,
  POLICY_VIOLATION_ATTEMPT: 300,
  FAILED_VERIFY_SPIKE: 200,
  DELEGATION_CHAIN_ANOMALY: 240,

  // DPoP per-window caps. NO_DPOP can fire often during the v1.0→v1.1
  // transition; cap it tight so it doesn't dominate. REPLAY_ATTEMPT is
  // catastrophic; cap permits a single occurrence to drive an agent below
  // WATCH band on its own.
  AGENT_NO_DPOP: 60,
  AGENT_DPOP_REPLAY_ATTEMPT: 600,
});

/** Bonus when an agent has run on at least N distinct days without anomalies. */
export const NORMAL_VELOCITY_DISTINCT_DAYS_THRESHOLD = 7;
export const NORMAL_VELOCITY_BONUS = 10;

/** Tenure / age cohort bonus, in score points per day, capped. */
export const AGE_COHORT_POINTS_PER_DAY = 0.5;
export const AGE_COHORT_CAP = 100; // → max bonus reached at 200 days.

/** Trust band cutoffs (score → band). Inclusive lower bound. */
export const TRUST_BAND_CUTOFFS: ReadonlyArray<{ min: number; band: TrustBand }> = Object.freeze([
  { min: 750, band: 'PLATINUM' },
  { min: 500, band: 'VERIFIED' },
  { min: 250, band: 'WATCH' },
  { min: 0, band: 'FLAGGED' },
]);

/** Hard score floor / ceiling. */
export const SCORE_FLOOR = 0;
export const SCORE_CEILING = 1000;

/**
 * Multiplier applied to fraud reports based on the reporting relying
 * party's `RelyingParty.reportWeight`. Caps prevent a single trusted
 * source from being used to grief.
 */
export const RELYING_PARTY_WEIGHT_FLOOR = 0.25;
export const RELYING_PARTY_WEIGHT_CAP = 1.5;
