// Sign / verify primitives for SignedIntentManifest. Pattern-locked to
// @aegis/audit-verifier — same canonical pre-image discipline, same
// Ed25519 over @noble/* (one curve, one library, audited — CLAUDE.md root).
//
// SECURITY NOTES (read before extending):
//   1. The canonical pre-image is `canonicalize(body)`, NO domain separator
//      yet. If future intent manifests share a key with audit manifests we
//      MUST add a domain-separation byte ("intent-v1:" prefix) to prevent
//      cross-protocol signature substitution. Document this in an ADR
//      before that key-sharing arrangement ships.
//   2. signingKeyId is part of the signed body via inclusion in the
//      SignedIntentManifest wrapper field — but ONLY the body bytes are
//      signed. The kid is bound to verification (verifier looks up the
//      key by kid), so a wrong-kid attacker simply fails signature
//      verification. This matches audit-verifier semantics.
//   3. NO async validation here. Caller MUST pre-validate the body shape
//      (e.g. via @aegis/types Zod schema, once published). This package
//      stays framework-free.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

import { canonicalize, decodeBase64Url, encodeBase64Url } from './canonical.js';
import type { IntentManifestBody, SignedIntentManifest } from './types.js';

// Wire the @noble/ed25519 sync hash hook once at module load. Same pattern
// as audit-verifier; necessary for synchronous sign/verify in environments
// (CF Workers, Deno) where the dynamic sha512 import is too slow.
type EdInternal = { etc: { sha512Sync: (...m: Uint8Array[]) => Uint8Array } };
(ed as unknown as EdInternal).etc.sha512Sync = (...m: Uint8Array[]) =>
  sha512(concatBytes(...m));

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/** Bytes that will be signed/verified. Stable across runtimes. */
export function manifestPreimage(body: IntentManifestBody): Uint8Array {
  return new TextEncoder().encode(canonicalize(body));
}

/**
 * Sign an IntentManifestBody. Returns the wire-shape wrapper. Caller is
 * responsible for distributing the signed manifest alongside the verify
 * token; the relying party verifies with `verifyManifest(...)` below.
 *
 * @param body — fully-formed IntentManifestBody (validate upstream).
 * @param privateKey — 32-byte Ed25519 secret. NEVER persist; AEGIS holds
 *                     the signer key, never the agent key.
 * @param signingKeyId — kid for the public key (rotation-aware).
 */
export function signManifest(
  body: IntentManifestBody,
  privateKey: Uint8Array,
  signingKeyId: string,
): SignedIntentManifest {
  if (privateKey.length !== 32) {
    throw new Error(`signManifest: privateKey must be 32 bytes, got ${privateKey.length}`);
  }
  const sig = ed.sign(manifestPreimage(body), privateKey);
  return {
    body,
    signingKeyId,
    signatureB64Url: encodeBase64Url(sig),
  };
}

export type VerifyFailure =
  | 'invalid_signature'
  | 'unknown_signing_key'
  | 'malformed_signature'
  | 'wrong_kid_for_key';

export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: VerifyFailure; detail?: string };

/**
 * Verify a SignedIntentManifest against a key bag indexed by kid.
 * Stateless — does NOT check expiry, ttl, principal, or anything semantic.
 * That's the reconciler's job; this is signature integrity only.
 */
export function verifyManifest(
  signed: SignedIntentManifest,
  publicKeysByKid: Readonly<Record<string, Uint8Array>>,
): VerifyResult {
  const pub = publicKeysByKid[signed.signingKeyId];
  if (!pub) return { valid: false, reason: 'unknown_signing_key', detail: signed.signingKeyId };
  if (pub.length !== 32) {
    return { valid: false, reason: 'wrong_kid_for_key', detail: `pub key ${pub.length}b ≠ 32` };
  }
  let sig: Uint8Array;
  try {
    sig = decodeBase64Url(signed.signatureB64Url);
  } catch {
    return { valid: false, reason: 'malformed_signature' };
  }
  if (sig.length !== 64) {
    return { valid: false, reason: 'malformed_signature', detail: `${sig.length}b ≠ 64` };
  }
  const ok = ed.verify(sig, manifestPreimage(signed.body), pub);
  if (!ok) return { valid: false, reason: 'invalid_signature' };
  return { valid: true };
}
