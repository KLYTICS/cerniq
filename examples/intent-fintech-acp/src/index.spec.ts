import { describe, expect, it } from 'vitest';

import { runDemo } from './index.js';

describe('intent-fintech-acp demo', () => {
  it('approves the clean reconciliation; denies over-amount-cap and wrong-merchant under strict mode', async () => {
    const outcomes = await runDemo();
    expect(outcomes).toHaveLength(3);

    const [happy, overCap, wrongMerchant] = outcomes;

    expect(happy.decision).toBe('approved');
    expect(happy.mismatches).toHaveLength(0);

    expect(overCap.decision).toBe('denied');
    expect(overCap.reason).toBe('reconciliation_mismatch');
    expect(overCap.mismatches.some((m) => m.kind === 'over-amount-cap')).toBe(true);

    expect(wrongMerchant.decision).toBe('denied');
    expect(wrongMerchant.reason).toBe('reconciliation_mismatch');
    expect(wrongMerchant.mismatches.some((m) => m.kind === 'wrong-merchant')).toBe(true);
  });
});
