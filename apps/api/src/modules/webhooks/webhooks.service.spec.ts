/**
 * WebhooksService — unit tests
 *
 * Coverage:
 *   subscribe()    — creates a subscription, returns one-time plaintext secret
 *   unsubscribe()  — scoped deleteMany; idempotent
 *   list()         — scoped findMany; returns mapped DTOs
 *   enqueue()      — persists deliveries per matching active subscription,
 *                    hands row IDs to WebhookDeliveryWorker; swallows errors
 *
 * Multi-tenant invariant: every Prisma call is scoped to principalId.
 * The enqueue path must never throw — delivery errors are logged & suppressed.
 */

import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryWorker } from './webhook.delivery';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { MetricsService } from '../../common/observability/metrics.service';
import type { WebhookSecretCipher } from '../../common/crypto/webhook-secret-cipher';

// ── Prisma stub ───────────────────────────────────────────────────────────────

interface SubRow {
  id: string;
  principalId: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
}

interface DeliveryRow {
  id: string;
  subscriptionId: string;
  event: string;
  payload: unknown;
}

function makePrisma() {
  const subs: SubRow[] = [];
  const deliveries: DeliveryRow[] = [];
  let subSeq = 0;
  let delSeq = 0;

  const prisma = {
    webhookSubscription: {
      create: jest.fn(async ({ data }: { data: Omit<SubRow, 'id' | 'active'> & { active?: boolean } }) => {
        const row: SubRow = { id: `sub_${++subSeq}`, active: true, ...data };
        subs.push(row);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: { where: { id: string; principalId: string } }) => {
        const idx = subs.findIndex((s) => s.id === where.id && s.principalId === where.principalId);
        if (idx !== -1) subs.splice(idx, 1);
        return { count: idx !== -1 ? 1 : 0 };
      }),
      findMany: jest.fn(async ({ where }: { where: Partial<SubRow> }) => {
        return subs.filter((s) =>
          (!where.principalId || s.principalId === where.principalId) &&
          (!where.active || s.active === where.active) &&
          (!where.events || s.events.some((e) => (where.events as unknown as { has: string }).has === e)),
        );
      }),
    },
    webhookDelivery: {
      create: jest.fn(async ({ data }: { data: { subscriptionId: string; event: string; payload: unknown } }) => {
        const row: DeliveryRow = { id: `del_${++delSeq}`, ...data };
        deliveries.push(row);
        return row;
      }),
    },
    $transaction: jest.fn(async (ops: Promise<DeliveryRow>[]) => Promise.all(ops)),
  };

  return { prisma, subs, deliveries };
}

// ── Other stubs ───────────────────────────────────────────────────────────────

function makeCipher(): jest.Mocked<WebhookSecretCipher> {
  return {
    encrypt: jest.fn((plaintext: string) => `enc:${plaintext}`),
    decrypt: jest.fn((ct: string) => ct.replace('enc:', '')),
  } as unknown as jest.Mocked<WebhookSecretCipher>;
}

function makeDelivery(): jest.Mocked<WebhookDeliveryWorker> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    sign: jest.fn(),
    process: jest.fn(),
  } as unknown as jest.Mocked<WebhookDeliveryWorker>;
}

function makeMetrics(): jest.Mocked<MetricsService> {
  // Mirror the prom-client `Counter` shape that WebhooksService touches.
  // Keeping this scoped to the specific counter under test avoids dragging
  // in the full Prometheus registry just for a unit suite.
  const driftCounter = { inc: jest.fn() };
  return {
    webhookPayloadDriftTotal: driftCounter,
  } as unknown as jest.Mocked<MetricsService>;
}

