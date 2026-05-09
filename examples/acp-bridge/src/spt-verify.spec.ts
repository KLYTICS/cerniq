// Tests the local SPT verifier — pure function, no network.

import { describe, it, expect } from 'vitest';

import { mintMockSpt, verifySpt } from './spt-verify.js';

describe('verifySpt', () => {
  it('approves a fresh, in-budget, matching-currency token', async () => {
    const token = mintMockSpt({ maxAmount: 10000, currency: 'USD', payerUserId: 'usr_x', ttlSeconds: 60 });
    const v = await verifySpt({ token, requestedAmount: 4900, requestedCurrency: 'USD' });
    expect(v.valid).toBe(true);
    expect(v.authorizedAmountMax).toBe(10000);
    expect(v.payerUserId).toBe('usr_x');
  });

  it('rejects when amount exceeds the SPT cap', async () => {
    const token = mintMockSpt({ maxAmount: 1000, currency: 'USD', payerUserId: 'usr_x', ttlSeconds: 60 });
    const v = await verifySpt({ token, requestedAmount: 4900, requestedCurrency: 'USD' });
    expect(v.valid).toBe(false);
    expect(v.errorCode).toBe('spt_amount_exceeded');
  });

  it('rejects on currency mismatch (case-insensitive match honored)', async () => {
    const token = mintMockSpt({ maxAmount: 10000, currency: 'USD', payerUserId: 'usr_x', ttlSeconds: 60 });
    const v = await verifySpt({ token, requestedAmount: 4900, requestedCurrency: 'EUR' });
    expect(v.valid).toBe(false);
    expect(v.errorCode).toBe('spt_currency_mismatch');
  });

  it('rejects when the SPT is expired', async () => {
    const token = mintMockSpt({ maxAmount: 10000, currency: 'USD', payerUserId: 'usr_x', ttlSeconds: 60 });
    const future = new Date(Date.now() + 120 * 1000); // 2 minutes ahead
    const v = await verifySpt({ token, requestedAmount: 4900, requestedCurrency: 'USD', now: future });
    expect(v.valid).toBe(false);
    expect(v.errorCode).toBe('spt_expired');
  });

  it('rejects malformed tokens at the prefix gate', async () => {
    const v = await verifySpt({
      token: 'pk_not_an_spt:1:USD:usr:9999999999999' as `spt_${string}`,
      requestedAmount: 100,
      requestedCurrency: 'USD',
    });
    expect(v.valid).toBe(false);
    expect(v.errorCode).toBe('spt_invalid_format');
  });

  it('rejects malformed tokens with wrong field count', async () => {
    const v = await verifySpt({
      token: 'spt_id:100:USD' as `spt_${string}`,
      requestedAmount: 100,
      requestedCurrency: 'USD',
    });
    expect(v.valid).toBe(false);
    expect(v.errorCode).toBe('spt_invalid_format');
  });
});
