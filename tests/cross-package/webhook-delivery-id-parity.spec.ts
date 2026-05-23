// Cross-package parity — webhook delivery-id dedupe end-to-end recipe.
//
// The M-WEBHOOK arc ships three composable primitives:
//   - M-WEBHOOK-1: signature verify  (`verifyWebhookSignature`)
//   - M-WEBHOOK-2: replay dedupe     (`assertNotReplay` + `WebhookReplayStore`)
//   - M-WEBHOOK-3: typed narrowing   (`interpretWebhookEvent`)
//
// Each has its own narrower parity gate:
//   - `webhook-signature-parity.spec.ts` — sign/verify byte-equivalence
//     and header-name presence in API source.
//   - `webhook-event-emitter-parity.spec.ts` — every API-emitted event
//     name resolves to a `WEBHOOK_EVENT` catalog entry.
//
// THIS gate fills the missing seam: the **recipe-level contract**. It
// asserts that an API-shaped delivery — signed body + delivery-id +
// event header — round-trips through the full SDK recipe with no
// drift, AND that the SDK dedupe correctly rejects a re-fire of the
// same delivery id.
//
// Drift this gate catches:
//   - API switches X-AEGIS-Delivery-Id to anything OTHER than `delivery.id`
//     (e.g. delivery.subscriptionId, delivery.principalId) — would silently
//     break dedupe correctness because the stamped value is no longer
//     unique-per-attempt.
//   - API changes the CUID id format to ULID/UUID without a coordinated
//     SDK release — would still pass dedupe (strings still compare
//     equal), but the resulting wire-shape change deserves an explicit
//     test-failure conversation rather than a silent format swap.
//   - SDK's `assertNotReplay` rejects what the API actually emits (empty
//     string, whitespace-padded, etc.) — would silently fail in prod.
//
// Strategy: no NestJS bootstrap. Build the same headers + body the API
// would emit using primitives that mirror the API exactly, push them
// through the SDK's public surface, and assert each step's contract.

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEBHOOK_EVENT } from '../../packages/types/src/constants';
import {
  assertNotReplay,
  AegisWebhookReplayDetectedError,
  createMemoryReplayStore,
} from '../../packages/sdk-ts/src/webhook-replay';
import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  verifyWebhookSignature,
} from '../../packages/sdk-ts/src/webhook';
import { interpretWebhookEvent } from '../../packages/sdk-ts/src/webhook-events';

const REPO_ROOT = join(__dirname, '..', '..');
const DELIVERY_SRC = join(
  REPO_ROOT,
  'apps',
  'api',
  'src',
  'modules',
  'webhooks',
  'webhook.delivery.ts',
);
const SCHEMA_SRC = join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma');

/**
 * Inline mirror of the API's signing routine
 * (`WebhookDeliveryWorker.sign`). If this drifts, the source-shape
 * assertions in `webhook-signature-parity.spec.ts` catch it.
 */
function apiSign(secret: string, ts: number, body: string): string {
  const h = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${h}`;
}

/**
 * Mint a CUID-shaped delivery id. The schema declares
 * `id String @id @default(cuid())` for WebhookDelivery; in CI we don't
 * spin up Prisma, but we mint an id that matches the same shape so the
 * SDK's dedupe is exercised against realistic input. The id format
 * assertion below locks the API side; this helper locks our test side.
 */
function mintDeliveryId(): string {
  // CUID-shape: 'c' prefix + 24 hex chars from a randomBytes-derived suffix.
  // Real CUIDs use base36 — the SDK only cares the id is a non-empty
  // opaque string, so any unique-string format is acceptable here.
  return `c${randomBytes(12).toString('hex')}`;
}

/**
 * Simulate a complete API delivery — produces exactly what a customer
 * receiver would observe on the wire. Returns a struct the test then
 * walks through the SDK recipe.
 */
function simulateApiDelivery(opts: {
  event: string;
  payload: Record<string, unknown>;
  secret: string;
  now?: number;
}): {
  headers: Record<string, string>;
  body: string;
  ts: number;
  deliveryId: string;
} {
  const ts = opts.now ?? Math.floor(Date.now() / 1000);
  const deliveryId = mintDeliveryId();
  // The API serializes via JSON.stringify on the payload column. The
  // exact bytes matter — they're what the HMAC is computed over.
  const body = JSON.stringify({
    event: opts.event,
    subscriptionId: 'sub_test',
    deliveryId,
    occurredAt: new Date(ts * 1000).toISOString(),
    data: opts.payload,
  });
  const signature = apiSign(opts.secret, ts, body);
  return {
    headers: {
      [WEBHOOK_SIGNATURE_HEADER]: signature,
      [WEBHOOK_EVENT_HEADER]: opts.event,
      [WEBHOOK_DELIVERY_ID_HEADER]: deliveryId,
    },
    body,
    ts,
    deliveryId,
  };
}

describe('webhook delivery-id parity — API source-shape lock', () => {
  it('API stamps X-AEGIS-Delivery-Id with delivery.id (not any other field)', () => {
    // SEMANTIC LOCK: if a future refactor changes the right-hand side
    // to `delivery.subscriptionId` or `delivery.attemptId`, dedupe
    // correctness silently breaks (the value is no longer unique per
    // attempt). This test fails BEFORE that ships.
    const src = readFileSync(DELIVERY_SRC, 'utf8');
    expect(src).toMatch(
      /['"`]X-AEGIS-Delivery-Id['"`]\s*:\s*delivery\.id\b/,
    );
  });

  it('WebhookDelivery.id is a CUID per the Prisma schema', () => {
    // FORMAT LOCK: drifting from CUID to ULID/UUID is a wire-shape
    // change customers can observe. We want that to surface as a test
    // failure for an explicit conversation, not a silent swap.
    const schema = readFileSync(SCHEMA_SRC, 'utf8');
    const model = schema.match(
      /model WebhookDelivery\s*\{[\s\S]*?\n\}/,
    )?.[0];
    expect(model, 'WebhookDelivery model must exist in schema.prisma').toBeDefined();
    expect(model).toMatch(/\bid\s+String\s+@id\s+@default\(cuid\(\)\)/);
  });
});