function makeService() {
  const { prisma, subs, deliveries } = makePrisma();
  const cipher = makeCipher();
  const delivery = makeDelivery();
  const metrics = makeMetrics();
  const svc = new WebhooksService(
    prisma as unknown as PrismaService,
    delivery,
    cipher,
    metrics,
  );
  return { svc, prisma, subs, deliveries, cipher, delivery, metrics };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebhooksService', () => {
  describe('subscribe()', () => {
    it('returns an id and a one-time plaintext whsec_ secret', async () => {
      const { svc } = makeService();
      const result = await svc.subscribe('prn_A', 'https://example.com/wh', ['aegis.agent.revoked']);
      expect(result.id).toMatch(/^sub_/);
      expect(result.secret).toMatch(/^whsec_/);
    });

    it('stores the ENCRYPTED secret (never the plaintext) in the DB', async () => {
      const { svc, prisma, cipher } = makeService();
      const { secret } = await svc.subscribe('prn_A', 'https://example.com/wh', ['*']);
      expect(cipher.encrypt).toHaveBeenCalledWith(secret);
      const createCall = (prisma.webhookSubscription.create as jest.Mock).mock.calls[0][0] as { data: SubRow };
      expect(createCall.data.secret).toBe(`enc:${secret}`);
    });

    it('scopes the subscription to the provided principalId', async () => {
      const { svc, subs } = makeService();
      await svc.subscribe('prn_A', 'https://a.com/wh', ['*']);
      expect(subs[0]!.principalId).toBe('prn_A');
    });

    it('each call generates a unique secret', async () => {
      const { svc } = makeService();
      const r1 = await svc.subscribe('prn_A', 'https://a.com/wh1', ['*']);
      const r2 = await svc.subscribe('prn_A', 'https://a.com/wh2', ['*']);
      expect(r1.secret).not.toBe(r2.secret);
    });
  });

  describe('unsubscribe()', () => {
    it('removes the subscription and returns void', async () => {
      const { svc, subs } = makeService();
      const { id } = await svc.subscribe('prn_A', 'https://a.com/wh', ['*']);
      await svc.unsubscribe('prn_A', id);
      expect(subs).toHaveLength(0);
    });

    it('is idempotent — deleting a non-existent id does not throw', async () => {
      const { svc } = makeService();
      await expect(svc.unsubscribe('prn_A', 'sub_does_not_exist')).resolves.toBeUndefined();
    });

    it('calls deleteMany scoped by principalId (multi-tenant enforcement)', async () => {
      const { svc, prisma } = makeService();
      await svc.unsubscribe('prn_A', 'sub_123');
      expect(prisma.webhookSubscription.deleteMany).toHaveBeenCalledWith({
        where: { id: 'sub_123', principalId: 'prn_A' },
      });
    });

    it('principal A cannot delete principal B subscription', async () => {
      const { svc, subs } = makeService();
      const { id: bId } = await svc.subscribe('prn_B', 'https://b.com/wh', ['*']);
      await svc.unsubscribe('prn_A', bId); // A tries to delete B's sub
      expect(subs).toHaveLength(1);         // B's sub still exists
    });
  });

  describe('list()', () => {
    it('returns only subscriptions for the given principalId', async () => {
      const { svc } = makeService();
      await svc.subscribe('prn_A', 'https://a.com/wh', ['aegis.agent.revoked']);
      await svc.subscribe('prn_B', 'https://b.com/wh', ['aegis.agent.trust_score_changed']);
      const list = await svc.list('prn_A');
      expect(list).toHaveLength(1);
      expect(list[0]!.url).toBe('https://a.com/wh');
    });

    it('returns empty array when principal has no subscriptions', async () => {
      const { svc } = makeService();
      await svc.subscribe('prn_B', 'https://b.com/wh', ['*']);
      const list = await svc.list('prn_A');
      expect(list).toEqual([]);
    });

    it('maps Prisma rows to { id, url, events, active } shape', async () => {
      const { svc } = makeService();
      const { id } = await svc.subscribe('prn_A', 'https://a.com/wh', ['aegis.agent.revoked']);
      const list = await svc.list('prn_A');
      expect(list[0]).toMatchObject({ id, url: 'https://a.com/wh', events: ['aegis.agent.revoked'], active: true });
    });
  });

  describe('enqueue()', () => {
    // Canonical valid payloads for the two events with live producers.
    // Anyone changing these must also update the schema in
    // packages/types/src/webhooks.ts (the parity test enforces it).
    const TRUST_SCORE_EVENT = {
      type: 'aegis.agent.trust_score_changed',
      data: {
        agentId: 'agt_1',
        score: 720,
        previousScore: 480,
        band: 'VERIFIED' as const,
        previousBand: 'WATCH' as const,
        weightsVersion: 'v1',
        contributors: [{ kind: 'recompute', delta: 240, reason: 'positive_signal' }],
      },
    };
    const POLICY_EXPIRED_EVENT = {
      type: 'aegis.policy.expired',
      data: {
        policyId: 'pol_1',
        agentId: 'agt_1',
        expiredAt: '2026-05-01T00:00:00.000Z',
        sweptAt: '2026-05-01T00:05:00.000Z',
      },
    };

    it('creates a WebhookDelivery row for each matching active subscription', async () => {
      const { svc, subs, deliveries, prisma } = makeService();
      // Manually insert active subs with matching event
      subs.push({ id: 'sub_1', principalId: 'prn_A', url: 'https://a.com/wh', events: ['aegis.agent.trust_score_changed'], active: true, secret: 'x' });
      (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([subs[0]]);
      (prisma.webhookDelivery.create as jest.Mock).mockResolvedValueOnce({ id: 'del_1', subscriptionId: 'sub_1', event: TRUST_SCORE_EVENT.type, payload: TRUST_SCORE_EVENT.data });

      await svc.enqueue(TRUST_SCORE_EVENT, 'prn_A');

      expect(deliveries.length + (prisma.webhookDelivery.create as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    });

    it('calls delivery.enqueue for each persisted delivery row', async () => {
      const { svc, subs, delivery, prisma } = makeService();
      subs.push({ id: 'sub_1', principalId: 'prn_A', url: 'https://a.com/wh', events: [POLICY_EXPIRED_EVENT.type], active: true, secret: 'x' });
      (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([subs[0]]);
      (prisma.webhookDelivery.create as jest.Mock).mockResolvedValueOnce({ id: 'del_99', subscriptionId: 'sub_1', event: POLICY_EXPIRED_EVENT.type, payload: POLICY_EXPIRED_EVENT.data });
      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([{ id: 'del_99' }]);

      await svc.enqueue(POLICY_EXPIRED_EVENT, 'prn_A');

      expect(delivery.enqueue).toHaveBeenCalledWith('del_99');
    });

    it('does nothing when no active subscription matches the event', async () => {
      const { svc, prisma, delivery } = makeService();
      (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([]);
      await svc.enqueue(TRUST_SCORE_EVENT, 'prn_A');
      expect(delivery.enqueue).not.toHaveBeenCalled();
    });

    it('swallows errors — never throws on delivery failure', async () => {
      const { svc, prisma } = makeService();
      (prisma.webhookSubscription.findMany as jest.Mock).mockRejectedValueOnce(new Error('DB down'));
      await expect(svc.enqueue(TRUST_SCORE_EVENT, 'prn_A')).resolves.toBeUndefined();
    });

    it('skips delivery and increments drift metric with reason=shape_mismatch (missing field)', async () => {
      // Belt-and-suspenders runtime guard: if the producer somehow ships a
      // body that doesn't match the schema (despite CI parity catching it),
      // we prefer "send nothing" over "send wrong shape". No throw — caller
      // hot path keeps moving. The metric increment is what ops alerts on.
      const { svc, prisma, delivery, metrics } = makeService();
      await expect(
        svc.enqueue(
          { type: 'aegis.agent.trust_score_changed', data: { agentId: 'agt_1' } },
          'prn_A',
        ),
      ).resolves.toBeUndefined();
      expect(prisma.webhookSubscription.findMany).not.toHaveBeenCalled();
      expect(delivery.enqueue).not.toHaveBeenCalled();
      expect(metrics.webhookPayloadDriftTotal.inc).toHaveBeenCalledWith({
        event: 'aegis.agent.trust_score_changed',
        reason: 'shape_mismatch',
      });
    });

    it('skips delivery and increments drift metric with reason=shape_mismatch (extra field — strict mode)', async () => {
      // The schemas are .strict(), so unknown fields are a contract break.
      // Load-bearing: without strict mode, an attacker-controlled extra
      // field could ride the wire silently — the service signs event.data,
      // not the parsed-stripped result.
      const { svc, prisma, delivery, metrics } = makeService();
      await expect(
        svc.enqueue(
          {
            type: 'aegis.policy.expired',
            data: {
              policyId: 'pol_1',
              agentId: 'agt_1',
              expiredAt: '2026-05-01T00:00:00.000Z',
              sweptAt: '2026-05-01T00:05:00.000Z',
              attacker_controlled: 'value',
            },
          },
          'prn_A',
        ),
      ).resolves.toBeUndefined();
      expect(prisma.webhookSubscription.findMany).not.toHaveBeenCalled();
      expect(delivery.enqueue).not.toHaveBeenCalled();
      expect(metrics.webhookPayloadDriftTotal.inc).toHaveBeenCalledWith({
        event: 'aegis.policy.expired',
        reason: 'shape_mismatch',
      });
    });

    it('skips delivery and increments drift metric with reason=reserved for unproduced events', async () => {
      // AGENT_REVOKED / ANOMALY_DETECTED / FLAGGED_BY_RELYING_PARTY are
      // declared in WEBHOOK_EVENT but have no producer yet. Emitting one
      // without first defining its schema must not silently succeed — and
      // the metric tags it `reason=reserved` so ops can tell this apart
      // from a real shape-mismatch incident.
      const { svc, prisma, delivery, metrics } = makeService();
      await expect(
        svc.enqueue(
          { type: 'aegis.agent.revoked', data: { agentId: 'agt_1' } },
          'prn_A',
        ),
      ).resolves.toBeUndefined();
      expect(prisma.webhookSubscription.findMany).not.toHaveBeenCalled();
      expect(delivery.enqueue).not.toHaveBeenCalled();
      expect(metrics.webhookPayloadDriftTotal.inc).toHaveBeenCalledWith({
        event: 'aegis.agent.revoked',
        reason: 'reserved',
      });
    });

    it('skips delivery and increments drift metric with reason=unknown_event for undeclared types', async () => {
      // A producer that emits an event type not declared in WEBHOOK_EVENT
      // is a typo / dev mistake. Distinguished from `reserved` so ops route
      // it to the producer owner, not the schema owner.
      const { svc, prisma, delivery, metrics } = makeService();
      await expect(
        svc.enqueue(
          { type: 'not.a.real.event', data: {} },
          'prn_A',
        ),
      ).resolves.toBeUndefined();
      expect(prisma.webhookSubscription.findMany).not.toHaveBeenCalled();
      expect(delivery.enqueue).not.toHaveBeenCalled();
      expect(metrics.webhookPayloadDriftTotal.inc).toHaveBeenCalledWith({
        event: 'not.a.real.event',
        reason: 'unknown_event',
      });
    });

    it('does not increment drift metric on valid payloads', async () => {
      // Negative-control: an accepted payload should NEVER bump the drift
      // counter. Without this, a producer accidentally importing prom-client
      // and calling .inc() in a passing test would silently inflate the
      // metric in prod.
      const { svc, subs, prisma, metrics } = makeService();
      subs.push({ id: 'sub_1', principalId: 'prn_A', url: 'https://a.com/wh', events: [TRUST_SCORE_EVENT.type], active: true, secret: 'x' });
      (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([subs[0]]);
      (prisma.webhookDelivery.create as jest.Mock).mockResolvedValueOnce({ id: 'del_ok', subscriptionId: 'sub_1', event: TRUST_SCORE_EVENT.type, payload: TRUST_SCORE_EVENT.data });
      await svc.enqueue(TRUST_SCORE_EVENT, 'prn_A');
      expect(metrics.webhookPayloadDriftTotal.inc).not.toHaveBeenCalled();
    });
  });
});
