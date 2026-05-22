// Tests for the typed webhook event union + interpret helper.

import { WEBHOOK_EVENT } from '@aegis/types';

import {
  WebhookEventParseError,
  interpretWebhookEvent,
  isWebhookEnvelope,
  type WebhookEnvelope,
} from './webhook-events';

describe('interpretWebhookEvent — happy paths', () => {
  it('narrows aegis.agent.trust_score_changed to its payload type', () => {
    const raw = {
      event: WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED,
      data: {
        agentId: 'agt_1',
        score: 720,
        previousScore: 500,
        band: 'VERIFIED' as const,
        previousBand: 'WATCH' as const,
        weightsVersion: 'v1.0',
        contributors: { signature_proven_possession: 200, recent_anomaly: 20 },
      },
      deliveryId: 'del_abc',
      occurredAt: '2026-05-22T10:00:00Z',
    };
    const env = interpretWebhookEvent(raw);
    // Type narrowing via switch — tsc proves data.contributors is
    // typed; runtime asserts the value flows through unchanged.
    expect(env.event).toBe('aegis.agent.trust_score_changed');
    if (env.event === WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED) {
      expect(env.data.score).toBe(720);
      expect(env.data.band).toBe('VERIFIED');
      expect(env.data.previousBand).toBe('WATCH');
      expect(env.data.contributors).toEqual({
        signature_proven_possession: 200,
        recent_anomaly: 20,
      });
    } else {
      throw new Error('narrowing failed');
    }
  });

  it('narrows aegis.agent.policy_expired to its payload type', () => {
    const raw = {
      event: WEBHOOK_EVENT.AGENT_POLICY_EXPIRED,
      data: {
        policyId: 'pol_1',
        agentId: 'agt_1',
        expiredAt: '2026-05-22T09:00:00Z',
        sweptAt: '2026-05-22T09:00:05Z',
      },
    };
    const env = interpretWebhookEvent(raw);
    if (env.event === WEBHOOK_EVENT.AGENT_POLICY_EXPIRED) {
      expect(env.data.policyId).toBe('pol_1');
      expect(env.data.expiredAt).toBe('2026-05-22T09:00:00Z');
      expect(env.data.sweptAt).toBe('2026-05-22T09:00:05Z');
    } else {
      throw new Error('narrowing failed');
    }
  });

  it('accepts unknown-emitter events with opaque data', () => {
    const raw = {
      event: WEBHOOK_EVENT.AGENT_REVOKED,
      data: { agentId: 'agt_1', reason: 'manual', anything: { goes: 'here' } },
    };
    const env = interpretWebhookEvent(raw);
    if (env.event === WEBHOOK_EVENT.AGENT_REVOKED) {
      // Payload is Record<string, unknown> by design — caller narrows.
      expect((env.data as { agentId?: string }).agentId).toBe('agt_1');
    } else {
      throw new Error('narrowing failed');
    }
  });
});

describe('interpretWebhookEvent — failure modes', () => {
  it('throws on non-object input', () => {
    expect(() => interpretWebhookEvent('string')).toThrow(WebhookEventParseError);
    expect(() => interpretWebhookEvent(42)).toThrow(WebhookEventParseError);
    expect(() => interpretWebhookEvent(null)).toThrow(WebhookEventParseError);
    expect(() => interpretWebhookEvent(undefined)).toThrow(WebhookEventParseError);
  });

  it('throws on missing event field', () => {
    expect(() => interpretWebhookEvent({ data: {} })).toThrow(WebhookEventParseError);
  });

  it('throws on non-string event field', () => {
    expect(() => interpretWebhookEvent({ event: 42, data: {} })).toThrow(
      WebhookEventParseError,
    );
  });

  it('throws on unknown event name with a clear message', () => {
    const err = (() => {
      try {
        interpretWebhookEvent({ event: 'aegis.future.event', data: {} });
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(WebhookEventParseError);
    expect((err as WebhookEventParseError).message).toMatch(
      /unknown event name.*aegis\.future\.event/,
    );
    expect((err as WebhookEventParseError).message).toMatch(/upgrading @aegis\/sdk/);
    expect((err as WebhookEventParseError).rawEventName).toBe('aegis.future.event');
  });

  it('catches the drift bug: rejects the legacy okoro.policy.expired prefix', () => {
    // This is the regression net: if anyone re-introduces the
    // pre-catalog event name, this test fails immediately.
    expect(() =>
      interpretWebhookEvent({ event: 'okoro.policy.expired', data: {} }),
    ).toThrow(WebhookEventParseError);
  });
});

describe('isWebhookEnvelope — type guard variant', () => {
  it('returns true for known events', () => {
    expect(
      isWebhookEnvelope({
        event: WEBHOOK_EVENT.AGENT_TRUST_SCORE_CHANGED,
        data: {},
      }),
    ).toBe(true);
  });

  it('returns false for unknown events without throwing', () => {
    expect(isWebhookEnvelope({ event: 'something.else' })).toBe(false);
    expect(isWebhookEnvelope({})).toBe(false);
    expect(isWebhookEnvelope(null)).toBe(false);
    expect(isWebhookEnvelope('not-an-object')).toBe(false);
  });

  it('narrows the type when true is returned', () => {
    const raw: unknown = {
      event: WEBHOOK_EVENT.AGENT_POLICY_EXPIRED,
      data: { policyId: 'p_1', agentId: 'a_1', expiredAt: '', sweptAt: '' },
    };
    if (isWebhookEnvelope(raw)) {
      // tsc proves this access is safe — the guard narrowed `raw`
      // to WebhookEnvelope.
      const env: WebhookEnvelope = raw;
      expect(env.event).toBe('aegis.agent.policy_expired');
    } else {
      throw new Error('narrowing failed');
    }
  });
});

describe('union coverage — every catalog entry has a variant', () => {
  // Runtime mirror of the static `_ExhaustivenessGate`. If a new
  // event is added to WEBHOOK_EVENT but not handled in the
  // interpret() switch, this test fails with a clear list of the
  // missing entries.
  it('every WEBHOOK_EVENT value is interpretable', () => {
    const allEvents = Object.values(WEBHOOK_EVENT);
    expect(allEvents.length).toBeGreaterThan(0);
    for (const eventName of allEvents) {
      expect(() => interpretWebhookEvent({ event: eventName, data: {} })).not.toThrow();
    }
  });
});
