// Tests for the verifier-rp verifyIntent wedge. Uses the actual
// @aegis/intent-manifest signManifest to produce wire-shape manifests
// — no mocking of the kernel. That's deliberate: this surface IS the
// integration test of the cross-package contract.

import * as ed from '@noble/ed25519';
import {
  signManifest,
  type ActualCallObservation,
  type IntentClaim,
  type IntentManifestBody,
  type SignedIntentManifest,
} from '@aegis/intent-manifest';
import { describe, expect, it } from 'vitest';

import { verifyIntent } from '../src/intent';

const FIXED_PRIV = new Uint8Array(32).fill(7);
const FIXED_PUB = ed.getPublicKey(FIXED_PRIV);
const KID = 'aegis-audit-kid-test';

const NOW_SEC = 1_700_000_030;
const fakeNow = () => NOW_SEC * 1000;

function commerceClaim(overrides: Partial<Extract<IntentClaim, { kind: 'commerce-action' }>> = {}): IntentClaim {
  return {
    kind: 'commerce-action',
    action: 'stripe.charge',
    maxCalls: 1,
    merchantId: 'merch_42',
    amountCap: { amount: '25.00', currency: 'USD' },
    ...overrides,
  };
}

function buildSignedManifest(bodyOverrides: Partial<IntentManifestBody> = {}): SignedIntentManifest {
  const body: IntentManifestBody = {
    schemaVersion: 1,
    manifestId: 'int_test',
    issuedAt: 1_700_000_000,
    expiresAt: 1_700_000_060,
    principalId: 'prn_merchant_test',
    agentId: 'agt_test',
    intent: commerceClaim(),
    reconciliation: { strictness: 'strict' },
    verifyTokenJti: 'jti_test',
    verifyTokenSha256B64Url: 'aGVsbG8',
    ...bodyOverrides,
  };
  return signManifest(body, FIXED_PRIV, KID);
}

function chargeActual(overrides: Partial<ActualCallObservation> = {}): ActualCallObservation {
  return {
    observedAt: NOW_SEC,
    kind: 'commerce-action',
    payload: { action: 'stripe.charge', merchantId: 'merch_42', amount: '24.00' },
    ...overrides,
  };
}

