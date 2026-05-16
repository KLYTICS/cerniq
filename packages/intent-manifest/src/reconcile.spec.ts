import { describe, expect, it } from 'vitest';

import { reconcileIntent } from './reconcile';
import type { ActualCallObservation, IntentManifestBody, SignedIntentManifest } from './types';

const NOW = 1_700_000_030;
const fakeNow = () => NOW * 1000;

function manifest(overrides: Partial<IntentManifestBody> = {}): SignedIntentManifest {
  const body: IntentManifestBody = {
    schemaVersion: 1,
    manifestId: 'm-1',
    issuedAt: 1_700_000_000,
    expiresAt: 1_700_000_060,
    principalId: 'prn',
    agentId: 'agt',
    intent: {
      kind: 'commerce-action',
      action: 'stripe.charge',
      maxCalls: 2,
      amountCap: { amount: '10.00', currency: 'USD' },
      merchantId: 'merch_42',
    },
    reconciliation: { strictness: 'strict' },
    verifyTokenJti: 'jti',
    verifyTokenSha256B64Url: 'h',
    ...overrides,
  };
  return { body, signingKeyId: 'kid', signatureB64Url: 'sig' };
}

function actual(overrides: Partial<ActualCallObservation> = {}): ActualCallObservation {
  return {
    observedAt: NOW,
    kind: 'commerce-action',
    payload: { action: 'stripe.charge', merchantId: 'merch_42', amount: '5.00' },
    ...overrides,
  };
}

describe('reconcileIntent — happy path', () => {
  it('clean match returns no mismatches and no denial', () => {
    const r = reconcileIntent(manifest(), [actual()], { now: fakeNow });
    expect(r.mismatches).toEqual([]);
    expect(r.recommendedDenialReason).toBe(null);
    expect(r.actualCount).toBe(1);
  });
});

describe('reconcileIntent — strictness modes', () => {
  it('strict: any mismatch yields recommended denial', () => {
    const r = reconcileIntent(
      manifest(),
      [actual({ payload: { action: 'stripe.refund', merchantId: 'merch_42', amount: '5' } })],
      { now: fakeNow },
    );
    expect(r.mismatches.length).toBeGreaterThan(0);
    expect(r.recommendedDenialReason).not.toBe(null);
  });

  it('advisory: mismatches recorded but no denial', () => {
    const r = reconcileIntent(
      manifest({ reconciliation: { strictness: 'advisory' } }),
      [actual({ payload: { action: 'stripe.refund', merchantId: 'merch_42', amount: '5' } })],
      { now: fakeNow },
    );
    expect(r.mismatches.length).toBeGreaterThan(0);
    expect(r.recommendedDenialReason).toBe(null);
  });

  it('graduated default tolerance=20% — declared=10, observed=12 records fact but does not deny', () => {
    // Kernel discipline: the mismatches list is the FACT layer (every
    // observed deviation is recorded for audit/SOC2 visibility). The
    // recommendedDenialReason is the POLICY layer (graduated tolerance
    // governs escalation). Both must hold:
    //   - over-call-count IS in mismatches (12 > declared 10 is a fact)
    //   - recommendedDenialReason IS null (12 ≤ floor(10 * 1.2) = 12 → tolerated)
    const r = reconcileIntent(
      manifest({
        intent: { kind: 'commerce-action', action: 'stripe.charge', maxCalls: 10, merchantId: 'merch_42' },
        reconciliation: { strictness: 'graduated' },
      }),
      Array.from({ length: 12 }, () => actual()),
      { now: fakeNow },
    );
    expect(r.actualCount).toBe(12);
    expect(r.mismatches.some((m) => m.kind === 'over-call-count')).toBe(true);
    expect(r.recommendedDenialReason).toBe(null);
  });

  it('graduated default tolerance=20% — declared=10, observed=13 trips deny', () => {
    // floor(10 * 1.2) = 12 → 13 > 12 → INTENT_MISMATCH.
    const r = reconcileIntent(
      manifest({
        intent: { kind: 'commerce-action', action: 'stripe.charge', maxCalls: 10, merchantId: 'merch_42' },
        reconciliation: { strictness: 'graduated' },
      }),
      Array.from({ length: 13 }, () => actual()),
      { now: fakeNow },
    );
    expect(r.mismatches.some((m) => m.kind === 'over-call-count')).toBe(true);
    expect(r.recommendedDenialReason).toBe('INTENT_MISMATCH');
  });

  it('graduated mode: NON-count mismatches always deny regardless of tolerance', () => {
    // Wrong-merchant within count budget — operator-locked behavior says
    // non-count mismatches ignore tolerance entirely.
    const r = reconcileIntent(
      manifest({ reconciliation: { strictness: 'graduated', tolerance: 99 } }),
      [actual({ payload: { action: 'stripe.charge', merchantId: 'attacker_merch', amount: '5' } })],
      { now: fakeNow },
    );
    expect(r.mismatches.some((m) => m.kind === 'wrong-merchant')).toBe(true);
    expect(r.recommendedDenialReason).toBe('INTENT_MISMATCH');
  });

  it('strict mode emits INTENT_MISMATCH (not the old TBD placeholder)', () => {
    // Regression test guarding the lock — pre-lock returned INTENT_MISMATCH_TBD.
    const r = reconcileIntent(
      manifest(),
      [actual({ payload: { action: 'stripe.refund', merchantId: 'merch_42', amount: '5' } })],
      { now: fakeNow },
    );
    expect(r.recommendedDenialReason).toBe('INTENT_MISMATCH');
  });

  it('default strictness when reconciliation field is supplied: respects strict default', () => {
    // We don't infer "missing reconciliation" because the type requires it;
    // but the default for OMITTED reconciliation at issuance is 'strict' per
    // ADR-0016. The kernel itself just consumes the provided value.
    const r = reconcileIntent(manifest({ reconciliation: { strictness: 'strict' } }), [actual()], {
      now: fakeNow,
    });
    expect(r.recommendedDenialReason).toBe(null); // clean match, strict mode
  });
});

