/**
 * Unit tests for `_support/stripe.ts`.
 *
 * Cross-check strategy: instead of pulling the `stripe` SDK into the test
 * harness's dependency closure (it isn't installed there), we replicate
 * Stripe's documented signing algorithm by hand and assert byte-equality
 * of the digest. If the helper ever drifts (wrong delimiter, wrong hash,
 * wrong encoding) this test goes red.
 *
 * Reference: https://docs.stripe.com/webhooks#verify-manually
 */

import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { buildEvent, signStripeEvent, tamperSignature } from './stripe';

const SECRET = 'whsec_test_aegis_e2e_only';

describe('_support/stripe.ts · signStripeEvent', () => {
  it('matches the hand-replicated HMAC-SHA256 of `<ts>.<body>`', () => {
    const body = '{"hello":"world"}';
    const ts = 1_700_000_000;
    const got = signStripeEvent(body, SECRET, ts);
    const expectedSig = crypto
      .createHmac('sha256', SECRET)
      .update(`${ts}.${body}`)
      .digest('hex');
    expect(got).toBe(`t=${ts},v1=${expectedSig}`);
  });

  it('produces a different digest for a different body (no aliasing)', () => {
    const ts = 1_700_000_000;
    const a = signStripeEvent('{"a":1}', SECRET, ts);
    const b = signStripeEvent('{"a":2}', SECRET, ts);
    expect(a).not.toBe(b);
  });

  it('produces a different digest for a different timestamp (replay-safe)', () => {
    const body = '{"x":true}';
    expect(signStripeEvent(body, SECRET, 1)).not.toBe(signStripeEvent(body, SECRET, 2));
  });

  it('defaults timestamp to now() when omitted', () => {
    const before = Math.floor(Date.now() / 1000) - 1;
    const header = signStripeEvent('{}', SECRET);
    const m = /^t=(\d+),v1=[0-9a-f]+$/.exec(header);
    expect(m, header).not.toBeNull();
    const ts = Number.parseInt(m![1] as string, 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
  });
});

describe('_support/stripe.ts · buildEvent', () => {
  it('produces a parseable Stripe envelope', () => {
    const evt = buildEvent('customer.subscription.created', { id: 'sub_x', foo: 'bar' });
    const parsed = JSON.parse(evt.body) as Record<string, unknown>;
    expect(parsed['type']).toBe('customer.subscription.created');
    expect((parsed['data'] as { object: { id: string } }).object.id).toBe('sub_x');
    expect(typeof parsed['id']).toBe('string');
    expect((parsed['id'] as string).startsWith('evt_')).toBe(true);
    expect(parsed['livemode']).toBe(false);
  });

  it('honors a caller-supplied event id (idempotency replay)', () => {
    const evt = buildEvent('x', {}, 'evt_test_fixed_123');
    expect(evt.parsed.id).toBe('evt_test_fixed_123');
    expect(JSON.parse(evt.body).id).toBe('evt_test_fixed_123');
  });

  it('round-trips: signing the body verifies cleanly with the same algorithm', () => {
    const evt = buildEvent('invoice.payment_succeeded', { id: 'in_1' });
    const ts = 1_700_000_001;
    const header = signStripeEvent(evt.body, SECRET, ts);
    const expectedSig = crypto
      .createHmac('sha256', SECRET)
      .update(`${ts}.${evt.body}`)
      .digest('hex');
    expect(header).toBe(`t=${ts},v1=${expectedSig}`);
  });
});

describe('_support/stripe.ts · tamperSignature', () => {
  it('flips the last hex nibble while preserving header shape', () => {
    const header = signStripeEvent('{}', SECRET, 42);
    const tampered = tamperSignature(header);
    expect(tampered).not.toBe(header);
    expect(/^t=42,v1=[0-9a-f]+$/.test(tampered)).toBe(true);
    // Same length — still a valid hex digest, just wrong.
    expect(tampered.length).toBe(header.length);
  });
});
