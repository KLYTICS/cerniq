// Ports for the pure intent algorithm. Both the Nest adapter (this app)
// and a future CF Worker adapter (Phase 3, per ADR-0017 §Phasing) implement
// these. Keep the surface minimal — every additional port makes a future
// port harder.
//
// CLAUDE.md invariant #2: zero framework imports. Types only. The Nest
// adapter widens its Prisma + KMS + Redis types into this shape at the
// boundary.

import type {
  ActualCallObservation,
  IntentClaim,
  ReconciliationPolicy,
  ReconciliationResult,
  SignedIntentManifest,
} from '@aegis/intent-manifest';

// ────────────────────────────────────────────────────────────────────────
// Algorithm input/output shapes
// ────────────────────────────────────────────────────────────────────────

export interface IssueInput {
  principalId: string;
  agentId: string;
  verifyTokenJti: string;
  verifyTokenSha256B64Url: string;
  intent: IntentClaim;
  reconciliation?: ReconciliationPolicy;
  /** Manifest TTL in seconds. Clamped server-side to [30, 60] in Phase 2. */
  ttlSeconds?: number;
}

export interface IssueOutput {
  manifestId: string;
  signedManifest: SignedIntentManifest;
  expiresAt: number;
  /** Audit event id appended during issuance (intent.declared). */
  auditEventId: string;
}

export interface ReconcileInput {
  principalId: string;
  manifestId: string;
  idempotencyKey: string;
  actuals: readonly ActualCallObservation[];
}

export interface ReconcileOutput {
  /** From the framework-free reconciler. */
  result: ReconciliationResult;
  /** Audit event id appended during reconciliation (intent.reconciled). */
  auditEventId: string;
  /** Whether this call was an idempotency-key replay (returns the original result). */
  idempotencyReplay: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Stored manifest snapshot — what the repository hands back to the algorithm
// ────────────────────────────────────────────────────────────────────────

export type IntentStatus = 'OPEN' | 'RECONCILED' | 'EXPIRED';

export interface ManifestSnapshot {
  manifestId: string;
  principalId: string;
  agentId: string;
  signedManifest: SignedIntentManifest;
  status: IntentStatus;
  reconciledAt: Date | null;
  /** Cached prior reconciliation outcome — populated when status === 'RECONCILED'. */
  priorResult: ReconciliationResult | null;
}

// ────────────────────────────────────────────────────────────────────────
// Audit + BATE signal contract — framework-free shape
// ────────────────────────────────────────────────────────────────────────

export interface IntentAuditAppendInput {
  /** One of the three intent event kinds. */
  kind: 'intent.declared' | 'intent.reconciled' | 'intent.mismatch';
  principalId: string;
  agentId: string;
  manifestId: string;
  /** Free-form audit payload — algorithm-shaped, JSON-serializable. */
  payload: Record<string, unknown>;
}

export interface IntentBateSignalInput {
  agentId: string;
  /** Phase 2 introduces a single new BATE signal kind for intent mismatch. */
  signalType: 'INTENT_MISMATCH_OBSERVED';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  source: string;
  payload: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────
// Port interface — all algorithm I/O flows through this
// ────────────────────────────────────────────────────────────────────────

export interface IntentPorts {
  /**
   * Sign a manifest body using the AEGIS active signing key (KMS-backed
   * when wired via M-051; env fallback otherwise).
   * Returns the wire-shape SignedIntentManifest.
   * MUST throw on signing failure — never return a stub manifest.
   */
  signManifest(body: SignedIntentManifest['body']): Promise<SignedIntentManifest>;

  /**
   * Persist a freshly issued manifest. Returns the storage-assigned
   * manifestId (typically a ULID matching body.manifestId). Caller
   * pre-generates the id and passes it via body.manifestId — the
   * port's job is to durably store it.
   * MUST throw on collision (same manifestId) so the algorithm can
   * surface a 409.
   */
  saveManifest(snapshot: Omit<ManifestSnapshot, 'status' | 'reconciledAt' | 'priorResult'>): Promise<void>;

  /** Fetch a manifest by id. Returns null if not found. */
  loadManifest(manifestId: string): Promise<ManifestSnapshot | null>;

  /**
   * Append actuals + the reconciliation outcome atomically. Implementation
   * MUST honor idempotency-key (per-manifest scope): if a prior call
   * with the same key+manifestId+body succeeded, return its prior result
   * without re-running reconciliation. If same key+manifest BUT different
   * actuals body, throw IdempotencyConflict.
   *
   * Sets manifest status to RECONCILED on success.
   */
  saveReconciliation(
    manifestId: string,
    idempotencyKey: string,
    actuals: readonly ActualCallObservation[],
    result: ReconciliationResult,
  ): Promise<{ replay: boolean }>;

  /** Append an audit event. Returns the auditEventId. */
  recordAudit(event: IntentAuditAppendInput): Promise<string>;

  /** Fire-and-forget: emit a BATE signal on intent mismatch. */
  ingestSignal(signal: IntentBateSignalInput): void;

  /** Mandatory clock — deterministic for tests. */
  now(): Date;

  /**
   * Lifetime envelope: [min, max] seconds the manifest may live for.
   * Defaults clamp to packages/types TOKEN_TTL_{MIN,MAX}_SECONDS.
   * Implementation may widen for treasury vertical (OD-019).
   */
  ttlBounds(): { minSeconds: number; maxSeconds: number };
}

// ────────────────────────────────────────────────────────────────────────
// Typed algorithm-level failures — all surfaced via thrown error
// ────────────────────────────────────────────────────────────────────────

export type IntentAlgorithmError =
  | { kind: 'manifest_not_found'; manifestId: string }
  | { kind: 'manifest_expired'; manifestId: string }
  | { kind: 'manifest_reconciled'; manifestId: string } // terminal state
  | { kind: 'manifest_collision'; manifestId: string }
  | { kind: 'verify_token_already_used'; verifyTokenJti: string }
  | { kind: 'tenant_mismatch'; expectedPrincipalId: string; actualPrincipalId: string }
  | { kind: 'idempotency_conflict'; manifestId: string; idempotencyKey: string }
  | { kind: 'ttl_out_of_bounds'; requestedSeconds: number; minSeconds: number; maxSeconds: number }
  | { kind: 'signing_failed'; detail: string };

export class IntentAlgorithmException extends Error {
  constructor(public override readonly cause: IntentAlgorithmError) {
    super(`intent algorithm: ${cause.kind}`);
    this.name = 'IntentAlgorithmException';
  }
}