describe('verifyIntent — adoption-wedge surface', () => {
  describe('approved path', () => {
    it('clean happy path → approved with zero mismatches', () => {
      const out = verifyIntent({
        manifest: buildSignedManifest(),
        actuals: [chargeActual()],
        publicKeysByKid: { [KID]: FIXED_PUB },
        expectedVerifyTokenJti: 'jti_test',
        now: fakeNow,
      });
      expect(out.kind).toBe('approved');
      if (out.kind === 'approved') {
        expect(out.result.mismatches).toEqual([]);
        expect(out.result.recommendedDenialReason).toBe(null);
      }
    });

    it('advisory mode + mismatches → approved (mismatches recorded but no denial)', () => {
      const out = verifyIntent({
        manifest: buildSignedManifest({ reconciliation: { strictness: 'advisory' } }),
        actuals: [chargeActual({ payload: { action: 'stripe.refund', merchantId: 'merch_42', amount: '5' } })],
        publicKeysByKid: { [KID]: FIXED_PUB },
        expectedVerifyTokenJti: 'jti_test',
        now: fakeNow,
      });
      expect(out.kind).toBe('approved');
      if (out.kind === 'approved') {
        expect(out.result.mismatches.length).toBeGreaterThan(0);
        expect(out.result.recommendedDenialReason).toBe(null);
      }
    });
  });

  describe('denied — signature path', () => {
    it('wrong-kid key bag → denied with manifest_signature unknown_signing_key', () => {
      const out = verifyIntent({
        manifest: buildSignedManifest(),
        actuals: [chargeActual()],
        publicKeysByKid: { 'other-kid': FIXED_PUB },
        expectedVerifyTokenJti: 'jti_test',
        now: fakeNow,
      });
      expect(out.kind).toBe('denied');
      if (out.kind === 'denied') {
        expect(out.reason.kind).toBe('manifest_signature');
        if (out.reason.kind === 'manifest_signature') {
          expect(out.reason.cause).toBe('unknown_signing_key');
        }
      }
    });

    it('tampered body → denied with invalid_signature', () => {
      const signed = buildSignedManifest();
      const tampered = { ...signed, body: { ...signed.body, principalId: 'prn_attacker' } };
      const out = verifyIntent({
        manifest: tampered,
        actuals: [chargeActual()],
        publicKeysByKid: { [KID]: FIXED_PUB },
        expectedVerifyTokenJti: 'jti_test',
        now: fakeNow,
      });
      expect(out.kind).toBe('denied');
      if (out.kind === 'denied' && out.reason.kind === 'manifest_signature') {
        expect(out.reason.cause).toBe('invalid_signature');
      }
    });
  });

  describe('denied — reconciliation path', () => {
    it('strict + over-amount-cap → denied with reconciliation_mismatch + INTENT_MISMATCH', () => {
      const out = verifyIntent({
        manifest: buildSignedManifest(),
        actuals: [chargeActual({ payload: { action: 'stripe.charge', merchantId: 'merch_42', amount: '999.00' } })],
        publicKeysByKid: { [KID]: FIXED_PUB },
        expectedVerifyTokenJti: 'jti_test',
        now: fakeNow,
      });
      expect(out.kind).toBe('denied');
      if (out.kind === 'denied') {
        expect(out.reason.kind).toBe('reconciliation_mismatch');
        if (out.reason.kind === 'reconciliation_mismatch') {
          expect(out.reason.result.recommendedDenialReason).toBe('INTENT_MISMATCH');
          expect(out.reason.result.mismatches.some((m) => m.kind === 'over-amount-cap')).toBe(true);
        }
      }
    });

    it('strict + wrong-merchant → denied', () => {
      const out = verifyIntent({
        manifest: buildSignedManifest(),
        actuals: [chargeActual({ payload: { action: 'stripe.charge', merchantId: 'attacker_merch', amount: '5.00' } })],
        publicKeysByKid: { [KID]: FIXED_PUB },
        expectedVerifyTokenJti: 'jti_test',
        now: fakeNow,
      });
      expect(out.kind).toBe('denied');
      if (out.kind === 'denied' && out.reason.kind === 'reconciliation_mismatch') {
        expect(out.reason.result.mismatches.some((m) => m.kind === 'wrong-merchant')).toBe(true);
      }
    });

    it('strict + expired manifest → denied (clock-driven)', () => {
      const out = verifyIntent({
        manifest: buildSignedManifest(),
        actuals: [chargeActual()],
        publicKeysByKid: { [KID]: FIXED_PUB },
        expectedVerifyTokenJti: 'jti_test',
        now: () => (NOW_SEC + 9999) * 1000,
      });
      expect(out.kind).toBe('denied');
      if (out.kind === 'denied' && out.reason.kind === 'reconciliation_mismatch') {
        expect(out.reason.result.mismatches.some((m) => m.kind === 'manifest-expired')).toBe(true);
      }
    });
  });

  describe('failure-mode discipline', () => {
    it('never throws on user-recoverable failure — every path returns typed outcome', () => {
      // Composite hostile input: bad kid + over-cap actuals + far-future clock.
      // Each individual condition would deny; the call still returns
      // typed-result without throwing.
      expect(() => {
        verifyIntent({
          manifest: buildSignedManifest(),
          actuals: [chargeActual({ payload: { action: 'X', merchantId: 'Y', amount: '99999' } })],
          publicKeysByKid: { 'wrong-kid': FIXED_PUB },
          expectedVerifyTokenJti: 'jti_test',
          now: () => 99999999999999,
        });
      }).not.toThrow();
    });

    it('default now → uses Date.now (smoke — does not throw)', () => {
      expect(() => {
        verifyIntent({
          manifest: buildSignedManifest({ issuedAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 60 }),
          actuals: [chargeActual({ observedAt: Math.floor(Date.now() / 1000) })],
          publicKeysByKid: { [KID]: FIXED_PUB },
          expectedVerifyTokenJti: 'jti_test',
        });
      }).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // IM-T2 — verify-token binding (cross-RP replay defense)
  // ─────────────────────────────────────────────────────────────────────
  // Closes the gap surfaced in docs/THREAT_MODEL_INTENT_MANIFEST.md:
  // before this defense, an attacker who intercepted a manifest issued
  // for verify-token T at relying party RP-A could replay it against
  // RP-B (different verify token, different jti). The binding check
  // makes that replay surface a typed denial instead of a silent pass.

  describe('denied — verify-token binding (IM-T2 defense)', () => {
    it('expected jti differs from manifest jti → denied with verify_token_binding_mismatch', () => {
      const out = verifyIntent({
        manifest: buildSignedManifest(), // body.verifyTokenJti = 'jti_test'
        actuals: [chargeActual()],
        publicKeysByKid: { [KID]: FIXED_PUB },
        // RP is honoring a DIFFERENT verify token than the one the manifest binds to.
        expectedVerifyTokenJti: 'jti_belongs_to_other_rp',
        now: fakeNow,
      });
      expect(out.kind).toBe('denied');
      if (out.kind === 'denied') {
        expect(out.reason.kind).toBe('verify_token_binding_mismatch');
        if (out.reason.kind === 'verify_token_binding_mismatch') {
          expect(out.reason.field).toBe('jti');
          expect(out.reason.expected).toBe('jti_belongs_to_other_rp');
          expect(out.reason.actual).toBe('jti_test');
        }
      }
    });

    it('expected sha256 differs from manifest sha256 → denied with field=sha256', () => {
      const out = verifyIntent({
        manifest: buildSignedManifest(), // body.verifyTokenSha256B64Url = 'aGVsbG8'
        actuals: [chargeActual()],
        publicKeysByKid: { [KID]: FIXED_PUB },
        expectedVerifyTokenJti: 'jti_test', // jti matches
        expectedVerifyTokenSha256B64Url: 'd29ybGQ', // but sha256 does NOT
        now: fakeNow,
      });
      expect(out.kind).toBe('denied');
      if (out.kind === 'denied' && out.reason.kind === 'verify_token_binding_mismatch') {
        expect(out.reason.field).toBe('sha256');
        expect(out.reason.expected).toBe('d29ybGQ');
        expect(out.reason.actual).toBe('aGVsbG8');
      }
    });

    it('binding check fires AFTER signature — forged manifest gets signature error, not binding error', () => {
      // A manifest with a tampered body would fail signature first. The
      // binding error is reserved for cases where the signature is valid
      // but the manifest was issued for a different verify-token context.
      const signed = buildSignedManifest();
      const tampered = { ...signed, body: { ...signed.body, verifyTokenJti: 'attacker_jti' } };
      const out = verifyIntent({
        manifest: tampered,
        actuals: [chargeActual()],
        publicKeysByKid: { [KID]: FIXED_PUB },
        expectedVerifyTokenJti: 'attacker_jti', // would match the tampered body
        now: fakeNow,
      });
      // ...but signature fails first because the body bytes changed.
      expect(out.kind).toBe('denied');
      if (out.kind === 'denied') {
        expect(out.reason.kind).toBe('manifest_signature');
      }
    });

    it('matching sha256 (optional) does not block clean path', () => {
      const out = verifyIntent({
        manifest: buildSignedManifest(),
        actuals: [chargeActual()],
        publicKeysByKid: { [KID]: FIXED_PUB },
        expectedVerifyTokenJti: 'jti_test',
        expectedVerifyTokenSha256B64Url: 'aGVsbG8', // matches the body
        now: fakeNow,
      });
      expect(out.kind).toBe('approved');
    });
  });
});
