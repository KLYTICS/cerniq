// Webhook payload parity — guards the wire contract for every webhook event
// that AEGIS HMAC-signs and POSTs to subscribers.
//
// Why this is load-bearing:
//   Before this spec, the API persisted webhook deliveries with `payload:
//   Prisma.InputJsonValue` and POSTed `JSON.stringify({id, event, data, ts})`
//   where `data` was whatever the emitting worker happened to put there.
//   A field rename on the producer side without a coordinated subscriber
//   update was a silent-failure-class bug: subscribers pinned to the old
//   shape would parse `undefined` for the missing field, and no CI guard
//   would notice. Same class as the audit-chain export drift fixed
//   alongside this.
//
//   The fix is a Zod schema per event type in `@aegis/types`, and this
//   spec is the CI gate that ties:
//     1. The schema registry (`WEBHOOK_PAYLOAD_SCHEMA`)
//     2. The producer-side payload builders (`buildTrustScoreChangedPayload`,
//        `buildPolicyExpiredPayload`)
//     3. The on-wire envelope shape used by the delivery worker
//        (`WebhookDeliveryWorker.sign` + `JSON.stringify({id,event,data,ts})`)
//     4. The `WEBHOOK_EVENT` constant catalog
//   …into one provable invariant: a body emitted by the producer parses
//   against its schema, signs cleanly, and round-trips through the envelope.
//
//   If anyone drops a field from a payload builder, or adds one to the
//   schema without updating the builder, this spec fails. Treat any
//   failure here as a wire-contract break — subscribers see it.
//
// Run via the parity suite: `pnpm test:parity`.

import { describe, expect, it } from 'vitest';

import { WEBHOOK_EVENT } from '../../packages/types/src/constants';
import {
  WEBHOOK_PAYLOAD_RESERVED,
  WEBHOOK_PAYLOAD_SCHEMA,
  WebhookEnvelopeSchema,
  WebhookPayloadValidationError,
  WebhookPolicyExpiredPayloadSchema,
  WebhookTrustScoreChangedPayloadSchema,
  validateWebhookPayload,
} from '../../packages/types/src/webhooks';
// Public-API anchor: also import through the package barrel. If anyone
// breaks the re-export in `packages/types/src/index.ts`, the public consumers
// (SDK, dashboard, verifier-rp) lose access — but a parity test that imports
// only via internal paths would never notice. This sibling import catches
// that drift class.
import * as AegisTypesPublic from '../../packages/types/src/index';
import { buildTrustScoreChangedPayload } from '../../apps/api/src/modules/bate/bate.worker';
import { buildPolicyExpiredPayload } from '../../apps/api/src/modules/policy/policy.expiry.worker';
import { WebhookDeliveryWorker } from '../../apps/api/src/modules/webhooks/webhook.delivery';

// ── Public API surface ───────────────────────────────────────────────────

describe('public @aegis/types webhook surface', () => {
  // Customers consume `@aegis/types` via the package barrel
  // (`packages/types/src/index.ts`). Importing the same names internally is
  // not the same contract as exporting them publicly — a missed re-export
  // would silently break SDK + dashboard + verifier-rp consumers. This
  // suite is the public-surface guard.
  it('re-exports every webhook schema, helper, and constant via the package barrel', () => {
    const requiredExports = [
      'WEBHOOK_EVENT',
      'WEBHOOK_PAYLOAD_SCHEMA',
      'WEBHOOK_PAYLOAD_RESERVED',
      'WebhookEnvelopeSchema',
      'WebhookTrustScoreChangedPayloadSchema',
      'WebhookPolicyExpiredPayloadSchema',
      'WebhookPayloadValidationError',
      'validateWebhookPayload',
    ] as const;
    for (const name of requiredExports) {
      expect(AegisTypesPublic, `@aegis/types is missing public export '${name}'`).toHaveProperty(
        name,
      );
    }
  });

  it('public WEBHOOK_EVENT values are identical to the internal-import view', () => {
    // Catches an accidental shadowing where index.ts re-exports a different
    // constants module (e.g. someone introduces a generated shim). Triple-
    // equal on object identity — both imports MUST resolve to the same
    // frozen constant.
    expect(AegisTypesPublic.WEBHOOK_EVENT).toBe(WEBHOOK_EVENT);
    expect(AegisTypesPublic.WEBHOOK_PAYLOAD_SCHEMA).toBe(WEBHOOK_PAYLOAD_SCHEMA);
    expect(AegisTypesPublic.WEBHOOK_PAYLOAD_RESERVED).toBe(WEBHOOK_PAYLOAD_RESERVED);
  });

  it('the public validator behaves identically to the internal validator', () => {
    // Same function, accessed two ways. A drift here means index.ts shipped
    // a stale snapshot of the validator.
    expect(AegisTypesPublic.validateWebhookPayload).toBe(validateWebhookPayload);
  });
});

