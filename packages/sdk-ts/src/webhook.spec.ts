// Tests for verifyWebhookSignature.
//
// Strategy: produce signatures with the EXACT code the API uses
// (node:crypto.createHmac, hex digest, `${ts}.${body}` template) in
// the test fixture. This makes the spec a mini cross-package parity
// check on top of the dedicated parity spec in
// `tests/cross-package/webhook-signature-parity.spec.ts` — if the
// API's signing template ever drifts, this spec breaks first.

import { createHmac } from 'node:crypto';

import {
  AegisWebhookSignatureInvalidError,
  AegisWebhookSignatureMalformedError,
  AegisWebhookTimestampError,
  DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  verifyWebhookSignature,
} from './webhook';

const SECRET = 'whsec_test_abc_123';
const BODY = '{"id":"evt_001","event":"policy.expired","data":{"policyId":"p_1"}}';

/** Mirrors `apps/api/src/modules/webhooks/webhook.delivery.ts:438`. */
function apiSign(secret: string, ts: number, body: string): string {
  const h = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${h}`;
}

const FIXED_NOW = 1_716_400_000; // fixed-clock seed for deterministic skew math
const now = (): number => FIXED_NOW;

describe('verifyWebhookSignature — happy path', () => {
  it('accepts a fresh signature produced by the API signing routine', async () => {
    const result = await verifyWebhookSignature({
      payload: BODY,
      signature: apiSign(SECRET, FIXED_NOW, BODY),
      secret: SECRET,
      now,
    });
    expect(result.timestamp).toBe(FIXED_NOW);
    expect(result.skewSeconds).toBe(0);
  });

  it('reports positive skew for delivery that arrived late', async () => {
    const deliveredAt = FIXED_NOW - 120; // 2 min ago
    const result = await verifyWebhookSignature({
      payload: BODY,
      signature: apiSign(SECRET, deliveredAt, BODY),
      secret: SECRET,
      now,
    });
    expect(result.skewSeconds).toBe(120);
  });

  it('reports negative skew when receiver clock is behind sender', async () => {
    const deliveredAt = FIXED_NOW + 5; // sender 5s ahead
    const result = await verifyWebhookSignature({
      payload: BODY,
      signature: apiSign(SECRET, deliveredAt, BODY),
      secret: SECRET,
      now,
    });
    expect(result.skewSeconds).toBe(-5);
  });
});

describe('verifyWebhookSignature — signature validity', () => {
  it('rejects a signature signed with the wrong secret', async () => {
    const sig = apiSign('whsec_wrong_key', FIXED_NOW, BODY);
    await expect(
      verifyWebhookSignature({ payload: BODY, signature: sig, secret: SECRET, now }),
    ).rejects.toBeInstanceOf(AegisWebhookSignatureInvalidError);
  });

  it('rejects a signature when the payload was modified in transit', async () => {
    const sig = apiSign(SECRET, FIXED_NOW, BODY);
    await expect(
      verifyWebhookSignature({
        payload: `${BODY},"extra":"appended"`,
        signature: sig,
        secret: SECRET,
        now,
      }),
    ).rejects.toBeInstanceOf(AegisWebhookSignatureInvalidError);
  });

  it('rejects a signature whose timestamp does not match the signed timestamp', async () => {
    // Attacker swaps `t=` to make it appear fresh, but the v1= was
    // computed over the original timestamp. HMAC verify must fail.
    const sig = apiSign(SECRET, FIXED_NOW - 1000, BODY).replace(
      /t=\d+/,
      `t=${FIXED_NOW}`,
    );
    await expect(
      verifyWebhookSignature({ payload: BODY, signature: sig, secret: SECRET, now }),
    ).rejects.toBeInstanceOf(AegisWebhookSignatureInvalidError);
  });
});

describe('verifyWebhookSignature — header parsing', () => {
  it('rejects a header missing t=', async () => {
    await expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: 'v1=aabbccddeeff',
        secret: SECRET,
        now,
      }),
    ).rejects.toMatchObject({
      name: 'AegisWebhookSignatureMalformedError',
      message: expect.stringContaining("missing required 't="),
    });
  });

  it('rejects a header missing v1=', async () => {
    await expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: `t=${FIXED_NOW}`,
        secret: SECRET,
        now,
      }),
    ).rejects.toMatchObject({
      name: 'AegisWebhookSignatureMalformedError',
      message: expect.stringContaining("missing required 'v1="),
    });
  });

  it('rejects a header with non-hex v1', async () => {
    await expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: `t=${FIXED_NOW},v1=not_hex_at_all`,
        secret: SECRET,
        now,
      }),
    ).rejects.toBeInstanceOf(AegisWebhookSignatureMalformedError);
  });

  it('rejects a non-integer timestamp', async () => {
    await expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: `t=not-a-number,v1=abab`,
        secret: SECRET,
        now,
      }),
    ).rejects.toBeInstanceOf(AegisWebhookSignatureMalformedError);
  });

  it('rejects a negative timestamp', async () => {
    await expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: `t=-1,v1=abab`,
        secret: SECRET,
        now,
      }),
    ).rejects.toBeInstanceOf(AegisWebhookSignatureMalformedError);
  });

  it('ignores unknown segments (forward-compat with v2= etc)', async () => {
    const baseSig = apiSign(SECRET, FIXED_NOW, BODY);
    // Inject an unknown segment between t= and v1=
    const padded = baseSig.replace(',v1=', ',unknown=ignore-me,v1=');
    const result = await verifyWebhookSignature({
      payload: BODY,
      signature: padded,
      secret: SECRET,
      now,
    });
    expect(result.timestamp).toBe(FIXED_NOW);
  });
});

describe('verifyWebhookSignature — key rotation (multiple v1=)', () => {
  // During key rotation, the API may emit two v1= segments — one signed
  // by the current secret, one by the previous. SDK should accept the
  // delivery if ANY v1= verifies against the receiver's secret.
  it('accepts when the FIRST v1= matches', async () => {
    const goodHmac = createHmac('sha256', SECRET).update(`${FIXED_NOW}.${BODY}`).digest('hex');
    const badHmac = 'deadbeef'.repeat(8); // 32-byte non-matching hex
    const sig = `t=${FIXED_NOW},v1=${goodHmac},v1=${badHmac}`;
    await expect(
      verifyWebhookSignature({ payload: BODY, signature: sig, secret: SECRET, now }),
    ).resolves.toMatchObject({ timestamp: FIXED_NOW });
  });

  it('accepts when the SECOND v1= matches (rotation cutover)', async () => {
    const goodHmac = createHmac('sha256', SECRET).update(`${FIXED_NOW}.${BODY}`).digest('hex');
    const badHmac = 'deadbeef'.repeat(8);
    const sig = `t=${FIXED_NOW},v1=${badHmac},v1=${goodHmac}`;
    await expect(
      verifyWebhookSignature({ payload: BODY, signature: sig, secret: SECRET, now }),
    ).resolves.toMatchObject({ timestamp: FIXED_NOW });
  });

  it('rejects when NEITHER v1= matches', async () => {
    const sig = `t=${FIXED_NOW},v1=${'aa'.repeat(32)},v1=${'bb'.repeat(32)}`;
    await expect(
      verifyWebhookSignature({ payload: BODY, signature: sig, secret: SECRET, now }),
    ).rejects.toBeInstanceOf(AegisWebhookSignatureInvalidError);
  });
});

describe('verifyWebhookSignature — timestamp tolerance', () => {
  it('rejects a stale signature outside the default tolerance window', async () => {
    const tooOld = FIXED_NOW - DEFAULT_TOLERANCE_SECONDS - 1;
    const sig = apiSign(SECRET, tooOld, BODY);
    const err = await verifyWebhookSignature({
      payload: BODY,
      signature: sig,
      secret: SECRET,
      now,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AegisWebhookTimestampError);
    expect((err as AegisWebhookTimestampError).signatureTimestamp).toBe(tooOld);
    expect((err as AegisWebhookTimestampError).receivedAt).toBe(FIXED_NOW);
    expect((err as AegisWebhookTimestampError).toleranceSeconds).toBe(
      DEFAULT_TOLERANCE_SECONDS,
    );
  });

  it('rejects a future timestamp outside tolerance (clock skew exploit)', async () => {
    const tooFuture = FIXED_NOW + DEFAULT_TOLERANCE_SECONDS + 1;
    const sig = apiSign(SECRET, tooFuture, BODY);
    await expect(
      verifyWebhookSignature({ payload: BODY, signature: sig, secret: SECRET, now }),
    ).rejects.toBeInstanceOf(AegisWebhookTimestampError);
  });

  it('accepts a signature inside a caller-supplied narrower tolerance', async () => {
    const fiftySecondsOld = FIXED_NOW - 50;
    const sig = apiSign(SECRET, fiftySecondsOld, BODY);
    await expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: sig,
        secret: SECRET,
        toleranceSeconds: 60,
        now,
      }),
    ).resolves.toMatchObject({ timestamp: fiftySecondsOld });
  });

  it('rejects a signature outside a caller-supplied narrower tolerance', async () => {
    const seventySecondsOld = FIXED_NOW - 70;
    const sig = apiSign(SECRET, seventySecondsOld, BODY);
    await expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: sig,
        secret: SECRET,
        toleranceSeconds: 60,
        now,
      }),
    ).rejects.toBeInstanceOf(AegisWebhookTimestampError);
  });

  it('skips the timestamp check when toleranceSeconds=Infinity', async () => {
    const ancient = FIXED_NOW - 10_000_000;
    const sig = apiSign(SECRET, ancient, BODY);
    await expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: sig,
        secret: SECRET,
        toleranceSeconds: Infinity,
        now,
      }),
    ).resolves.toMatchObject({ timestamp: ancient });
  });

  it('checks timestamp BEFORE computing HMAC (skips work on obvious replay)', async () => {
    // Use a structurally-valid-but-junk v1 so the test asserts the
    // ordering by error class: timestamp check throws BEFORE HMAC
    // verify would. If the order flipped, we'd get InvalidError, not
    // TimestampError.
    const ancient = FIXED_NOW - DEFAULT_TOLERANCE_SECONDS - 1;
    const sig = `t=${ancient},v1=${'aa'.repeat(32)}`;
    await expect(
      verifyWebhookSignature({ payload: BODY, signature: sig, secret: SECRET, now }),
    ).rejects.toBeInstanceOf(AegisWebhookTimestampError);
  });
});

describe('webhook header constants match the API wire contract', () => {
  // Mirror the literals at apps/api/src/modules/webhooks/webhook.delivery.ts:353-356.
  // Cross-package parity spec asserts the same; this is the SDK-side lock.
  it('WEBHOOK_SIGNATURE_HEADER', () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe('X-AEGIS-Signature');
  });
  it('WEBHOOK_EVENT_HEADER', () => {
    expect(WEBHOOK_EVENT_HEADER).toBe('X-AEGIS-Event');
  });
  it('WEBHOOK_DELIVERY_ID_HEADER', () => {
    expect(WEBHOOK_DELIVERY_ID_HEADER).toBe('X-AEGIS-Delivery-Id');
  });
});

describe('DEFAULT_TOLERANCE_SECONDS', () => {
  it('is pinned at 300s per operator decision 2026-05-22 (Stripe-default)', () => {
    // Changing this value is part of the customer-observable contract.
    // Any change must update the SDK CHANGELOG and notify subscribers.
    expect(DEFAULT_TOLERANCE_SECONDS).toBe(300);
  });
});
