// Cross-package interop — @aegis/intent-manifest signer ↔ @aegis/audit-verifier primitives.
//
// Why this exists (load-bearing):
//   intent-manifest's manifest.spec.ts header (lines 1-4) documents:
//     "These tests are pattern-locked to packages/audit-verifier/
//      src/manifest.spec.ts and intentionally cover the same surfaces,
//      because future cross-package parity tests will treat the two
//      manifest kernels as alternate signature producers."
//
//   This spec is that "future cross-package parity test." Primitive
//   byte-parity is pinned by intent-manifest-canonical-parity.spec.ts
//   (commit 68e4cf6). This spec pins INTEGRATION: the COMPOSITION of
//   canonicalize + TextEncoder + Ed25519 must produce a signature that
//   verifies symmetrically across the two packages.
//
//   Specifically:
//     1. A SignedIntentManifest produced by intent-manifest's
//        `signManifest` must verify when the verifier reconstructs the
//        pre-image using audit-verifier's `canonicalize` primitive +
//        raw @noble/ed25519.verify.
//     2. A signature produced by raw @noble/ed25519.sign over a
//        pre-image reconstructed via audit-verifier's `canonicalize`
//        must be accepted by intent-manifest's `verifyManifest`.
//     3. Both packages' pre-image compositions yield byte-identical
//        bytes for the same body.
//     4. A tampered body fails verification under BOTH paths.
//
// Why composition matters beyond primitives:
//   intent-manifest/src/manifest.ts §SEC NOTE #1 contemplates a future
//   domain-separator prefix on the pre-image, to be added when the
//   same Ed25519 key signs both intent and audit manifests
//   (cross-protocol signature substitution defense). If that prefix
//   gets added on one side without the matching change to the
//   cross-package interop contract, primitive parity stays GREEN but
//   signed manifests silently fail to verify across the boundary.
//   That class of drift is what this spec catches.
//
//   When the operator ships a domain separator, this spec MUST be
//   updated as part of the same change to lock the new compose-shape
//   — otherwise it will fail loudly, which is the desired behavior:
//   the failure forces an explicit decision about how the audit-side
//   reconstruction path must change to stay compatible.
//
// What this spec DOES NOT cover:
//   - Ed25519 determinism / @noble/* correctness — covered per-package
//     in each package's own manifest.spec.ts.
//   - Reconciliation logic — covered in
//     packages/intent-manifest/src/reconcile.spec.ts.
//   - audit-verifier's audit-compression manifest verify path — that
//     is governed by tests/cross-package/audit-manifest-parity.spec.ts.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { describe, expect, it } from 'vitest';

import {
  canonicalize as avCanonicalize,
  decodeBase64Url as avDecodeBase64Url,
  encodeBase64Url as avEncodeBase64Url,
} from '../../packages/audit-verifier/src/canonical';
import {
  manifestPreimage,
  signManifest,
  verifyManifest,
} from '../../packages/intent-manifest/src/manifest';
import type { IntentManifestBody } from '../../packages/intent-manifest/src/types';

// Re-wire @noble/ed25519's sync hash hook in this test file too.
// intent-manifest/src/manifest.ts wires it at module load, but if
// pnpm's hoist/dedupe ever produces a separate @noble/ed25519
// instance for the tests/ workspace, the hook set by manifest.ts
// would not apply to ed.sign/ed.verify called directly here.
// Setting the hook twice is idempotent (same function semantics).
type EdInternal = { etc: { sha512Sync: (...m: Uint8Array[]) => Uint8Array } };
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
(ed as unknown as EdInternal).etc.sha512Sync = (...m: Uint8Array[]) =>
  sha512(concatBytes(...m));

// Deterministic fixture key. Non-random for reproducibility — the
// test does not validate randomness, it validates composition.
const FIXED_PRIV = new Uint8Array(32).fill(11);
const FIXED_PUB = ed.getPublicKey(FIXED_PRIV);
const KID = 'interop-test-kid-v1';

