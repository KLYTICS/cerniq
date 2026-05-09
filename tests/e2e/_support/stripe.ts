/**
 * Stripe webhook test helpers.
 *
 * Stripe signs webhook deliveries with the format
 *
 *     Stripe-Signature: t=<unix>,v1=<hex>
 *
 * where `hex = HMAC_SHA256(secret, "<unix>.<rawBody>")`. The API server
 * validates this with `stripe.webhooks.constructEvent` (see
 * `apps/api/src/modules/billing/stripe.service.ts`). For black-box e2e we
 * mint forged-but-correctly-signed events so the handler exercises the
 * full pipeline without ever talking to Stripe.
 *
 * Two helpers:
 *
 *   `signStripeEvent(rawBody, secret, ts?)` → header value
 *   `buildEvent(type, dataObject, eventId?)` → JSON envelope (string)
 *
 * Both are deterministic given their inputs (modulo the `created` field
 * and the random eventId default). The paired spec asserts byte-equality
 * against a hand-replicated reference implementation so a regression in
 * the helper can never go silently green.
 */

import crypto from 'node:crypto';

export interface BuiltEvent {
  /** Raw JSON body — pass as the POST body verbatim. */
  body: string;
  /** Parsed envelope — handy for assertions. */
  parsed: {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
    created: number;
    livemode: false;
    api_version: string;
  };
}

export function signStripeEvent(
  rawBody: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const payload = `${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

export function buildEvent(
  type: string,
  data: Record<string, unknown>,
  eventId?: string,
): BuiltEvent {
  const envelope = {
    id: eventId ?? `evt_test_${crypto.randomUUID()}`,
    type,
    data: { object: data },
    created: Math.floor(Date.now() / 1000),
    livemode: false as const,
    api_version: '2024-04-10',
  };
  return { body: JSON.stringify(envelope), parsed: envelope };
}

/**
 * Tamper a signature so the API rejects it with HTTP 400. We flip the
 * last hex nibble of v1=… so the header is still well-formed (Stripe's
 * parser accepts it) but the HMAC comparison fails.
 */
export function tamperSignature(header: string): string {
  const m = /^(t=\d+,v1=)([0-9a-f]+)$/i.exec(header);
  if (!m) throw new Error(`unexpected signature shape: ${header}`);
  const prefix = m[1] as string;
  const hex = m[2] as string;
  const last = hex.slice(-1);
  const flipped = last === 'a' ? 'b' : 'a';
  return `${prefix}${hex.slice(0, -1)}${flipped}`;
}