describe('webhook recipe parity — end-to-end verify → dedupe → narrow', () => {
  const SECRET = 'whsec_recipe_parity_check';

  it('a fresh API delivery passes verifySignature, assertNotReplay, and interpretWebhookEvent', async () => {
    const delivery = simulateApiDelivery({
      event: WEBHOOK_EVENT.AGENT_POLICY_EXPIRED,
      payload: {
        agentId: 'agt_test_123',
        policyId: 'pol_test_456',
        expiredAt: new Date(delivery_ts()).toISOString(),
      },
      secret: SECRET,
    });
    const store = createMemoryReplayStore();

    // Step 1: signature verification.
    const verified = await verifyWebhookSignature({
      payload: delivery.body,
      signature: delivery.headers[WEBHOOK_SIGNATURE_HEADER]!,
      secret: SECRET,
    });
    expect(verified.timestamp).toBe(delivery.ts);

    // Step 2: replay dedupe — first sight passes.
    await expect(
      assertNotReplay({
        store,
        deliveryId: delivery.headers[WEBHOOK_DELIVERY_ID_HEADER]!,
        ttlSeconds: 86_400,
      }),
    ).resolves.toBeUndefined();

    // Step 3: typed narrowing — catalog event name resolves.
    const event = interpretWebhookEvent(JSON.parse(delivery.body));
    expect(event.event).toBe(WEBHOOK_EVENT.AGENT_POLICY_EXPIRED);
  });

  it('a re-fire of the SAME delivery is rejected at the dedupe step (and never reaches narrowing)', async () => {
    const delivery = simulateApiDelivery({
      event: WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED,
      payload: { agentId: 'agt_x', previousScore: 80, score: 60 },
      secret: SECRET,
    });
    const store = createMemoryReplayStore();
    const id = delivery.headers[WEBHOOK_DELIVERY_ID_HEADER]!;

    // First delivery: passes.
    await verifyWebhookSignature({
      payload: delivery.body,
      signature: delivery.headers[WEBHOOK_SIGNATURE_HEADER]!,
      secret: SECRET,
    });
    await assertNotReplay({ store, deliveryId: id, ttlSeconds: 86_400 });

    // The exact same delivery again — signature is STILL valid (within
    // the timestamp window) — but dedupe catches it. This is the whole
    // point of M-WEBHOOK-2.
    await verifyWebhookSignature({
      payload: delivery.body,
      signature: delivery.headers[WEBHOOK_SIGNATURE_HEADER]!,
      secret: SECRET,
    });
    await expect(
      assertNotReplay({ store, deliveryId: id, ttlSeconds: 86_400 }),
    ).rejects.toBeInstanceOf(AegisWebhookReplayDetectedError);
  });

  it('two different deliveries of the SAME event type are not collapsed by dedupe', async () => {
    // Sanity: dedupe must key on delivery-id, NOT on event name. Two
    // independent "policy expired" deliveries for two different agents
    // must both reach the customer handler.
    const a = simulateApiDelivery({
      event: WEBHOOK_EVENT.AGENT_POLICY_EXPIRED,
      payload: { agentId: 'agt_1', policyId: 'pol_1' },
      secret: SECRET,
    });
    const b = simulateApiDelivery({
      event: WEBHOOK_EVENT.AGENT_POLICY_EXPIRED,
      payload: { agentId: 'agt_2', policyId: 'pol_2' },
      secret: SECRET,
    });
    expect(a.deliveryId).not.toBe(b.deliveryId);

    const store = createMemoryReplayStore();
    await assertNotReplay({
      store,
      deliveryId: a.headers[WEBHOOK_DELIVERY_ID_HEADER]!,
      ttlSeconds: 60,
    });
    await expect(
      assertNotReplay({
        store,
        deliveryId: b.headers[WEBHOOK_DELIVERY_ID_HEADER]!,
        ttlSeconds: 60,
      }),
    ).resolves.toBeUndefined();
  });

  it('SDK assertNotReplay accepts the delivery-id format the API actually emits (non-empty opaque string)', async () => {
    // Wire-shape robustness: even if the API ever swapped CUID → ULID
    // or added a `del_` prefix, the SDK helper must still accept the
    // emitted value as-is. This test exercises three shapes:
    //   - CUID-like (current)
    //   - ULID-like (potential future)
    //   - prefixed (potential future)
    const shapes = [
      'cabc1234567890ijklmnopqr', // CUID-like
      '01HZX5Q3K8VFAB7Y0WJP4MTNCD', // ULID-like (Crockford base32)
      'del_01HZX5Q3K8VFAB7Y0WJP4MTNCD', // prefixed
    ];
    const store = createMemoryReplayStore();
    for (const id of shapes) {
      await expect(
        assertNotReplay({ store, deliveryId: id, ttlSeconds: 60 }),
      ).resolves.toBeUndefined();
    }
  });
});

/**
 * Stable "now" helper so the suite is deterministic even if a test
 * happens to straddle a second boundary.
 */
function delivery_ts(): number {
  return 1_716_400_000_000; // fixed 2024-05-22T20:26:40Z in ms
}
