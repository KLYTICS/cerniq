// BATE anomaly detector — public types and frozen rule thresholds.
//
// These types describe the input/output shape every rule must agree on
// and the named thresholds that gate each rule. Thresholds live here
// (not inside individual rule files) so the operator can review every
// dial in one place. Bumping a threshold is a one-file edit.
//
// Pure types + constants. No NestJS, no DI, no I/O — same posture as
// `bate.weights.ts`. The detector itself is `@Injectable()` so Nest can
// construct it, but `evaluate()` on each rule is pure and side-effect-
// free (CLAUDE.md invariant #2: verify hot path stays portable).

import type { BateSignalType, SignalSeverity } from '@prisma/client';

/** Rule identifiers. Stable strings — used in audit logs and metrics. */
export type RuleId = 'R-1' | 'R-2' | 'R-3' | 'R-4' | 'R-5';

/**
 * Anomaly signal types this detector can emit. Subset of BateSignalType
 * restricted to the negative anomaly signals R-1..R-5 are responsible
 * for. Encoded as a literal-union (not a runtime narrow) so the
 * compiler enforces 1:1 rule-to-signal mapping.
 */
export type AnomalySignalType = Extract<
  BateSignalType,
  | 'VELOCITY_ANOMALY'
  | 'GEOGRAPHIC_INCONSISTENCY'
  | 'SPEND_PATTERN_DEVIATION'
  | 'FAILED_VERIFY_SPIKE'
  | 'DELEGATION_CHAIN_ANOMALY'
>;

/** A single observed verify call, distilled to the fields rules care about. */
export interface VerifyObservation {
  timestamp: Date;
  decision: 'APPROVED' | 'DENIED';
  denialReason: string | null;
  requestIp?: string;
  requestCountry?: string;
  requestedAmount: number | null;
}

/** Snapshot of a delegation chain at the time of the trigger event. */
export interface DelegationSnapshot {
  depth: number;
  rootPrincipalId: string;
}

/**
 * Pre-fetched window of evidence the worker hands to every rule. Rules
 * read this and decide; they never go to the DB themselves. This keeps
 * `evaluate()` a pure function.
 */
export interface AnomalyInput {
  agentId: string;
  agentPrincipalId: string;
  recentVerifies: VerifyObservation[];
  /** Trailing 30 days of approved-spend amounts for this agent. */
  spendHistory: { amount: number; timestamp: Date }[];
  delegationChain?: DelegationSnapshot | null;
}

/**
 * One anomaly the detector wants the BATE worker to ingest as a signal.
 * `signalType` is constrained to the negative-anomaly subset so the
 * type system rejects an accidental positive-signal emission.
 */
export interface AnomalyEvent {
  rule: RuleId;
  signalType: AnomalySignalType;
  severity: SignalSeverity;
  /** Rule-specific evidence (window size, distinct count, etc.). */
  payload: Record<string, unknown>;
}

/** A pure rule. Detector composes one of these per RuleId. */
export interface Rule {
  readonly id: RuleId;
  evaluate(input: AnomalyInput): AnomalyEvent[];
}

// ---------------------------------------------------------------------------
// Thresholds — frozen constants. Single source of truth.
// OPERATOR INPUT NEEDED: these are conservative defaults. Operator should
// review each dial against production traffic before going live (see
// docs/BATE_ALGORITHM.md and OPERATOR_DECISIONS.md).
// ---------------------------------------------------------------------------

/** R-1 Velocity. */
export const R1_WINDOW_MS = 60_000; // 1 minute sliding window
export const R1_MAX_VERIFIES_PER_WINDOW = 100;

/** R-2 Geographic. */
export const R2_WINDOW_MS = 5 * 60_000; // 5 minutes
export const R2_MIN_DISTINCT_ORIGINS = 3;
/** Bits to keep when bucketing IPv4 addresses for "/16 prefix" comparison. */
export const R2_IPV4_PREFIX_BITS = 16;

/** R-3 Spend pattern. */
export const R3_MEAN_MULTIPLIER = 5; // > 5× 30-day mean
export const R3_PERCENTILE = 0.95; // > p95 of agent history
/** Minimum history length before R-3 is willing to fire — avoids false
 *  positives on the agent's first transactions. */
export const R3_MIN_HISTORY_SIZE = 5;

/** R-4 Failed verify spike. */
export const R4_WINDOW_MS = 10 * 60_000; // 10 minutes
export const R4_MIN_DENIALS = 5;

/** R-5 Delegation chain. */
export const R5_MAX_CHAIN_DEPTH = 3;

/** Stable evaluation order. Detector iterates this exact list. */
export const RULE_ORDER: readonly RuleId[] = Object.freeze([
  'R-1',
  'R-2',
  'R-3',
  'R-4',
  'R-5',
]);
