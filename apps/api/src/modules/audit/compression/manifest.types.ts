// AEGIS audit-compression manifest — type contract.
//
// A manifest accompanies every Parquet rollup of `AuditEvent` rows. It
// stamps the chain anchors, the file digest, the prev-manifest pointer,
// and is itself signed with the AEGIS audit signing key (same key family
// as the row chain — see ADR-0011, ADR-0015).
//
// The manifest body is the *unsigned* shape: a canonical JCS-style JSON
// rendering of that body is what gets signed. The signature lives outside
// the body so verifiers can recompute the body's canonical bytes without
// having to know to skip a field.
//
// Stability: this is a wire / file-format type. Field renames and removals
// require a `v` bump and migration. Additions of *optional* fields at a
// minor `v` increment are allowed (verifiers ignore unknown fields by
// reading only declared ones from the canonical bytes — but see the
// parity spec for how this is guarded).

/** Sentinel slice id for events that don't get a per-tenant slice. */
export const GLOBAL_SLICE = 'global' as const;

/** Genesis manifest's prev-pointer. Matches the row chain's
 *  "AEGIS-AUDIT-GENESIS-v1" convention but distinct so a row hash can
 *  never collide with a manifest hash. */
export const MANIFEST_GENESIS = 'AEGIS-AUDIT-COMPRESS-MANIFEST-GENESIS-v1' as const;

/** Compression tier for the emitted parquet. Drives zstd level. */
export type CompressionTier = 'warm' | 'cold';

/** Slice strategy at seal time. Recorded in the manifest so a reader
 *  knows whether to expect homogenous principalId or mixed.            */
export type SliceStrategy = 'per-tenant' | 'global' | 'hybrid';

/** Signature algorithm used on the manifest body. Today only ed25519;
 *  ADR-0013 hybrid PQ would add `'ed25519+ml-dsa-65'`.                 */
export type ManifestSignatureAlg = 'ed25519';

/** Manifest body — the bytes that get canonicalized + signed.
 *
 *  Naming convention: snake_case on the wire is rejected to keep parity
 *  with the rest of the API surface (Zod schemas + DTOs are camelCase).
 *  Canonical-JSON sorts keys lexicographically; case is irrelevant to
 *  the byte stability of the output.                                 */
export interface AuditCompressionManifestBody {
  /** Schema version. v=1 is the Phase-0 contract. */
  v: 1;

  /** ULID. Unique per manifest, monotonic by time, sortable. */
  manifestId: string;

  /** `principal_<id>` for per-tenant slices, or 'global'. */
  tenantSliceId: string;

  /** Seal-time slice strategy — informational, not load-bearing. */
  sliceStrategy: SliceStrategy;

  /** First `AuditEvent.seq` covered by this file. Inclusive.
   *  Wire type is Postgres BIGSERIAL (int64); captured as JS `number`
   *  because we expect << 2^53 events per slice across product lifetime
   *  (≈ 285k years at 1 event / ms / slice). If this assumption ever
   *  drifts, migrate to `bigint` + a JSON-serialization shim and bump
   *  manifest schema `v`. */
  firstSeq: number;

  /** Last `AuditEvent.seq` covered by this file. Inclusive. See
   *  `firstSeq` for the JS-number cap rationale. */
  lastSeq: number;

  /** `AuditEvent.id` of the first row in this file. */
  firstEventId: string;

  /** `AuditEvent.id` of the last row. */
  lastEventId: string;

  /**
   * sha256(prev row signature bytes || prev row id utf8) for the row
   * immediately *before* `firstEventId`, encoded base64url. Null iff
   * `firstEventId` is the genesis row of the row chain.
   *
   * Anchors the manifest's first row into the live row chain — a
   * verifier recomputes this from the prior row's signature and rejects
   * a manifest whose first-row chain pointer does not match the file's
   * first parquet row.
   */
  firstChainHashB64Url: string | null;

