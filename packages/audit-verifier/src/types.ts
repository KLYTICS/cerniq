// Public types for @cerniq/audit-verifier. The shape is intentionally
// stable at the wire boundary — adding fields is non-breaking, but
// renames or removals require a major version bump because external
// auditors will pin to a specific version of this package as part of
// their work-paper trail.

/** v2 redactable audit chain payload — the bytes that get signed.
 *  Mirrors `AuditChainPayload` in apps/api/src/common/crypto/audit-chain.util.ts.
 *  Don't add fields here without updating the signer; the canonicalization
 *  is byte-stable so any addition shifts every downstream signature. */
export interface AuditChainPayload {
  agentId: string;
  /** What the request claimed; never redactable. */
  claimedAgentId: string | null;
  principalId: string;
  decision: 'APPROVED' | 'DENIED' | 'FLAGGED';
  denialReason: string | null;
  policyId: string | null;
  trustScoreAtEvent: number;
  trustBandAtEvent: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  currency: string | null;
  timestamp: string;
  actionHash: string | null;
  relyingPartyHash: string | null;
  requestedAmountHash: string | null;
  policySnapshotHash: string | null;
  v: 2;
}

/** A single row from an CERNIQ audit export. The shape CERNIQ exposes
 *  on `/v1/audit-events/export` (NDJSON one row per line). */
export interface AuditEventRow {
  /** Unique event id (cuid). */
  eventId: string;
  /** Predecessor event id; null for the genesis row. */
  prevEventId: string | null;
  /** Predecessor signature (base64url); null for the genesis row. */
  prevSignature: string | null;
  /** Kid of the CERNIQ signing key that produced this row's signature. */
  signingKeyId: string;
  /** This row's Ed25519 signature, base64url. */
  signature: string;
  /** The signed payload bytes, post-canonicalization. */
  payload: AuditChainPayload;
}

/** RFC 7517 JWK for an Ed25519 public key — the shape published at
 *  /.well-known/audit-signing-key. */
export interface JwksKey {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string; // base64url-encoded 32-byte public key
  kid: string;
  use: 'sig';
  /** Optional ISO timestamps — informational, not required for verify. */
  rotated_at?: string;
  expires_at?: string;
}

export interface JwksDocument {
  keys: JwksKey[];
}

export interface VerifyChainOptions {
  /** JWKS — provide inline or pre-fetched. */
  jwks: JwksDocument;
  /** When true, abort on the first break and return early. Default true —
   *  you almost always want fail-fast for incident triage. Set false for
   *  forensic walks where you want every break enumerated. */
  failFast?: boolean;
  /** Cap the report's per-row detail to this many entries. The summary
   *  fields are always populated. Default 100. */
  maxRowDetail?: number;
}

export interface RowVerdict {
  index: number;
  eventId: string;
  signingKeyId: string;
  /** Did `verify(pubkey, signature, prev_hash || canonical(payload))` pass? */
  signatureValid: boolean;
  /** Did the prev_hash reconstruct match what the signer would have used? */
  chainLinkValid: boolean;
  /** Human description when either gate failed. */
  reason?: string;
}

export interface RotationEvent {
  /** Index into the input stream where the kid changed. */
  atIndex: number;
  fromKid: string;
  toKid: string;
}

export interface ChainReport {
  valid: boolean;
  totalRows: number;
  /** Distinct kids referenced across the input. */
  signingKeys: string[];
  /** Points where the active kid changed. Useful for rotation audits. */
  rotationEvents: RotationEvent[];
  /** First failing row (when valid=false). null when chain is intact. */
  firstBreak: RowVerdict | null;
  /** Per-row detail capped by `maxRowDetail`. */
  rows: RowVerdict[];
  /** Wall-clock time spent verifying, milliseconds. Useful for SLA reports. */
  durationMs: number;
}