// ── Catalog ↔ schema-registry alignment ──────────────────────────────────

describe('webhook event catalog ↔ payload schema registry', () => {
  it('every WEBHOOK_EVENT value is either in WEBHOOK_PAYLOAD_SCHEMA or WEBHOOK_PAYLOAD_RESERVED', () => {
    const catalogValues = new Set(Object.values(WEBHOOK_EVENT));
    const schemaKeys = new Set(Object.keys(WEBHOOK_PAYLOAD_SCHEMA));
    const reserved = WEBHOOK_PAYLOAD_RESERVED;
    for (const eventType of catalogValues) {
      const covered = schemaKeys.has(eventType) || reserved.has(eventType);
      expect(covered, `event '${eventType}' has no schema and is not reserved`).toBe(true);
    }
  });

  it('schema registry keys are all declared in WEBHOOK_EVENT', () => {
    const catalogValues = new Set<string>(Object.values(WEBHOOK_EVENT));
    for (const key of Object.keys(WEBHOOK_PAYLOAD_SCHEMA)) {
      expect(
        catalogValues.has(key),
        `schema key '${key}' is not in WEBHOOK_EVENT`,
      ).toBe(true);
    }
  });

  it('reserved set entries are all declared in WEBHOOK_EVENT', () => {
    const catalogValues = new Set<string>(Object.values(WEBHOOK_EVENT));
    for (const key of WEBHOOK_PAYLOAD_RESERVED) {
      expect(
        catalogValues.has(key),
        `reserved entry '${key}' is not in WEBHOOK_EVENT`,
      ).toBe(true);
    }
  });

  it('no event is simultaneously in both the schema registry and the reserved set', () => {
    for (const key of Object.keys(WEBHOOK_PAYLOAD_SCHEMA)) {
      expect(
        WEBHOOK_PAYLOAD_RESERVED.has(key),
        `event '${key}' is both registered and reserved`,
      ).toBe(false);
    }
  });
});

// ── Producer-builder ↔ schema round-trip ─────────────────────────────────

