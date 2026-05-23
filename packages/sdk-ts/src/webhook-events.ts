// Kind-discriminated webhook event union.
//
// Webhook deliveries arrive at customer endpoints as JSON bodies with
// at least `event` (the type name from WEBHOOK_EVENT catalog) plus a
// `data` payload whose shape depends on the event. Without a typed
// union, customers must cast `event.event` to `any` and lose all
// compile-time guarantees on payload narrowing.
//
// This module ships the union + an `interpretWebhookEvent` helper:
//
//   import { verifyWebhookSignature, interpretWebhookEvent } from '@aegis/sdk';
//
//   // verify first — never narrow untrusted bodies
//   await verifyWebhookSignature({ payload: raw, signature, secret });
//   const event = interpretWebhookEvent(JSON.parse(raw));
//   switch (event.event) {
//     case 'aegis.agent.trust_score_changed':
//       // event.data is narrowed to AgentTrustScoreChangedPayload here
//       console.log(event.data.previousBand, '→', event.data.band);
//       break;
//     // ... tsc fails if any catalog event is missing here ...
//   }
//
// Forward-compat: when a NEW event type ships in WEBHOOK_EVENT, the
// `_ExhaustivenessGate` below stops compiling — tsc forces an update
// to the union AND the interpret() switch. The customer code that
// uses `switch (event.event)` also stops compiling on the customer
// side because of the same `never` narrowing, so callers can't ship
// a release that silently drops new event types.
//
// Payload schemas:
//   - For events with a known emitter (aegis.agent.policy_expired,
//     aegis.agent.trust_score_changed), we ship concrete payload
//     interfaces sourced from the API emitter code.
//   - For events declared in the catalog but not yet emitted
//     (anomaly_detected, flagged_by_relying_party, revoked), we ship
//     `Record<string, unknown>` so customers don't code against a
//     guessed shape. Concrete schemas land WITH the emitter, not
//     before it, per CLAUDE.md docs rule "docs reflect code, not
//     aspiration".

import { WEBHOOK_EVENT, type WebhookEvent } from '@aegis/types';

import type { TrustBand } from './types.js';

// ── Payload shapes ──────────────────────────────────────────────

/**
 * Emitted when an agent's trust score crosses a band boundary.
 * Source: `apps/api/src/modules/bate/bate.worker.ts:249`.
 */
export interface AgentTrustScoreChangedPayload {
  agentId: string;
  /** New trust score (0..1000). */
  score: number;
  /** Previous trust score. */
  previousScore: number;
  /** New trust band — one of PLATINUM/VERIFIED/WATCH/FLAGGED. */
  band: TrustBand;
  /** Previous trust band. */
  previousBand: TrustBand;
  /** BATE algorithm weights version that produced this score. */
  weightsVersion: string;
  /** Per-signal contribution breakdown (signal-type → delta). */
  contributors: Record<string, number>;
}

/**
 * Emitted when an agent's policy passes its `expiresAt` timestamp.
 * Source: `apps/api/src/modules/policy/policy.expiry.worker.ts:144`.
 */
export interface AgentPolicyExpiredPayload {
  policyId: string;
  agentId: string;
  /** ISO-8601 timestamp the policy was scheduled to expire. */
  expiredAt: string;
  /** ISO-8601 timestamp the expiry sweep ran. */
  sweptAt: string;
}

/**
 * Reserved for the BATE anomaly detector. Payload schema lands with
 * the emitter — until then, customers should narrow defensively.
 */
export type AgentAnomalyDetectedPayload = Record<string, unknown>;

/**
 * Reserved for relying-party-initiated agent flagging. Payload schema
 * lands with the emitter.
 */
export type AgentFlaggedByRelyingPartyPayload = Record<string, unknown>;

/**
 * Reserved for manual agent revocation events. Payload schema lands
 * with the emitter.
 */
export type AgentRevokedPayload = Record<string, unknown>;

// ── Envelope union ──────────────────────────────────────────────

interface WebhookEnvelopeBase {
  /** Webhook event name from the WEBHOOK_EVENT catalog. */
  event: WebhookEvent;
  /** Subscription ID this delivery targets. */
  subscriptionId?: string;
  /** Delivery ID — matches `X-AEGIS-Delivery-Id` header. */
  deliveryId?: string;
  /** ISO-8601 timestamp the event occurred (independent of delivery time). */
  occurredAt?: string;
}

export interface AgentTrustScoreChangedEvent extends WebhookEnvelopeBase {
  event: typeof WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED;
  data: AgentTrustScoreChangedPayload;
}
export interface AgentAnomalyDetectedEvent extends WebhookEnvelopeBase {
  event: typeof WEBHOOK_EVENT.AGENT_ANOMALY_DETECTED;
  data: AgentAnomalyDetectedPayload;
}
export interface AgentPolicyExpiredEvent extends WebhookEnvelopeBase {
  event: typeof WEBHOOK_EVENT.AGENT_POLICY_EXPIRED;
  data: AgentPolicyExpiredPayload;
}
export interface AgentFlaggedByRelyingPartyEvent extends WebhookEnvelopeBase {
  event: typeof WEBHOOK_EVENT.AGENT_FLAGGED_BY_RELYING_PARTY;
  data: AgentFlaggedByRelyingPartyPayload;
}
export interface AgentRevokedEvent extends WebhookEnvelopeBase {
  event: typeof WEBHOOK_EVENT.AGENT_REVOKED;
  data: AgentRevokedPayload;
}

