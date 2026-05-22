// Cross-package parity — webhook signature scheme.
//
// The SDK's `verifyWebhookSignature` must accept any signature produced
// by the API's `WebhookDeliveryWorker.sign(secret, ts, body)` static.
// Drift in either direction silently breaks every customer integration:
//
//   - API changes the signed template (e.g. `${ts}:${body}` instead of
//     `${ts}.${body}`) → SDK fails to verify legitimate deliveries.
//   - SDK changes the header constants → customers parse the wrong
//     header and reject everything.
//   - Either side switches algorithm (SHA-256 → SHA-512) → silent break.
//
// Strategy: re-execute the API's signing routine inline using the
// EXACT primitives it uses (`node:crypto.createHmac`), pass the
// result to the SDK's verifier, and assert acceptance. Then
// regex-extract the literals in the API source to lock the wire
// shape against future refactors. No NestJS bootstrap needed.

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  verifyWebhookSignature,
} from '../../packages/sdk-ts/src/webhook';

const REPO_ROOT = join(__dirname, '..', '..');
const DELIVERY_PATH = join(
  REPO_ROOT,
  'apps',
  'api',
  'src',
  'modules',
  'webhooks',
  'webhook.delivery.ts',
);

function readDeliverySource(): string {
  return readFileSync(DELIVERY_PATH, 'utf8');
}

/**
 * Inline mirror of the API's signing routine. If this drifts from the
 * API's `WebhookDeliveryWorker.sign(...)`, the source-shape assertions
 * below catch it.
 */
function apiSign(secret: string, ts: number, body: string): string {
  const h = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${h}`;
}

describe('webhook signature scheme — end-to-end parity', () => {
  it('SDK verifies a signature produced by the API signing template', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = '{"event":"policy.expired","data":{"policyId":"p_1"}}';
    const secret = 'whsec_parity_check';
    const sig = apiSign(secret, ts, body);
    await expect(
      verifyWebhookSignature({ payload: body, signature: sig, secret }),
    ).resolves.toMatchObject({ timestamp: ts });
  });
});

describe('webhook header parity — request side', () => {
  // The API delivery worker sends three headers at lines 353-356 of
  // webhook.delivery.ts. Each SDK constant must match a literal in
  // that file.
  const SET_HEADER_RE =
    /(['"`])(X-AEGIS-(?:Signature|Event|Delivery-Id))(\1)/g;

  function extractApiHeaderLiterals(): Set<string> {
    const src = readDeliverySource();
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = SET_HEADER_RE.exec(src)) !== null) {
      out.add(m[2]!);
    }
    return out;
  }

  it('all SDK webhook header constants appear in webhook.delivery.ts', () => {
    const literals = extractApiHeaderLiterals();
    expect(literals).toContain(WEBHOOK_SIGNATURE_HEADER);
    expect(literals).toContain(WEBHOOK_EVENT_HEADER);
    expect(literals).toContain(WEBHOOK_DELIVERY_ID_HEADER);
  });
});

describe('signature scheme lock — source-shape assertions', () => {
  // These guards make a future refactor of the API signing routine
  // (template change, algorithm swap, encoding swap) break THIS test
  // before it breaks a customer.
  it('API signs over `${ts}.${body}` (dot separator, not colon)', () => {
    const src = readDeliverySource();
    expect(src).toMatch(/`\$\{ts\}\.\$\{body\}`/);
  });

  it('API uses HMAC-SHA-256', () => {
    const src = readDeliverySource();
    expect(src).toMatch(/createHmac\(\s*['"`]sha256['"`]/);
  });

  it('API hex-encodes the digest (not base64 or binary)', () => {
    const src = readDeliverySource();
    expect(src).toMatch(/\.digest\(\s*['"`]hex['"`]\s*\)/);
  });

  it('API emits the t= prefix verbatim', () => {
    const src = readDeliverySource();
    expect(src).toMatch(/`t=\$\{ts\},v1=\$\{h\}`/);
  });
});

describe('mutation detection — wrong-template rejection', () => {
  // Belt-and-braces: if someone bypasses the source-shape assertions
  // by emitting a colon-separator signature, the SDK rejects it.
  // Catches the case where the API ships a partial refactor.
  it('SDK rejects a colon-separator template', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = '{"event":"test"}';
    const secret = 'whsec_x';
    // Build a signature using the WRONG template (colon vs dot).
    const wrongHmac = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
    const sig = `t=${ts},v1=${wrongHmac}`;
    await expect(
      verifyWebhookSignature({ payload: body, signature: sig, secret }),
    ).rejects.toThrow(/no v1= segment verified/);
  });

  it('SDK rejects a wrong-algorithm digest (SHA-512)', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = '{"event":"test"}';
    const secret = 'whsec_x';
    const sha512Hmac = createHmac('sha512', secret).update(`${ts}.${body}`).digest('hex');
    const sig = `t=${ts},v1=${sha512Hmac}`;
    // SHA-512 produces 128-char hex (64 bytes), but the bytes won't
    // verify with the SDK's SHA-256 key. Reject expected.
    await expect(
      verifyWebhookSignature({ payload: body, signature: sig, secret }),
    ).rejects.toThrow(/no v1= segment verified/);
  });
});
