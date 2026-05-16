// Manifest chain — the *second* hash chain in the AEGIS audit system.
//
// Two chains compose:
//   1. The row chain (existing): `AuditEvent.aegisSignature` ↔ `prevHash`
//      composed of `(prevSig, prevId)`. Lives inside Postgres / parquet
//      rows.
//   2. The manifest chain (new): `Manifest.prevManifestHashB64Url`
//      composed of `sha256(canonicalJson(prev manifest body))`. Lives
//      across manifest files.
//
// They anchor into each other:
//   - `firstChainHashB64Url` / `lastChainHashB64Url` tie a manifest to
//     specific positions in the row chain (per slice).
//   - The next manifest's `prevManifestHashB64Url` ties manifests
//     together within a slice.
//
// A verifier walking *only* manifests + `/.well-known/audit-signing-key`
// can detect:
//   - missing manifest (hole) → chain hash mismatch on next manifest
//   - reordered manifests → chain hash mismatch
//   - forged manifest → signature failure
//   - tampered parquet → `parquetSha256B64Url` mismatch when reader
//     recomputes
//   - row chain break across a manifest boundary → next manifest's
//     `firstChainHashB64Url` ≠ prior manifest's `lastChainHashB64Url`
//     within the same slice
//
// This module is pure: no Nest, no IO, no env. All persistence /
// signing / object-store work lives in higher layers (gated on OD-017).

import { createHash } from 'node:crypto';
import { canonicalJson } from './manifest.canonical';
import {
  decodeBase64Url,
  encodeBase64Url,
} from '../../../common/crypto/ed25519.util';
import {
  type AuditCompressionManifestBody,
  MANIFEST_GENESIS,
} from './manifest.types';

const enc = new TextEncoder();

/** sha256(canonicalJson(body)) — the primitive `prevManifestHash` is
 *  computed over. base64url-encoded. */
export function hashManifestBody(body: AuditCompressionManifestBody): string {
  const bytes = enc.encode(canonicalJson(body));
  return encodeBase64Url(createHash('sha256').update(bytes).digest());
}

/** Compute the `prevManifestHashB64Url` field for a *new* manifest
 *  whose predecessor in the same slice is `prev`. Pass `prev=null` at
 *  slice genesis — the result is `sha256(MANIFEST_GENESIS)`. */
export function prevManifestHash(
  prev: AuditCompressionManifestBody | null,
): string {
  if (prev === null) {
    return encodeBase64Url(createHash('sha256').update(MANIFEST_GENESIS).digest());
  }
  return hashManifestBody(prev);
}

/** Compute the row-chain anchor for a row given its signature + id.
 *  Mirrors `AuditChainUtil.prevHash` for the (id, sig) case — but
 *  exposed as a pure function so the compressor can compute anchors
 *  without depending on the Nest class.
 *
 *  Returns base64url(sha256(sigBytes || idUtf8)). The parity spec in
 *  this directory cross-checks against the existing util. */
export function rowChainAnchor(
  rowId: string,
  rowSignatureB64Url: string,
): string {
  const sigBytes = decodeBase64Url(rowSignatureB64Url);
  const digest = createHash('sha256')
    .update(sigBytes)
    .update(rowId, 'utf8')
    .digest();
  return encodeBase64Url(digest);
}

/** Result of walking a manifest chain. `ok=false` reports the exact
 *  manifest index + failure mode so callers can drive alerting. */
export type ChainWalkResult =
  | { ok: true; verified: number }
  | { ok: false; failedAtIndex: number; reason: ChainWalkFailure };

export type ChainWalkFailure =
  | 'prev_hash_mismatch'
  | 'slice_mismatch'
  | 'seq_not_monotonic'
  | 'row_chain_break'
  | 'signature_invalid'
  | 'empty_input';

/** Walk a per-slice ordered sequence of *already signature-verified*
 *  manifests and confirm the manifest chain + row-chain anchors are
 *  internally consistent. This is a structural walk only — signature
 *  verification is the caller's responsibility (it depends on the
 *  signing-key lookup, which is an IO concern).
 *
 *  CALLER CONTRACT: every manifest passed in MUST have already had
 *  `verifyManifest` returned `{ ok: true }` for it. Without that, an
 *  attacker who swaps a manifest's `tenantSliceId` and re-derives the
 *  `prevManifestHashB64Url` for a different slice can produce a
 *  structurally valid (but unsigned-for-this-slice) chain. The
 *  signature is the only thing that binds slice ↔ body bytes.
 *
 *  Pre-conditions enforced:
 *    - non-empty input
 *    - all manifests share `tenantSliceId`
 *    - `firstSeq` of element i > `lastSeq` of element i-1 (strict)
 *    - `prevManifestHashB64Url` of element i == hash(body of i-1)
 *      (or sha256(MANIFEST_GENESIS) for i=0)
 *    - `firstChainHashB64Url` of element i (when non-null) ==
 *      `lastChainHashB64Url` of element i-1 (row chain anchor)
 */
export function walkManifestChain(
  manifests: readonly AuditCompressionManifestBody[],
): ChainWalkResult {
  if (manifests.length === 0) {
    return { ok: false, failedAtIndex: -1, reason: 'empty_input' };
  }

  const slice = manifests[0].tenantSliceId;
  let prevBody: AuditCompressionManifestBody | null = null;

  for (let i = 0; i < manifests.length; i++) {
    const m = manifests[i];

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
      // Row-chain anchor across the manifest boundary. Null on either
      // side means the row chain genuinely starts here (slice genesis),
      // which is only valid at i=0 — we're past that branch.
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
