// Manifest verification — the offline-portable surface for AEGIS audit
// compression (ADR-0015 / WORK_BOARD M-036).
//
// Why this lives here:
//   `@aegis/audit-verifier` is the designated home for "any third party
//   with the AEGIS audit JWKS can independently verify the tamper-evidence
//   of an AEGIS audit log export." Audit compression rolls up
//   `AuditEvent` rows into signed Parquet+manifest pairs; this module
//   verifies the *manifest* half of the corpus — the row half is
//   covered by `./chain.ts`'s `verifyChain`.
//
// What this module gives a relying party:
//   - Verify the signature on a single manifest (Ed25519 over canonical
//     JSON of the body).
//   - Walk an ordered per-slice sequence of manifests and detect:
//     missing manifests (chain holes), reordering, slice swaps,
//     non-monotonic seqs, and row-chain anchor breaks across manifest
//     boundaries.
//   - All without ever decoding the Parquet file. The Parquet's
//     `parquetSha256B64Url` digest is checked separately by the corpus
//     verifier (out of scope for Phase 0 — gated on OD-017 / parquet
//     library landing).
//
// Runtime: ZERO `node:crypto` use. Lives on top of `@noble/hashes/sha256`
// and `@noble/ed25519`, which already power the row-chain verifier.
// Runs on Node, Bun, Deno, Workers, Browsers — anywhere `atob`/`btoa`
// are defined (i.e. everywhere).
//
// Parity contract: `canonicalize` here MUST produce byte-identical
// output to `apps/api/src/modules/audit/compression/manifest.canonical.ts`
// (which in turn matches `apps/api/src/common/crypto/audit-chain.util.ts`).
// Cross-package parity is guarded by
// `tests/cross-package/audit-manifest-parity.spec.ts`.

import { sha256 } from '@noble/hashes/sha256';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

import {
  canonicalize,
  decodeBase64Url,
  encodeBase64Url,
  utf8,
} from './canonical.js';

// `@noble/ed25519` v2 wants a host sha512 wired once. The chain module
// already does this, but importing it here would create a load-order
// coupling; doing it locally is idempotent and self-contained.
ed.etc.sha512Sync = (...m): Uint8Array => sha512(ed.etc.concatBytes(...m));

// -------------------------------------------------------------------------
// Public types — mirror of apps/api's manifest.types.ts for the wire shape.
// -------------------------------------------------------------------------

/** Sentinel slice id for events that don't get a per-tenant slice. */
export const GLOBAL_SLICE = 'global' as const;

/** Prefix used at slice genesis to make manifest hashes
 *  unambiguously distinct from row-chain hashes. */
export const MANIFEST_GENESIS = 'AEGIS-AUDIT-COMPRESS-MANIFEST-GENESIS-v1' as const;

export type CompressionTier = 'warm' | 'cold';
export type SliceStrategy = 'per-tenant' | 'global' | 'hybrid';
export type ManifestSignatureAlg = 'ed25519';

/** Manifest body — the bytes that get canonicalized and signed. */
export interface AuditCompressionManifestBody {
  v: 1;
  manifestId: string;
  tenantSliceId: string;
  sliceStrategy: SliceStrategy;
  firstSeq: number;
  lastSeq: number;
  firstEventId: string;
  lastEventId: string;
  firstChainHashB64Url: string | null;
  lastChainHashB64Url: string;
  prevManifestId: string | null;
  prevManifestHashB64Url: string;
  rowCount: number;
  bytesUncompressed: number;
  bytesCompressed: number;
  zstdLevel: number;
  tier: CompressionTier;
  parquetSha256B64Url: string;
  parquetObjectKey: string;
  createdAt: string;
  signingKeyId: string;
  retentionFloorDays: number;
  payloadVersionMin: number;
  payloadVersionMax: number;
}

export interface SignedAuditCompressionManifest {
  body: AuditCompressionManifestBody;
  signatureB64Url: string;
  signatureAlg: ManifestSignatureAlg;
}

export type ManifestVerifyFailure =
  | 'invalid_signature'
  | 'wrong_alg'
  | 'malformed_body'
  | 'malformed_signature'
  | 'malformed_public_key'
  | 'kid_mismatch'
  | 'unknown_signing_key';

export type ManifestVerifyResult =
  | { ok: true }
  | { ok: false; reason: ManifestVerifyFailure };

export type ChainWalkFailure =
  | 'prev_hash_mismatch'
  | 'slice_mismatch'
  | 'seq_not_monotonic'
  | 'row_chain_break'
  | 'empty_input';

export type ChainWalkResult =
  | { ok: true; verified: number }
  | { ok: false; failedAtIndex: number; reason: ChainWalkFailure };

// -------------------------------------------------------------------------
// Manifest primitives.
// -------------------------------------------------------------------------

/** sha256(canonicalize(body)), base64url. The primitive both manifest
 *  signing and `prevManifestHashB64Url` are built on. */
export function hashManifestBody(body: AuditCompressionManifestBody): string {
  return encodeBase64Url(sha256(utf8(canonicalize(body))));
}

/** sha256 of an arbitrary value's canonical-JSON form, base64url. */
export function canonicalSha256B64Url(value: unknown): string {
  return encodeBase64Url(sha256(utf8(canonicalize(value))));
}

/** Compute the `prevManifestHashB64Url` for a manifest whose
 *  predecessor (in the same slice) is `prev`. `prev=null` → slice
 *  genesis → `sha256(MANIFEST_GENESIS)`. */
