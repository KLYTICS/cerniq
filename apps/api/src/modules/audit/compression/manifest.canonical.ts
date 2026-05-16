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
 *  header) — the kid is committed to the signed bytes, so any mismatch
 *  collapses to `invalid_signature` and an attacker cannot redirect
 *  verification at a foreign key. Pass `null` to signal "kid not in
 *  the published JWKS" so this function short-circuits with
 *  `unknown_signing_key` and callers don't duplicate that branch. */
export async function verifyManifest(
  signed: SignedAuditCompressionManifest,
  publicKeyB64Url: string | null,
): Promise<ManifestVerifyResult> {
  if (signed.signatureAlg !== 'ed25519') {
    return { ok: false, reason: 'wrong_alg' };
  }
  if (publicKeyB64Url === null) {
    return { ok: false, reason: 'unknown_signing_key' };
  }
  // Decoding caller-supplied base64url can fail (attacker-controlled
  // signature, operator-misconfigured pubkey). canonicalJson of a typed
  // body cannot fail and so does not need its own catch — drop drift
  // between "what the union promises" and "what we actually surface".
  let sigBytes: Uint8Array;
  let pubBytes: Uint8Array;
  try {
    sigBytes = decodeBase64Url(signed.signatureB64Url);
    pubBytes = decodeBase64Url(publicKeyB64Url);
  } catch {
    return { ok: false, reason: 'malformed_body' };
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
