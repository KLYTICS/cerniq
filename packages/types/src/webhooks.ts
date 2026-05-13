// Webhook wire-format schemas — single source of truth for the JSON bodies
// AEGIS HMAC-signs and POSTs to subscribers.
//
// Why this file exists:
//   The webhook delivery worker builds a signed envelope `{id, event, data, ts}`
//   and POSTs it. Until 2026-05-12 the `data` field was a free-form
//   `Record<string, unknown>` and the only contract was whatever the emitting
//   worker happened to put inside it. A field rename on one side without the
//   other was a silent-failure-class bug — relying parties pinned to one shape,
//   the server quietly emitting another, and no CI guard catching the drift.
//   Same class as the audit-chain export bug fix that preceded this module.
//
//   Schemas here ARE the wire contract. The API emit sites import the inferred
//   types so TypeScript catches drift at compile time, and
//   `validateWebhookPayload()` enforces it at runtime. The cross-package parity
//   test (`tests/cross-package/webhook-payload-parity.spec.ts`) is the load-
//   bearing CI guard: it round-trips one of each event through the emit code
//   path and the on-wire signer, asserting the body parses against this schema.
//
//   Adding a new webhook event:
//     1. Add the constant to `WEBHOOK_EVENT` in `./constants.ts`.
//     2. Define a payload schema here and register it in `WEBHOOK_PAYLOAD_SCHEMA`.
//     3. Type the emit site's payload using `WebhookPayloadOf<typeof EVENT>`.
//     4. Add an event-specific case to the parity test.
//
//   Reserved events (declared in `WEBHOOK_EVENT` but with no producer yet) are
//   listed in `WEBHOOK_PAYLOAD_RESERVED`. Emitting one of those throws — the
//   contract must be defined here before code starts shipping the event.

import { z } from 'zod';

import { WEBHOOK_EVENT } from './constants.js';
import {
  AgentIdSchema,
  IsoDateTimeSchema,
  PolicyIdSchema,
  TrustBandSchema,
} from './schemas.js';

// ── On-wire envelope ─────────────────────────────────────────────────
//
// This is the literal JSON body that gets HMAC-signed and POSTed. The HMAC
// header is `X-AEGIS-Signature: t=<ts>,v1=<hex>` where the signed input is
// `${ts}.${JSON.stringify(envelope)}`. Subscribers should re-stringify with
// the same fields in the same order to recompute — the canonical order is
// `id, event, data, ts`, exactly as `JSON.stringify({id, event, data, ts})`
// emits it (insertion order in V8 / engines that follow ES2015 spec).

export const WebhookEnvelopeSchema = z
  .object({
    /** Stable per-delivery id; useful for subscriber-side idempotency. */
    id: z.string().min(1),
    /** Event type — one of `WEBHOOK_EVENT` values. */
    event: z.string().min(1),
    /** Event-type-specific payload; shape is governed by `WEBHOOK_PAYLOAD_SCHEMA`. */
    data: z.unknown(),
    /** Unix seconds at the moment of signing. Subscribers should reject deltas > 5 min. */
    ts: z.number().int().nonnegative(),
  })
  // .strict() so extra envelope fields cause validation failure. Adding a new
  // top-level field to the envelope is a wire-format break that needs explicit
  // schema work; silently passing one through would defeat the parity guard.
  .strict();

export type WebhookEnvelope = z.infer<typeof WebhookEnvelopeSchema>;

// ── Per-event payload schemas ────────────────────────────────────────

/**
 * Payload for `aegis.agent.trust_score_changed`.
 *
 * Emitted by the BATE recompute worker when an agent's trust band crosses a
 * threshold (e.g. VERIFIED → WATCH). Score-only changes within a band do NOT
 * emit — subscribers should treat band transitions as the actionable signal.
 */
export const WebhookTrustScoreChangedPayloadSchema = z
  .object({
    agentId: AgentIdSchema,
    score: z.number().int().min(0).max(1000),
    previousScore: z.number().int().min(0).max(1000),
    band: TrustBandSchema,
    previousBand: TrustBandSchema,
    weightsVersion: z.string().min(1),
    contributors: z.array(
      z
        .object({
          kind: z.string().min(1),
          delta: z.number().finite(),
          reason: z.string(),
        })
        .strict(),
    ),
  })
  // .strict() — extra fields are a contract break. Default `strip` would
  // silently drop them from the parsed result but leave them in the on-wire
  // body (the service signs `event.data`, not the parsed result), creating
  // a hole the parity test could not see. See ADR comment in this module.
  .strict();

export type WebhookTrustScoreChangedPayload = z.infer<
  typeof WebhookTrustScoreChangedPayloadSchema
>;