  /** sha256(last row signature bytes || last row id utf8) for the last
   *  row in this file. Anchors the manifest's last row forward — the
   *  *next* manifest's `firstChainHashB64Url` must equal this value
   *  unless a tenant-slice boundary breaks the row chain (in hybrid
   *  slicing, anchors are *per slice*, not global). */
  lastChainHashB64Url: string;

  /** Previous manifest in the same slice. Null at slice genesis. */
  prevManifestId: string | null;

  /** sha256(JCS bytes of previous manifest body) — base64url.
   *  Equals sha256(MANIFEST_GENESIS) at slice genesis. */
  prevManifestHashB64Url: string;

  /** Number of audit rows packed in the parquet file. */
  rowCount: number;

  /** Uncompressed serialized size in bytes (before zstd). */
  bytesUncompressed: number;

  /** zstd-compressed parquet size in bytes (== file size on disk). */
  bytesCompressed: number;

  /** zstd compression level used. 3 for warm, 19 for cold by default. */
  zstdLevel: number;

  /** Compression tier at seal time. */
  tier: CompressionTier;

  /** base64url(sha256(parquet file bytes)). Detects bit-level tampering
   *  inside the parquet file even if the manifest signature is intact. */
  parquetSha256B64Url: string;

  /** Object-store key (or fs path) where the parquet lives. Advisory —
   *  verifiers may move objects, so a mismatch is not a sig failure. */
  parquetObjectKey: string;

  /** Manifest creation time, ISO-8601 UTC with `Z` suffix. */
  createdAt: string;

  /** Active AEGIS audit signing kid at seal time. Lets verifiers fetch
   *  the right pubkey from `/.well-known/audit-signing-key` even after
   *  key rotation. */
  signingKeyId: string;

  /** Retention floor recorded at seal time (days). Sweeper enforces
   *  `max(this, current plan retention)` so plan downgrades cannot
   *  shorten an already-promised retention window. */
  retentionFloorDays: number;

  /** Minimum and maximum `AuditEvent.payload.v` (audit row payload
   *  schema version) present in the file. Lets a verifier reject a
   *  file whose payloads predate its canonicalization rules. */
  payloadVersionMin: number;
  payloadVersionMax: number;
}

/** Signed manifest — the JSON shape persisted to object storage and
 *  to the `AuditCompressionManifest` table. Two top-level fields keep
 *  the signature trivially separable from the signed bytes. */
export interface SignedAuditCompressionManifest {
  /** The body whose canonical bytes were signed. */
  body: AuditCompressionManifestBody;
  /** Detached signature over `canonicalJson(body)`. base64url-encoded. */
  signatureB64Url: string;
  /** Signature algorithm. */
  signatureAlg: ManifestSignatureAlg;
}

/** Verification result. `ok=false` carries a typed reason so callers
 *  can attribute metric labels and emit structured logs without parsing
 *  string messages. */
export type ManifestVerifyResult =
  | { ok: true }
  | { ok: false; reason: ManifestVerifyFailure };

export type ManifestVerifyFailure =
  | 'invalid_signature'
  | 'wrong_alg'
  /** The signed body's shape itself failed validation — reserved for
   *  future shape-validators upstream of verify. Today this reason is
   *  never returned by `verifyManifest`; it remains in the union as the
   *  documented home for caller-side body-shape rejections. */
  | 'malformed_body'
  /** Caller-supplied signature bytes failed base64url decoding — the
   *  signature itself, not the body. Distinguished from
   *  `'invalid_signature'` (cryptographic mismatch) so attacker-supplied
   *  garbage signatures route to a different metric label than tamper. */
  | 'malformed_signature'
  /** Operator-supplied public key bytes failed base64url decoding —
   *  this is a JWKS misconfiguration, never a tamper signal. Routes
   *  separately so JWKS rotation incidents don't poison tamper alerts. */
  | 'malformed_public_key'
  /** The pubkey resolved by the caller belongs to a different kid than
   *  `body.signingKeyId` claims. Surfaces when the caller violates the
   *  kid-binding contract (e.g. looks up pubkey from an out-of-band
   *  header instead of from the signed body). */
  | 'kid_mismatch'
  | 'unknown_signing_key';
