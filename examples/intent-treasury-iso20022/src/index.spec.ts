import { describe, expect, it } from 'vitest';

import { runDemo } from './index.js';

describe('intent-treasury-iso20022 demo', () => {
  it('approves the clean wire; denies wrong-beneficiary and over-amount even under graduated mode (footgun-by-design)', async () => {
    const outcomes = await runDemo();
    expect(outcomes).toHaveLength(3);

    const [happy, hijack, over] = outcomes;

    expect(happy.decision).toBe('approved');
    expect(happy.mismatches).toHaveLength(0);

    // Graduated tolerance only relaxes over-call-count. wrong-merchant is
    // always strict (reconcile.ts:232) — exactly what treasury needs.
    expect(hijack.decision).toBe('denied');
    expect(hijack.reason).toBe('reconciliation_mismatch');
    expect(hijack.mismatches.some((m) => m.kind === 'wrong-merchant')).toBe(true);

    expect(over.decision).toBe('denied');
    expect(over.reason).toBe('reconciliation_mismatch');
    expect(over.mismatches.some((m) => m.kind === 'over-amount-cap')).toBe(true);
  });
});