describe('aegis.agent.trust_score_changed — producer ↔ schema round-trip', () => {
  it('builder output parses against the schema', () => {
    const payload = buildTrustScoreChangedPayload({
      agentId: 'agt_parity_1',
      score: 720,
      previousScore: 480,
      band: 'VERIFIED',
      previousBand: 'WATCH',
      explanation: {
        weightsVersion: 'v1.2.3',
        contributors: [
          { kind: 'recompute', delta: 240, reason: 'positive_signal_burst' },
          { kind: 'cold_start', delta: 0, reason: 'cold_start_complete' },
        ],
      },
    });
    const parsed = WebhookTrustScoreChangedPayloadSchema.parse(payload);
    // Every field the builder emits must be schema-known; every schema field
    // must be builder-emitted. This is the actual drift guard.
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(payload).sort());
  });

  it('validateWebhookPayload accepts a builder-produced payload', () => {
    const payload = buildTrustScoreChangedPayload({
      agentId: 'agt_parity_2',
      score: 1000,
      previousScore: 999,
      band: 'PLATINUM',
      previousBand: 'VERIFIED',
      explanation: { weightsVersion: 'v1', contributors: [] },
    });
    expect(() =>
      validateWebhookPayload(WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED, payload),
    ).not.toThrow();
  });

  it('schema rejects a builder output that has had a field dropped', () => {
    // Synthetic mutation to prove the schema is actually validating.
    // If the schema becomes permissive (e.g. someone adds `.partial()`),
    // this test catches it.
    const payload = buildTrustScoreChangedPayload({
      agentId: 'agt_parity_3',
      score: 500,
      previousScore: 600,
      band: 'WATCH',
      previousBand: 'VERIFIED',
      explanation: { weightsVersion: 'v1', contributors: [] },
    });
    const broken: Record<string, unknown> = { ...payload };
    delete broken.weightsVersion;
    expect(WebhookTrustScoreChangedPayloadSchema.safeParse(broken).success).toBe(false);
  });
});

describe('aegis.policy.expired — producer ↔ schema round-trip', () => {
  it('builder output parses against the schema', () => {
    const expiredAt = new Date('2026-05-01T00:00:00.000Z');
    const sweptAt = new Date('2026-05-01T00:05:00.000Z');
    const payload = buildPolicyExpiredPayload({
      policyId: 'pol_parity_1',
      agentId: 'agt_parity_1',
      expiredAt,
      sweptAt,
    });
    const parsed = WebhookPolicyExpiredPayloadSchema.parse(payload);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(payload).sort());
    // Concrete shape commitments — these are public-API expectations.
    expect(parsed.expiredAt).toBe(expiredAt.toISOString());
    expect(parsed.sweptAt).toBe(sweptAt.toISOString());
  });

  it('validateWebhookPayload accepts a builder-produced payload', () => {
    const payload = buildPolicyExpiredPayload({
      policyId: 'pol_parity_2',
      agentId: 'agt_parity_2',
      expiredAt: new Date('2026-04-30T23:59:59.000Z'),
      sweptAt: new Date('2026-05-01T00:00:01.000Z'),
    });
    expect(() =>
      validateWebhookPayload(WEBHOOK_EVENT.POLICY_EXPIRED, payload),
    ).not.toThrow();
  });

  it('schema rejects a builder output that has had a field dropped', () => {
    const payload = buildPolicyExpiredPayload({
      policyId: 'pol_parity_3',
      agentId: 'agt_parity_3',
      expiredAt: new Date('2026-04-29T00:00:00.000Z'),
      sweptAt: new Date('2026-04-29T00:05:00.000Z'),
    });
    const broken: Record<string, unknown> = { ...payload };
    delete broken.policyId;
    expect(WebhookPolicyExpiredPayloadSchema.safeParse(broken).success).toBe(false);
  });
});

// ── Envelope + signing round-trip ────────────────────────────────────────

