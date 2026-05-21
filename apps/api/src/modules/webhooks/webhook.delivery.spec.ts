import { createHmac } from 'node:crypto';

import { WebhookDeliveryWorker } from './webhook.delivery';

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
