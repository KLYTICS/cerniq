// Stripe Shared Payment Token verifier — the merchant-side check.
//
// In production this calls Stripe's verify endpoint (the exact path
// is part of Stripe's ACP API). For the example we ship a self-
// contained mock that:
//   - parses spt_<base64url>:<amount>:<currency>:<userId>:<exp>
//   - rejects expired / malformed / over-limit tokens
//   - exposes the same `SptVerdict` shape a real Stripe call would
//
// To swap in real Stripe: replace `verifySpt` with a call to
// stripe.paymentMethods.verify(spt) (or whatever method ACP exposes
// in your account's API version) and map the response onto `SptVerdict`.

import type { SharedPaymentToken, SptVerdict } from './types.js';

const SPT_PREFIX = 'spt_';

export interface VerifySptInput {
  token: SharedPaymentToken;
  /** The merchant's intent: amount + currency. Validation rejects
   *  tokens whose authorization can't cover this. */
  requestedAmount: number;
  requestedCurrency: string;
  /** Wall clock — passed in so tests can pin time. */
  now?: Date;
}

export async function verifySpt(input: VerifySptInput): Promise<SptVerdict> {
  const { token, requestedAmount, requestedCurrency } = input;
  const now = (input.now ?? new Date()).getTime();

  if (!token.startsWith(SPT_PREFIX)) {
    return { valid: false, errorCode: 'spt_invalid_format', errorMessage: 'token does not start with spt_' };
  }
  const body = token.slice(SPT_PREFIX.length);
  // Mock SPT shape: <base64url-id>:<maxAmt>:<ccy>:<userId>:<exp-ms>
  // Real Stripe SPTs are opaque; this shape is illustrative only.
  const parts = body.split(':');
  if (parts.length !== 5) {
    return { valid: false, errorCode: 'spt_invalid_format', errorMessage: `expected 5 fields, got ${parts.length}` };
  }
  const [, maxAmtRaw, ccy, userId, expRaw] = parts;
  const authorizedAmountMax = Number(maxAmtRaw);
  const exp = Number(expRaw);
  if (!Number.isFinite(authorizedAmountMax) || authorizedAmountMax <= 0) {
    return { valid: false, errorCode: 'spt_invalid_amount', errorMessage: 'amount field is not a positive number' };
  }
  if (!Number.isFinite(exp) || exp <= 0) {
    return { valid: false, errorCode: 'spt_invalid_exp', errorMessage: 'exp field is not a positive number' };
  }
  if (now > exp) {
    return { valid: false, errorCode: 'spt_expired', errorMessage: `SPT expired at ${new Date(exp).toISOString()}` };
  }
  if (!ccy || ccy.length !== 3) {
    return { valid: false, errorCode: 'spt_invalid_currency', errorMessage: 'currency must be a 3-letter code' };
  }
  if (ccy.toUpperCase() !== requestedCurrency.toUpperCase()) {
    return {
      valid: false,
      errorCode: 'spt_currency_mismatch',
      errorMessage: `SPT is ${ccy}, charge requested ${requestedCurrency}`,
    };
  }
  if (requestedAmount > authorizedAmountMax) {
    return {
      valid: false,
      errorCode: 'spt_amount_exceeded',
      errorMessage: `requested ${requestedAmount} > authorized ${authorizedAmountMax}`,
    };
  }
  return {
    valid: true,
    authorizedAmountMax,
    authorizedCurrency: ccy.toUpperCase(),
    payerUserId: userId,
  };
}

/** Test-only helper to mint a well-formed mock SPT. Production code
 *  receives SPTs from Stripe's API and should never call this. */
export function mintMockSpt(opts: {
  maxAmount: number;
  currency: string;
  payerUserId: string;
  ttlSeconds: number;
}): SharedPaymentToken {
  // crypto.randomUUID gives us an opaque, unguessable id without
  // pulling Math.random into the example (project rule: no
  // Math.random outside tests/seeds — even mocks should be tight).
  const id = (globalThis.crypto?.randomUUID?.() ?? '').replace(/-/g, '').slice(0, 12);
  const exp = Date.now() + opts.ttlSeconds * 1000;
  return `${SPT_PREFIX}${id}:${opts.maxAmount}:${opts.currency}:${opts.payerUserId}:${exp}` as SharedPaymentToken;
}