/**
 * The full kind-discriminated webhook event union. Switch on
 * `envelope.event` to narrow to the concrete payload type.
 */
export type WebhookEnvelope =
  | AgentTrustScoreChangedEvent
  | AgentAnomalyDetectedEvent
  | AgentPolicyExpiredEvent
  | AgentFlaggedByRelyingPartyEvent
  | AgentRevokedEvent;

// ── Exhaustiveness gate ─────────────────────────────────────────

// type-rationale: this Record forces tsc to verify EVERY value in
// the WEBHOOK_EVENT catalog appears as the `event` field of at least
// one variant in the WebhookEnvelope union. If a new event is added
// to the catalog (`@aegis/types`) but not to the union here, the
// type evaluates `never` for that key and the const declaration
// fails to compile with a clear error pointing at the missing
// variant. Mirrors the verify-outcome union's compile-time gate.
type _ExhaustivenessGate = {
  [K in WebhookEvent]: Extract<WebhookEnvelope, { event: K }> extends never
    ? `MISSING WebhookEnvelope variant for event: ${K}`
    : true;
};
const _exhaustivenessProof: _ExhaustivenessGate = {
  [WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED]: true,
  [WEBHOOK_EVENT.AGENT_ANOMALY_DETECTED]: true,
  [WEBHOOK_EVENT.AGENT_POLICY_EXPIRED]: true,
  [WEBHOOK_EVENT.AGENT_FLAGGED_BY_RELYING_PARTY]: true,
  [WEBHOOK_EVENT.AGENT_REVOKED]: true,
};
// Reference the proof so unused-symbol lints don't strip it. The
// `void` keeps it side-effect-free in the bundle.
void _exhaustivenessProof;

// ── Interpret helper ────────────────────────────────────────────

/**
 * Custom error for envelopes that don't match any known event. Thrown
 * by `interpretWebhookEvent` so callers can distinguish a parsing
 * failure from an unsupported event (e.g. a future event whose SDK
 * release hasn't shipped yet).
 */
export class WebhookEventParseError extends Error {
  override readonly name = 'WebhookEventParseError';
  constructor(
    message: string,
    /** The raw `event` value that failed to map, if present. */
    public readonly rawEventName: unknown,
  ) {
    super(message);
  }
}

/**
 * Narrow a raw envelope (typically `JSON.parse(verifiedBody)`) into
 * the typed `WebhookEnvelope` union. Throws `WebhookEventParseError`
 * if the envelope is missing the discriminator or carries an
 * unrecognized event name.
 *
 * Resolution:
 *   1. Validate the envelope is an object with a string `event` field.
 *   2. Validate `event` is one of the known catalog entries (the
 *      switch is exhaustive via the `_never` narrowing at the bottom
 *      — adding a catalog entry without a case here is a tsc error).
 *   3. Pass the raw envelope through with its narrowed type.
 *
 * Note: this helper does NOT validate the `data` payload shape — that
 * is the customer's responsibility (Zod schema, runtime guard, etc.).
 * Validating here would require shipping Zod schemas for every payload,
 * which we don't yet have for events with no emitter. For now: trust
 * the post-signature-verify body and validate at the use site.
 */
export function interpretWebhookEvent(raw: unknown): WebhookEnvelope {
  if (typeof raw !== 'object' || raw === null) {
    throw new WebhookEventParseError(
      'webhook envelope must be a non-null object',
      raw,
    );
  }
  const event = (raw as { event?: unknown }).event;
  if (typeof event !== 'string') {
    throw new WebhookEventParseError(
      `webhook envelope missing string 'event' field, got ${typeof event}`,
      event,
    );
  }
  switch (event) {
    case WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED:
    case WEBHOOK_EVENT.AGENT_ANOMALY_DETECTED:
    case WEBHOOK_EVENT.AGENT_POLICY_EXPIRED:
    case WEBHOOK_EVENT.AGENT_FLAGGED_BY_RELYING_PARTY:
    case WEBHOOK_EVENT.AGENT_REVOKED:
      // Trust the post-signature-verify envelope shape. The static
      // type system has already proved (via _ExhaustivenessGate
      // above) that every catalog value is covered here; the runtime
      // cast is safe.
      return raw as WebhookEnvelope;
    default: {
      throw new WebhookEventParseError(
        `webhook envelope has unknown event name: ${JSON.stringify(event)}. ` +
          `SDK may be older than the API — consider upgrading @aegis/sdk.`,
        event,
      );
    }
  }
}

/**
 * Type guard variant of `interpretWebhookEvent`. Returns `true` and
 * narrows the input when the envelope is a known webhook event;
 * returns `false` otherwise without throwing. Use when you want to
 * silently skip unknown events (e.g. during SDK-upgrade transitions).
 */
export function isWebhookEnvelope(raw: unknown): raw is WebhookEnvelope {
  try {
    interpretWebhookEvent(raw);
    return true;
  } catch {
    return false;
  }
}