describe('reconcileIntent — temporal envelope', () => {
  it('manifest expired flags before any actual is walked', () => {
    const r = reconcileIntent(manifest(), [], { now: () => (NOW + 9999) * 1000 });
    expect(r.mismatches.some((m) => m.kind === 'manifest-expired')).toBe(true);
  });

  it('manifest not yet valid signals clock skew or replay', () => {
    const r = reconcileIntent(manifest(), [], { now: () => 1_699_999_900 * 1000 });
    expect(r.mismatches.some((m) => m.kind === 'manifest-not-yet-valid')).toBe(true);
  });
});

describe('reconcileIntent — per-claim shape', () => {
  it('http-call mismatch on URL', () => {
    const r = reconcileIntent(
      manifest({
        intent: { kind: 'http-call', url: 'https://api.example.com/x', method: 'POST', maxCalls: 1 },
      }),
      [actual({ kind: 'http-call', payload: { url: 'https://api.example.com/y', method: 'POST' } })],
      { now: fakeNow },
    );
    expect(r.mismatches.some((m) => m.kind === 'wrong-endpoint')).toBe(true);
  });

  it('http-call mismatch on method', () => {
    const r = reconcileIntent(
      manifest({
        intent: { kind: 'http-call', url: 'https://api.example.com/x', method: 'POST', maxCalls: 1 },
      }),
      [actual({ kind: 'http-call', payload: { url: 'https://api.example.com/x', method: 'GET' } })],
      { now: fakeNow },
    );
    expect(r.mismatches.some((m) => m.kind === 'wrong-method')).toBe(true);
  });

  it('commerce-action over amount cap', () => {
    const r = reconcileIntent(
      manifest(),
      [actual({ payload: { action: 'stripe.charge', merchantId: 'merch_42', amount: '999.99' } })],
      { now: fakeNow },
    );
    expect(r.mismatches.some((m) => m.kind === 'over-amount-cap')).toBe(true);
  });

  it('commerce-action wrong merchant when bound', () => {
    const r = reconcileIntent(
      manifest(),
      [actual({ payload: { action: 'stripe.charge', merchantId: 'attacker_merch', amount: '5' } })],
      { now: fakeNow },
    );
    expect(r.mismatches.some((m) => m.kind === 'wrong-merchant')).toBe(true);
  });

  it('tool-invocation arg-shape mismatch', () => {
    const r = reconcileIntent(
      manifest({
        intent: { kind: 'tool-invocation', toolName: 'fs.read', argsSha256B64Url: 'abc', maxCalls: 1 },
      }),
      [actual({ kind: 'tool-invocation', payload: { toolName: 'fs.read', argsSha256B64Url: 'xyz' } })],
      { now: fakeNow },
    );
    expect(r.mismatches.some((m) => m.kind === 'arg-shape-mismatch')).toBe(true);
  });
});

describe('reconcileIntent — over-call-count', () => {
  it('strict + maxCalls=2 with 3 actuals → denial', () => {
    const r = reconcileIntent(manifest(), [actual(), actual(), actual()], { now: fakeNow });
    expect(r.mismatches.some((m) => m.kind === 'over-call-count')).toBe(true);
    expect(r.recommendedDenialReason).not.toBe(null);
  });

  it('strict + maxCalls=2 with exactly 2 actuals → no count mismatch', () => {
    const r = reconcileIntent(manifest(), [actual(), actual()], { now: fakeNow });
    expect(r.mismatches.find((m) => m.kind === 'over-call-count')).toBeUndefined();
  });
});