describe('on-wire envelope and HMAC signature', () => {
  it('envelope {id, event, data, ts} parses for every emitted event type', () => {
    const payloads: Array<{ event: string; data: unknown }> = [
      {
        event: WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED,
        data: buildTrustScoreChangedPayload({
          agentId: 'agt_env_1',
          score: 700,
          previousScore: 480,
          band: 'VERIFIED',
          previousBand: 'WATCH',
          explanation: { weightsVersion: 'v1', contributors: [] },
        }),
      },
      {
        event: WEBHOOK_EVENT.POLICY_EXPIRED,
        data: buildPolicyExpiredPayload({
          policyId: 'pol_env_1',
          agentId: 'agt_env_1',
          expiredAt: new Date('2026-04-01T00:00:00.000Z'),
          sweptAt: new Date('2026-04-01T00:05:00.000Z'),
        }),
      },
    ];

    for (const { event, data } of payloads) {
      // Build the body exactly the way the delivery worker does (static helper
      // is exported precisely so this assertion is byte-equivalent to prod).
      const body = WebhookDeliveryWorker.buildEnvelope(
        `del_${event}`,
        event,
        data,
        1_715_000_000,
      );
      const reparsed = WebhookEnvelopeSchema.parse(JSON.parse(body));
      expect(reparsed.event).toBe(event);
      expect(reparsed.data).toEqual(data);

      // Signature shape and HMAC determinism.
      const signature = WebhookDeliveryWorker.sign('whsec_test_secret', reparsed.ts, body);
      expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      // Same inputs → byte-identical signature (rules out non-determinism).
      expect(WebhookDeliveryWorker.sign('whsec_test_secret', reparsed.ts, body)).toBe(signature);

      // The inner payload parses against its per-event schema.
      expect(() => validateWebhookPayload(reparsed.event, reparsed.data)).not.toThrow();
    }
  });

  it('buildEnvelope() emits keys in the canonical order id,event,data,ts (byte-level)', () => {
    // The HMAC is computed over the body BYTES. Reordering envelope keys
    // changes the bytes and therefore the signature — even with identical
    // semantic content. Subscribers that follow the "verify against raw
    // body bytes" guidance in docs/SECURITY.md don't care, but downstream
    // tooling (CLI dump, dashboards, regulatory exports) does, and we want
    // future drift to be loud.
    const body = WebhookDeliveryWorker.buildEnvelope(
      'del_order',
      WEBHOOK_EVENT.POLICY_EXPIRED,
      { policyId: 'pol_x', agentId: 'agt_x', expiredAt: '2026-01-01T00:00:00.000Z', sweptAt: '2026-01-01T00:00:01.000Z' },
      1_715_000_000,
    );
    expect(body).toBe(
      '{"id":"del_order","event":"aegis.policy.expired","data":{"policyId":"pol_x","agentId":"agt_x","expiredAt":"2026-01-01T00:00:00.000Z","sweptAt":"2026-01-01T00:00:01.000Z"},"ts":1715000000}',
    );
  });

  it('envelope schema rejects extra top-level fields (strict mode)', () => {
    // .strict() guards against producers smuggling fields the contract does
    // not know about. Critical because the service signs `event.data`, not
    // the parsed schema output — without strict mode, an extra field would
    // ride the wire while passing validation.
    const result = WebhookEnvelopeSchema.safeParse({
      id: 'del_1',
      event: WEBHOOK_EVENT.POLICY_EXPIRED,
      data: {},
      ts: 1_715_000_000,
      // Extra envelope field:
      attacker_controlled: 'value',
    });
    expect(result.success).toBe(false);
  });

  it('payload schemas reject extra fields (strict mode)', () => {
    const result = WebhookPolicyExpiredPayloadSchema.safeParse({
      policyId: 'pol_1',
      agentId: 'agt_1',
      expiredAt: '2026-01-01T00:00:00.000Z',
      sweptAt: '2026-01-01T00:00:01.000Z',
      extra: 'should be rejected',
    });
    expect(result.success).toBe(false);
  });
});

// ── Producer-side guards ─────────────────────────────────────────────────

describe('validateWebhookPayload guard behavior', () => {
  it('throws WebhookPayloadValidationError on unknown event type', () => {
    expect(() => validateWebhookPayload('not.a.real.event', {})).toThrow(
      WebhookPayloadValidationError,
    );
  });

  it('throws WebhookPayloadValidationError on reserved event type', () => {
    expect(() =>
      validateWebhookPayload(WEBHOOK_EVENT.AGENT_REVOKED, { agentId: 'agt_1' }),
    ).toThrow(WebhookPayloadValidationError);
  });

  it('throws WebhookPayloadValidationError on shape mismatch', () => {
    expect(() =>
      validateWebhookPayload(WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED, {
        agentId: 'agt_1',
        // missing every other required field
      }),
    ).toThrow(WebhookPayloadValidationError);
  });
});
