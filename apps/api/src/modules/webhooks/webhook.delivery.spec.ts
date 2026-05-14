import { WebhookDeliveryWorker } from './webhook.delivery';
import { WebhookPayloadValidationError } from '@aegis/types';
import { createHmac } from 'node:crypto';

describe('WebhookDeliveryWorker.sign', () => {
  it('produces a Stripe-style header', () => {
    const sig = WebhookDeliveryWorker.sign('whsec_abc', 1700000000, '{"hello":"world"}');
    expect(sig).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  it('matches a manual HMAC re-computation', () => {
    const ts = 1700000000;
    const body = '{"event":"x"}';
    const sig = WebhookDeliveryWorker.sign('whsec_abc', ts, body);
    const expected = createHmac('sha256', 'whsec_abc').update(`${ts}.${body}`).digest('hex');
    expect(sig).toBe(`t=${ts},v1=${expected}`);
  });

  it('rejects modified body when verifying', () => {
    const sig = WebhookDeliveryWorker.sign('whsec_abc', 1, 'a');
    const tampered = WebhookDeliveryWorker.sign('whsec_abc', 1, 'b');
    expect(sig).not.toBe(tampered);
  });
});

describe('WebhookDeliveryWorker.buildEnvelope', () => {
  it('emits canonical {id, event, data, ts} key order byte-for-byte', () => {
    const body = WebhookDeliveryWorker.buildEnvelope(
      'del_1',
      'aegis.policy.expired',
      { policyId: 'pol_1', agentId: 'agt_1', expiredAt: 'X', sweptAt: 'Y' },
      1_700_000_000,
    );
    expect(body).toBe(
      '{"id":"del_1","event":"aegis.policy.expired","data":{"policyId":"pol_1","agentId":"agt_1","expiredAt":"X","sweptAt":"Y"},"ts":1700000000}',
    );
  });
});

describe('WebhookDeliveryWorker.assertEnvelopeIntegrity (delivery-time defense in depth)', () => {
  // Canonical valid inputs reused across cases.
  const ID = 'del_1';
  const EVENT = 'aegis.policy.expired';
  const DATA = {
    policyId: 'pol_1',
    agentId: 'agt_1',
    expiredAt: '2026-05-01T00:00:00.000Z',
    sweptAt: '2026-05-01T00:05:00.000Z',
  };
  const TS = 1_715_000_000;

  function bodyOf(data: unknown): string {
    return WebhookDeliveryWorker.buildEnvelope(ID, EVENT, data, TS);
  }

  it('passes for an unmutated row', () => {
    expect(() =>
      WebhookDeliveryWorker.assertEnvelopeIntegrity(ID, EVENT, DATA, TS, bodyOf(DATA)),
    ).not.toThrow();
  });

  it('throws when the inner payload is missing a required field (simulated DB drift)', () => {
    const corrupted = { ...DATA } as Record<string, unknown>;
    delete corrupted.sweptAt;
    expect(() =>
      WebhookDeliveryWorker.assertEnvelopeIntegrity(
        ID,
        EVENT,
        corrupted,
        TS,
        bodyOf(corrupted),
      ),
    ).toThrow(WebhookPayloadValidationError);
  });

  it('throws when the inner payload carries an extra field (strict mode)', () => {
    const corrupted = { ...DATA, attacker_controlled: 'value' };
    expect(() =>
      WebhookDeliveryWorker.assertEnvelopeIntegrity(
        ID,
        EVENT,
        corrupted,
        TS,
        bodyOf(corrupted),
      ),
    ).toThrow(WebhookPayloadValidationError);
  });

  it('throws when the event type is reserved (no producer should exist)', () => {
    expect(() =>
      WebhookDeliveryWorker.assertEnvelopeIntegrity(
        ID,
        'aegis.agent.revoked',
        DATA,
        TS,
        WebhookDeliveryWorker.buildEnvelope(ID, 'aegis.agent.revoked', DATA, TS),
      ),
    ).toThrow(WebhookPayloadValidationError);
  });

  it('throws when the body bytes do not match the canonical buildEnvelope output', () => {
    // Simulates the case where some other code path constructed the body
    // (different key order, extra whitespace, etc.). Signing would leak
    // that non-canonical form to subscribers with a valid signature.
    const tamperedBody = JSON.stringify({ event: EVENT, id: ID, data: DATA, ts: TS });
    expect(() =>
      WebhookDeliveryWorker.assertEnvelopeIntegrity(ID, EVENT, DATA, TS, tamperedBody),
    ).toThrow(/body bytes do not match canonical/);
  });
});