export function prevManifestHash(
  prev: AuditCompressionManifestBody | null,
): string {
  if (prev === null) return encodeBase64Url(sha256(utf8(MANIFEST_GENESIS)));
  return hashManifestBody(prev);
}

/** Row-chain anchor: sha256(sigBytes || idUtf8), base64url. Mirrors
 *  `AuditChainUtil.prevHash` for the `(id, sig)` branch — lets a
 *  manifest verifier reconstruct what the row-chain anchor SHOULD be
 *  at a given row, given the row's signature + id from the chain. */
export function rowChainAnchor(
  rowId: string,
  rowSignatureB64Url: string,
): string {
  const sigBytes = decodeBase64Url(rowSignatureB64Url);
  const idBytes = utf8(rowId);
  const concat = new Uint8Array(sigBytes.length + idBytes.length);
  concat.set(sigBytes, 0);
  concat.set(idBytes, sigBytes.length);
  return encodeBase64Url(sha256(concat));
}

/** Verify a single signed manifest. Pubkey resolution is the caller's
 *  job (look up `signed.body.signingKeyId` in the published JWKS).
 *  Pass `null` to signal "kid not found" — short-circuits with
 *  `unknown_signing_key`.
 *
 *  Optional `expectedKid` lets the caller assert the manifest is
 *  signed by a specific key id, hard-failing with `kid_mismatch`
 *  BEFORE any base64url decode or Ed25519 verify. Without it, a
 *  wrong-kid pubkey would already collapse to `invalid_signature`
 *  (the kid is committed to the signed bytes) — but `kid_mismatch`
 *  is a cleaner failure reason for callers that *know* which kid
 *  they're expecting (rotation pinning, audit-chain replay defense).
 *
 *  Caller contract: the pubkey MUST be the one published for
 *  `signed.body.signingKeyId`. Decode failures are split:
 *    - bad signature bytes → `malformed_signature` (caller / attacker
 *      controlled — the signature came from the manifest file)
 *    - bad pubkey bytes → `malformed_public_key` (operator controlled
 *      — the pubkey came from the JWKS the operator published)
 *
 *  This mirrors `apps/api/src/modules/audit/compression/manifest.canonical.ts`
 *  exactly. Cross-package parity is guarded by
 *  `tests/cross-package/audit-manifest-parity.spec.ts`. */
export async function verifyManifest(
  signed: SignedAuditCompressionManifest,
  publicKeyB64Url: string | null,
  expectedKid?: string,
): Promise<ManifestVerifyResult> {
  if (signed.signatureAlg !== 'ed25519') {
    return { ok: false, reason: 'wrong_alg' };
  }
  // Kid-pinning check runs BEFORE pubkey/sig decode so a mismatched
  // expected kid never even reaches the crypto layer. Defensive
  // short-circuit that callers can opt into.
  if (expectedKid !== undefined && expectedKid !== signed.body.signingKeyId) {
    return { ok: false, reason: 'kid_mismatch' };
  }
  if (publicKeyB64Url === null) {
    return { ok: false, reason: 'unknown_signing_key' };
  }
  let sigBytes: Uint8Array;
  try {
    sigBytes = decodeBase64Url(signed.signatureB64Url);
  } catch {
    return { ok: false, reason: 'malformed_signature' };
  }
  let pubBytes: Uint8Array;
  try {
    pubBytes = decodeBase64Url(publicKeyB64Url);
  } catch {
    return { ok: false, reason: 'malformed_public_key' };
  }
  const message = utf8(canonicalize(signed.body));
  let ok = false;
  try {
    ok = await ed.verifyAsync(sigBytes, message, pubBytes);
  } catch {
    return { ok: false, reason: 'invalid_signature' };
  }
  return ok ? { ok: true } : { ok: false, reason: 'invalid_signature' };
}

/** Walk a per-slice ordered sequence of *already signature-verified*
 *  manifests and confirm the manifest chain + row-chain anchors are
 *  internally consistent.
 *
 *  CALLER CONTRACT: every manifest passed in MUST have had
 *  `verifyManifest` return `{ ok: true }` first. Without that, an
 *  attacker who edits a manifest's `tenantSliceId` and re-derives the
 *  `prevManifestHashB64Url` for a different slice produces a
 *  structurally valid (but unsigned-for-this-slice) chain — only the
 *  signature binds the slice ↔ body bytes. */
export function walkManifestChain(
  manifests: readonly AuditCompressionManifestBody[],
): ChainWalkResult {
  if (manifests.length === 0) {
    return { ok: false, failedAtIndex: -1, reason: 'empty_input' };
  }

  const slice = manifests[0]!.tenantSliceId;
  let prevBody: AuditCompressionManifestBody | null = null;

  for (let i = 0; i < manifests.length; i++) {
    const m = manifests[i]!;

    if (m.tenantSliceId !== slice) {
      return { ok: false, failedAtIndex: i, reason: 'slice_mismatch' };
    }

    const expectedPrevHash = prevManifestHash(prevBody);
    if (m.prevManifestHashB64Url !== expectedPrevHash) {
      return { ok: false, failedAtIndex: i, reason: 'prev_hash_mismatch' };
    }

    if (prevBody !== null) {
      if (m.firstSeq <= prevBody.lastSeq) {
        return { ok: false, failedAtIndex: i, reason: 'seq_not_monotonic' };
      }
      if (
        m.firstChainHashB64Url === null ||
        m.firstChainHashB64Url !== prevBody.lastChainHashB64Url
      ) {
        return { ok: false, failedAtIndex: i, reason: 'row_chain_break' };
      }
    }

    prevBody = m;
  }

  return { ok: true, verified: manifests.length };
}