/**
 * Payload for `aegis.policy.expired`.
 *
 * Emitted by the policy-expiry sweep worker for every policy it auto-revokes
 * after its `expiresAt` passes. Subscribers should refresh the affected
 * agent's policy on receipt.
 */
export const WebhookPolicyExpiredPayloadSchema = z
  .object({
    policyId: PolicyIdSchema,
    agentId: AgentIdSchema,
    expiredAt: IsoDateTimeSchema,
    sweptAt: IsoDateTimeSchema,
  })
  // .strict() — see comment on WebhookTrustScoreChangedPayloadSchema. Extra
  // fields here would slip onto the wire silently under default `strip`.
  .strict();

export type WebhookPolicyExpiredPayload = z.infer<
  typeof WebhookPolicyExpiredPayloadSchema
>;

// ── Registry: event type → payload schema ────────────────────────────

/**
 * Every webhook event with a live producer in the API. The key is the wire
 * event-type string; the value is the Zod schema for that event's `data`
 * field inside the envelope.
 *
 * If you add a producer for a reserved event (see `WEBHOOK_PAYLOAD_RESERVED`),
 * move the entry from there into this map in the same change.
 */
export const WEBHOOK_PAYLOAD_SCHEMA = {
  [WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED]: WebhookTrustScoreChangedPayloadSchema,
  [WEBHOOK_EVENT.POLICY_EXPIRED]: WebhookPolicyExpiredPayloadSchema,
} as const satisfies Record<string, z.ZodTypeAny>;

export type WebhookPayloadSchemaMap = typeof WEBHOOK_PAYLOAD_SCHEMA;
export type WebhookEventWithPayload = keyof WebhookPayloadSchemaMap;

/** Compile-time payload type for a given event. */
export type WebhookPayloadOf<E extends WebhookEventWithPayload> = z.infer<
  WebhookPayloadSchemaMap[E]
>;

/**
 * Events declared in `WEBHOOK_EVENT` for forward-compatibility but with no
 * producer in the API source today. Emitting one of these throws via
 * `validateWebhookPayload` — adding a producer must be paired with adding a
 * payload schema above (move it out of this set).
 *
 * This is the no-fabricated-data invariant from CLAUDE.md applied to webhook
 * contracts: rather than ship synthetic schemas for unimplemented events
 * (which would lock subscribers into a shape we have not actually verified),
 * we keep them explicitly reserved and require a real shape to be observed
 * before locking it.
 */
export const WEBHOOK_PAYLOAD_RESERVED: ReadonlySet<string> = new Set([
  WEBHOOK_EVENT.AGENT_REVOKED,
  WEBHOOK_EVENT.ANOMALY_DETECTED,
  WEBHOOK_EVENT.AGENT_FLAGGED_BY_RELYING_PARTY,
]);

// ── Validator + error type ──────────────────────────────────────────

export class WebhookPayloadValidationError extends Error {
  public readonly eventType: string;
  public readonly zodError?: unknown;

  constructor(message: string, eventType: string, zodError?: unknown) {
    super(message);
    this.name = 'WebhookPayloadValidationError';
    this.eventType = eventType;
    this.zodError = zodError;
  }
}

/**
 * Validate a webhook event body against the schema registered for its event
 * type. Returns the parsed (schema-coerced) data on success; throws
 * `WebhookPayloadValidationError` on:
 *
 *   - Unknown event type (caller emitting something not in `WEBHOOK_EVENT`)
 *   - Reserved event type (caller emitting before a schema is defined)
 *   - Shape mismatch (the silent-failure class this whole module guards)
 *
 * Callers MUST let the error propagate. CLAUDE.md invariant 4 (no silent
 * failures) applies: catching and logging here would re-introduce the exact
 * drift bug this module exists to eliminate.
 */
export function validateWebhookPayload(type: string, data: unknown): unknown {
  if (WEBHOOK_PAYLOAD_RESERVED.has(type)) {
    throw new WebhookPayloadValidationError(
      `webhook event '${type}' is reserved — no schema defined yet. ` +
        `Add a payload schema to packages/types/src/webhooks.ts and move ` +
        `the event out of WEBHOOK_PAYLOAD_RESERVED before emitting.`,
      type,
    );
  }
  const schema = (WEBHOOK_PAYLOAD_SCHEMA as Record<string, z.ZodTypeAny>)[type];
  if (!schema) {
    throw new WebhookPayloadValidationError(
      `unknown webhook event '${type}' — not declared in WEBHOOK_EVENT.`,
      type,
    );
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new WebhookPayloadValidationError(
      `webhook payload for '${type}' failed schema validation: ${result.error.message}`,
      type,
      result.error,
    );
  }
  return result.data as unknown;
}
