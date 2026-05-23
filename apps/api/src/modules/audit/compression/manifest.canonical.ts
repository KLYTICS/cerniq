// Canonical-JSON serialization for audit-compression manifests.
//
// PARITY CONTRACT — the canonical bytes produced here must be
// byte-identical to those produced by `AuditChainUtil.canonicalize` in
// `apps/api/src/common/crypto/audit-chain.util.ts`. A spec in this
// directory cross-tests that property for any input — if either side
// drifts, the build fails before a single manifest ships.
//
// Why duplicate the algorithm instead of importing? Two reasons:
//   1. `AuditChainUtil` is a `@Injectable()` NestJS class. The
//      manifest layer is framework-free so it can be reused by
//      `packages/verifier-rp` (browser + edge runtimes — no Nest).
//   2. M-037 actively edits `audit-chain.util.ts`. A cross-module
//      dependency on its export surface would force merge coordination
//      on every M-037 change.
//
// Algorithm (RFC 8785-adjacent):
//   - Recursively sort object keys lexicographically (UTF-16 code-unit
//     order — what `Array.prototype.sort()` does by default — matches
//     the parity source-of-truth in `audit-chain.util.ts`).
//   - Arrays preserve element order; their members are canonicalized
//     individually.
//   - Primitives go through `JSON.stringify` directly (numbers, booleans,
//     null, strings get standard JSON escaping).
//   - No whitespace.
//
// We forbid the inputs JCS forbids (NaN, Infinity, undefined values)
// up at the type boundary — manifests are constructed from typed
// inputs, none of which can introduce these.

import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { decodeBase64Url, encodeBase64Url } from '../../../common/crypto/ed25519.util';
import type {
  AuditCompressionManifestBody,
  ManifestVerifyResult,
  SignedAuditCompressionManifest,
} from './manifest.types';

const enc = new TextEncoder();

/** Canonical-JSON of any JSON-serializable value. Identical algorithm
 *  to `AuditChainUtil.canonicalize` — guarded by the parity spec. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** sha256(canonical-JSON bytes), base64url-encoded. The primitive both
 *  manifest signing and the manifest chain hash are built on. */
export function canonicalSha256B64Url(value: unknown): string {
  const bytes = enc.encode(canonicalJson(value));
  return encodeBase64Url(createHash('sha256').update(bytes).digest());
}

/** Sign a manifest body. The sign callback matches
 *  `AuditSignerService.signRaw` — pass it through directly so KMS and
 *  env-backed signers both work without leaking private bytes. The
 *  caller is responsible for stamping `body.signingKeyId` *before*
 *  calling this (so the signed bytes commit to the kid). */
export async function signManifest(
  body: AuditCompressionManifestBody,
  signRaw: (msg: Uint8Array) => Promise<Uint8Array>,
): Promise<SignedAuditCompressionManifest> {
  const message = enc.encode(canonicalJson(body));
  const sig = await signRaw(message);
  return {
    body,
    signatureB64Url: encodeBase64Url(sig),
    signatureAlg: 'ed25519',
  };
}

/** Verify a signed manifest against a base64url-encoded ed25519 public
 *  key. Returns a typed result rather than throwing — failure paths
 *  drive metric labels and structured logs, not exceptions.
 *
 *  Caller contract for kid resolution: the caller MUST resolve the
 *  pubkey from `signed.body.signingKeyId` (not from any out-of-band
 *  header). The kid is committed to the signed bytes, so a mismatch
 *  would already collapse to `invalid_signature` — but `expectedKid`
 *  lets the caller declare which kid it *thinks* it resolved, and we
 *  hard-fail with `kid_mismatch` if the body disagrees. This is
 *  defense-in-depth: a future caller that accidentally resolves the
 *  pubkey from an out-of-band header fails loudly instead of silently
 *  routing through the crypto-failure label. Pass `undefined` to keep
 *  the legacy (no-assertion) behaviour.
 *
 *  Pass `publicKeyB64Url = null` to signal "kid not in the published
 *  JWKS" so this function short-circuits with `unknown_signing_key`
 *  and callers don't duplicate that branch.
 *
 *  Failure-reason taxonomy is *deliberately* split between caller and
 *  operator error surfaces (see `ManifestVerifyFailure`): bad sig →
 *  `malformed_signature` / `invalid_signature` (caller / attacker
 *  controlled), bad pubkey → `malformed_public_key` (operator
 *  controlled). Never conflate them — JWKS-rotation incidents must
 *  not look like tamper events in SIEM. */
export async function verifyManifest(
  signed: SignedAuditCompressionManifest,
  publicKeyB64Url: string | null,
  expectedKid?: string,
): Promise<ManifestVerifyResult> {
  if (signed.signatureAlg !== 'ed25519') {
    return { ok: false, reason: 'wrong_alg' };
  }
  if (publicKeyB64Url === null) {
    return { ok: false, reason: 'unknown_signing_key' };
  }
  if (expectedKid !== undefined && expectedKid !== signed.body.signingKeyId) {
    return { ok: false, reason: 'kid_mismatch' };
  }
  // Signature bytes are caller- (or attacker-) supplied; pubkey bytes
  // are operator-supplied (published JWKS). Separate catches AND
  // length checks so the failure-reason taxonomy preserves blame
  // attribution.
  //
  // The catches handle a strict-decoder migration (today's decoder
  // wraps Node's `Buffer.from(s, 'base64url')` which is permissive —
  // it strips invalid chars rather than throwing — but a future swap
  // to a strict decoder (e.g. `@noble/hashes/utils.base64urlnopad`)
  // would surface decode failures here).
  //
  // The length checks are the *active* gate today: Ed25519 signatures
  // are exactly 64 bytes and public keys are exactly 32 bytes. Anything
  // else is malformed — and since permissive base64url decoding can
  // silently produce wrong-length output for garbage input, the length
  // gate catches what the catch can't.
  const ED25519_SIG_LEN = 64;
  const ED25519_PUBKEY_LEN = 32;
  let sigBytes: Uint8Array;
  try {
    sigBytes = decodeBase64Url(signed.signatureB64Url);
  } catch {
    return { ok: false, reason: 'malformed_signature' };
  }
  if (sigBytes.length !== ED25519_SIG_LEN) {
    return { ok: false, reason: 'malformed_signature' };
  }
  let pubBytes: Uint8Array;
  try {
    pubBytes = decodeBase64Url(publicKeyB64Url);
  } catch {
    return { ok: false, reason: 'malformed_public_key' };
  }
  if (pubBytes.length !== ED25519_PUBKEY_LEN) {
    return { ok: false, reason: 'malformed_public_key' };
  }
  const message = enc.encode(canonicalJson(signed.body));
  let ok = false;
  try {
    ok = await ed.verifyAsync(sigBytes, message, pubBytes);
  } catch {
    return { ok: false, reason: 'invalid_signature' };
  }
  return ok ? { ok: true } : { ok: false, reason: 'invalid_signature' };
}

// Internal — recursive key sort. Matches the algorithm in
// `audit-chain.util.ts` (verified by `manifest.canonical.spec.ts`).
function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}
