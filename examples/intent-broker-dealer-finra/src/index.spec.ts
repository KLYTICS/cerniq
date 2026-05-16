import { describe, expect, it } from 'vitest';

import { runDemo } from './index.js';

describe('intent-broker-dealer-finra demo', () => {
  it('approves clean fill; denies wrong-side / over-notional / wrong-venue under strict Rule-3110 supervision', async () => {
    const outcomes = await runDemo();
    expect(outcomes).toHaveLength(4);

    const [happy, wrongSide, overNotional, wrongVenue] = outcomes;

    expect(happy.decision).toBe('approved');
    expect(happy.mismatches).toHaveLength(0);

    expect(wrongSide.decision).toBe('denied');
    expect(wrongSide.reason).toBe('reconciliation_mismatch');
    // Wrong action verb (buy → sell) presents as wrong-endpoint, not as a
    // separate "wrong-side" mismatch kind — the kernel's discriminator is
    // intent.kind, not intent.action. Action-level deviation is the
    // wrong-endpoint match arm in reconcile.ts:146.
    expect(wrongSide.mismatches.some((m) => m.kind === 'wrong-endpoint')).toBe(true);

    expect(overNotional.decision).toBe('denied');
    expect(overNotional.reason).toBe('reconciliation_mismatch');
    expect(overNotional.mismatches.some((m) => m.kind === 'over-amount-cap')).toBe(true);

    expect(wrongVenue.decision).toBe('denied');
    expect(wrongVenue.reason).toBe('reconciliation_mismatch');
    expect(wrongVenue.mismatches.some((m) => m.kind === 'wrong-merchant')).toBe(true);
  });
});