function fixtureBody(): IntentManifestBody {
  return {
    schemaVersion: 1,
    manifestId: '01HZZZAA0000000000000ABCDE',
    issuedAt: 1_715_000_000,
    expiresAt: 1_715_000_060,
    principalId: 'principal_acme',
    agentId: 'agent_xyz',
    intent: {
      kind: 'commerce-action',
      action: 'stripe.charge',
      maxCalls: 1,
      amountCap: { amount: '49.00', currency: 'USD' },
    },
    reconciliation: { strictness: 'strict' },
    verifyTokenJti: 'jti_interop',
    verifyTokenSha256B64Url: 'tokenHashB64Url',
  };
}

describe('intent-manifest sign ↔ audit-verifier primitives verify', () => {
  it('signed by intent-manifest, verified by audit-verifier-side pre-image reconstruction', () => {
    const body = fixtureBody();
    const signed = signManifest(body, FIXED_PRIV, KID);

    // Reconstruct the pre-image using audit-verifier's canonicalize
    // (the OTHER package's primitive) and verify with raw ed.verify.
    const preimage = new TextEncoder().encode(avCanonicalize(signed.body));
    const sig = avDecodeBase64Url(signed.signatureB64Url);

    expect(ed.verify(sig, preimage, FIXED_PUB)).toBe(true);
  });

  it('signed via raw Ed25519 over audit-verifier-reconstructed pre-image, verified by intent-manifest', () => {
    const body = fixtureBody();

    // Produce the signature externally — audit-verifier's
    // canonicalize as source of pre-image bytes, then raw ed.sign.
    const preimage = new TextEncoder().encode(avCanonicalize(body));
    const sig = ed.sign(preimage, FIXED_PRIV);

    const signed = {
      body,
      signingKeyId: KID,
      signatureB64Url: avEncodeBase64Url(sig),
    };

    const result = verifyManifest(signed, { [KID]: FIXED_PUB });
    expect(result.valid).toBe(true);
  });

  it('intent-manifest manifestPreimage bytes byte-equal audit-verifier-reconstructed pre-image', () => {
    // Load-bearing assertion: the COMPOSITION
    // `manifestPreimage = TextEncoder.encode ∘ canonicalize` produces
    // byte-identical output on both sides. A future domain-separator
    // change that touches manifestPreimage without touching the
    // audit-verifier-side reconstruction path will fail this assertion.
    const body = fixtureBody();
    const imBytes = manifestPreimage(body);
    const avBytes = new TextEncoder().encode(avCanonicalize(body));

    expect(Array.from(imBytes)).toEqual(Array.from(avBytes));
  });

  it('tampered body is rejected by BOTH the intent-manifest verifier and the audit-verifier-side reconstruction path', () => {
    const body = fixtureBody();
    const signed = signManifest(body, FIXED_PRIV, KID);

    const tampered = {
      ...signed,
      body: { ...signed.body, principalId: 'principal_attacker' },
    };

    // (a) Internal path — intent-manifest's verifyManifest.
    const internal = verifyManifest(tampered, { [KID]: FIXED_PUB });
    expect(internal.valid).toBe(false);
    if (!internal.valid) expect(internal.reason).toBe('invalid_signature');

    // (b) External path — audit-verifier canonical + raw ed.verify.
    const preimage = new TextEncoder().encode(avCanonicalize(tampered.body));
    const sig = avDecodeBase64Url(tampered.signatureB64Url);
    expect(ed.verify(sig, preimage, FIXED_PUB)).toBe(false);
  });

  it('intent-manifest signatureB64Url decodes byte-identical via either package decoder', () => {
    // Catches drift in the encode side specifically: if intent-manifest
    // ever switches to a base64url variant that audit-verifier cannot
    // decode (e.g. padded vs unpadded), this fails.
    const body = fixtureBody();
    const signed = signManifest(body, FIXED_PRIV, KID);

    const avDecoded = avDecodeBase64Url(signed.signatureB64Url);
    expect(avDecoded.length).toBe(64);

    // Re-encode via audit-verifier and confirm round-trip equality.
    const reEncoded = avEncodeBase64Url(avDecoded);
    expect(reEncoded).toBe(signed.signatureB64Url);
  });
});
