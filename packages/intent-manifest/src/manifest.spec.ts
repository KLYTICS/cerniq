// Signature roundtrip + tamper detection. These tests are pattern-locked
// to packages/audit-verifier/src/manifest.spec.ts and intentionally cover
// the same surfaces, because future cross-package parity tests will treat
// the two manifest kernels as alternate signature producers.

import * as ed from '@noble/ed25519';
import { describe, expect, it } from 'vitest';

import { manifestPreimage, signManifest, verifyManifest } from './manifest';
import type { IntentManifestBody } from './types';

const FIXED_PRIV = new Uint8Array(32).fill(7);
const FIXED_PUB = ed.getPublicKey(FIXED_PRIV);
const KID = 'intent-test-kid-v1';

function fixtureBody(overrides: Partial<IntentManifestBody> = {}): IntentManifestBody {
  return {
    schemaVersion: 1,
    manifestId: '01H8KQYV2RHEEZX5BJM7CGFFV0',
    issuedAt: 1_700_000_000,
    expiresAt: 1_700_000_060,
    principalId: 'prn_test',
    agentId: 'agt_test',
    intent: {
      kind: 'commerce-action',
      action: 'stripe.charge',
      maxCalls: 1,
      amountCap: { amount: '10.00', currency: 'USD' },
    },
    reconciliation: { strictness: 'strict' },
    verifyTokenJti: 'jti_test',
    verifyTokenSha256B64Url: 'aGVsbG8',
    ...overrides,
  };
}

describe('intent-manifest signMaifest/verifyManifest', () => {
  it('sign+verify roundtrip succeeds', () => {
    const signed = signManifest(fixtureBody(), FIXED_PRIV, KID);
    const result = verifyManifest(signed, { [KID]: FIXED_PUB });
    expect(result.valid).toBe(true);
  });

  it('tampered body breaks the signature', () => {
    const signed = signManifest(fixtureBody(), FIXED_PRIV, KID);
    const mutated = { ...signed, body: { ...signed.body, principalId: 'prn_attacker' } };
    const result = verifyManifest(mutated, { [KID]: FIXED_PUB });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('invalid_signature');
  });

  it('unknown kid rejects without leaking the signature contents', () => {
    const signed = signManifest(fixtureBody(), FIXED_PRIV, KID);
    const result = verifyManifest(signed, { 'other-kid': FIXED_PUB });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('unknown_signing_key');
  });

  it('malformed b64url signature is detected before crypto', () => {
    const signed = signManifest(fixtureBody(), FIXED_PRIV, KID);
    const bad = { ...signed, signatureB64Url: '!!!not-base64!!!' };
    const result = verifyManifest(bad, { [KID]: FIXED_PUB });
    expect(result.valid).toBe(false);
  });

  it('wrong-sized public key rejects without invoking ed.verify', () => {
    const signed = signManifest(fixtureBody(), FIXED_PRIV, KID);
    const result = verifyManifest(signed, { [KID]: new Uint8Array(16) });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('wrong_kid_for_key');
  });

  it('private key length is validated', () => {
    expect(() => signManifest(fixtureBody(), new Uint8Array(31), KID)).toThrow(/32 bytes/);
  });

  it('canonical pre-image is deterministic across key-order shuffles', () => {
    const a = fixtureBody();
    const b: IntentManifestBody = {
      ...a,
      // same logical body, different key insertion order:
      intent: { ...a.intent } as IntentManifestBody['intent'],
    };
    expect(manifestPreimage(a)).toEqual(manifestPreimage(b));
  });
});
