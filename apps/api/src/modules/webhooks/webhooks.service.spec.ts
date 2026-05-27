/**
 * WebhooksService — unit tests
 *
 * Coverage:
 *   subscribe()    — creates a subscription, returns one-time plaintext secret
 *   unsubscribe()  — scoped deleteMany; idempotent
 *   list()         — scoped findMany; returns mapped DTOs
 *   enqueue()      — persists deliveries per matching active subscription,
 *                    hands row IDs to WebhookDeliveryWorker. Throws on
 *                    *persistence* failures (subscription lookup, delivery
 *                    row write) so the caller can roll back / re-raise.
 *                    Tolerates per-delivery BullMQ queue.add failures
 *                    (the row is durable; reconcile sweep retries).
 *
 * Multi-tenant invariant: every Prisma call is scoped to principalId.
 *
 * Error-handling history: the original implementation silently swallowed
 * ALL failures (including DB-down). That violated apps/api/CLAUDE.md
 * ("Do not swallow errors in webhooks paths") and CLAUDE.md invariant
 * #4 ("No silent failures"). swarm-2 silent-failure-hunter caught it
 * 2026-05-27; this spec was updated alongside the fix.
 */

import type { WebhookSecretCipher } from '../../common/crypto/webhook-secret-cipher';
import type { PrismaService } from '../../common/prisma/prisma.service';

import type { WebhookDeliveryWorker } from './webhook.delivery';
import { WebhooksService } from './webhooks.service';

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
      create: jest.fn(
        async ({ data }: { data: Omit<SubRow, 'id' | 'active'> & { active?: boolean } }) => {
          const row: SubRow = { id: `sub_${++subSeq}`, active: true, ...data };
          subs.push(row);
          return row;
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: { id: string; principalId: string } }) => {
        const idx = subs.findIndex((s) => s.id === where.id && s.principalId === where.principalId);
        if (idx !== -1) subs.splice(idx, 1);
        return { count: idx !== -1 ? 1 : 0 };
      }),
      findMany: jest.fn(async ({ where }: { where: Partial<SubRow> }) => {
        return subs.filter(
          (s) =>
            (!where.principalId || s.principalId === where.principalId) &&
            (!where.active || s.active === where.active) &&
            (!where.events ||
              s.events.some((e) => (where.events as unknown as { has: string }).has === e)),
        );
      }),
    },
    webhookDelivery: {
      create: jest.fn(
        async ({ data }: { data: { subscriptionId: string; event: string; payload: unknown } }) => {
          const row: DeliveryRow = { id: `del_${++delSeq}`, ...data };
          deliveries.push(row);
          return row;
        },
      ),
    },
    $transaction: jest.fn(async (ops: Promise<DeliveryRow>[]) => await Promise.all(ops)),
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

function makeService() {
  const { prisma, subs, deliveries } = makePrisma();
  const cipher = makeCipher();
  const delivery = makeDelivery();
  const svc = new WebhooksService(prisma as unknown as PrismaService, delivery, cipher);
  return { svc, prisma, subs, deliveries, cipher, delivery };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebhooksService', () => {
  describe('subscribe()', () => {
    it('returns an id and a one-time plaintext whsec_ secret', async () => {
      const { svc } = makeService();
      const result = await svc.subscribe('prn_A', 'https://example.com/wh', [
        'cerniq.agent.revoked',
      ]);
      expect(result.id).toMatch(/^sub_/);
      expect(result.secret).toMatch(/^whsec_/);
    });

    it('stores the ENCRYPTED secret (never the plaintext) in the DB', async () => {
      const { svc, prisma, cipher } = makeService();
      const { secret } = await svc.subscribe('prn_A', 'https://example.com/wh', ['*']);
      expect(cipher.encrypt).toHaveBeenCalledWith(secret);
      const createCall = (prisma.webhookSubscription.create as jest.Mock).mock.calls[0][0] as {
        data: SubRow;
      };
      expect(createCall.data.secret).toBe(`enc:${secret}`);
    });

    it('scopes the subscription to the provided principalId', async () => {
      const { svc, subs } = makeService();
      await svc.subscribe('prn_A', 'https://a.com/wh', ['*']);
      expect(subs[0].principalId).toBe('prn_A');
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
      expect(subs).toHaveLength(1); // B's sub still exists
    });
  });

  describe('list()', () => {
    it('returns only subscriptions for the given principalId', async () => {
      const { svc } = makeService();
      await svc.subscribe('prn_A', 'https://a.com/wh', ['cerniq.agent.revoked']);
      await svc.subscribe('prn_B', 'https://b.com/wh', ['cerniq.agent.trust_score_changed']);
      const list = await svc.list('prn_A');
      expect(list).toHaveLength(1);
      expect(list[0].url).toBe('https://a.com/wh');
    });

    it('returns empty array when principal has no subscriptions', async () => {
      const { svc } = makeService();
      await svc.subscribe('prn_B', 'https://b.com/wh', ['*']);
      const list = await svc.list('prn_A');
      expect(list).toEqual([]);
    });

    it('maps Prisma rows to { id, url, events, active } shape', async () => {
      const { svc } = makeService();
      const { id } = await svc.subscribe('prn_A', 'https://a.com/wh', ['cerniq.agent.revoked']);
      const list = await svc.list('prn_A');
      expect(list[0]).toMatchObject({
        id,
        url: 'https://a.com/wh',
        events: ['cerniq.agent.revoked'],
        active: true,
      });
    });
  });

  describe('enqueue()', () => {
    it('creates a WebhookDelivery row for each matching active subscription', async () => {
      const { svc, subs, deliveries, prisma } = makeService();
      // Manually insert active subs with matching event
      subs.push({
        id: 'sub_1',
        principalId: 'prn_A',
        url: 'https://a.com/wh',
        events: ['cerniq.agent.revoked'],
        active: true,
        secret: 'x',
      });
      (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([subs[0]]);
      (prisma.webhookDelivery.create as jest.Mock).mockResolvedValueOnce({
        id: 'del_1',
        subscriptionId: 'sub_1',
        event: 'cerniq.agent.revoked',
        payload: {},
      });

      await svc.enqueue({ type: 'cerniq.agent.revoked', data: { agentId: 'agt_1' } }, 'prn_A');

      expect(
        deliveries.length + (prisma.webhookDelivery.create as jest.Mock).mock.calls.length,
      ).toBeGreaterThan(0);
    });

    it('calls delivery.enqueue for each persisted delivery row', async () => {
      const { svc, subs, delivery, prisma } = makeService();
      subs.push({
        id: 'sub_1',
        principalId: 'prn_A',
        url: 'https://a.com/wh',
        events: ['evt'],
        active: true,
        secret: 'x',
      });
      (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([subs[0]]);
      (prisma.webhookDelivery.create as jest.Mock).mockResolvedValueOnce({
        id: 'del_99',
        subscriptionId: 'sub_1',
        event: 'evt',
        payload: {},
      });
      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([{ id: 'del_99' }]);

      await svc.enqueue({ type: 'evt', data: {} }, 'prn_A');

      expect(delivery.enqueue).toHaveBeenCalledWith('del_99');
    });

    it('does nothing when no active subscription matches the event', async () => {
      const { svc, prisma, delivery } = makeService();
      (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([]);
      await svc.enqueue({ type: 'cerniq.agent.revoked', data: {} }, 'prn_A');
      expect(delivery.enqueue).not.toHaveBeenCalled();
    });

    it('THROWS on subscription lookup failure — caller must learn subscribers will never be notified', async () => {
      // Updated 2026-05-27 (swarm-2 silent-failure-hunter finding):
      // The previous behavior ("swallows errors — never throws") violated
      // apps/api/CLAUDE.md ("Do not swallow errors in webhooks paths") and
      // CLAUDE.md invariant #4. A revoke handler that called enqueue and
      // got `void` back believed subscribers had been notified; in fact
      // a DB-down condition meant zero rows were ever persisted and no
      // BullMQ retry would ever fire. Now: persistence failures throw so
      // the caller (typically inside a Prisma transaction) can roll back
      // or surface the failure visibly.
      const { svc, prisma } = makeService();
      (prisma.webhookSubscription.findMany as jest.Mock).mockRejectedValueOnce(
        new Error('DB down'),
      );
      await expect(svc.enqueue({ type: 'evt', data: {} }, 'prn_A')).rejects.toThrow('DB down');
    });

    it('THROWS on delivery-row persistence failure — durable record never written', async () => {
      const { svc, prisma } = makeService();
      (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'sub_1', principalId: 'prn_A', active: true, events: ['evt'] },
      ]);
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('tx aborted'));
      await expect(svc.enqueue({ type: 'evt', data: {} }, 'prn_A')).rejects.toThrow('tx aborted');
    });

    it('does NOT throw on per-delivery BullMQ enqueue failure — row is durable, reconcile sweep retries', async () => {
      // The webhookDelivery row is the durable record; per-delivery
      // queue.add is best-effort. Failure here just delays first-attempt
      // timing — the reconcile worker picks the row up on next sweep.
      // Throwing would misleadingly fail the caller AFTER the durable
      // write succeeded.
      const { svc, prisma, delivery } = makeService();
      (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'sub_1', principalId: 'prn_A', active: true, events: ['evt'] },
      ]);
      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([{ id: 'wd_1' }]);
      (delivery.enqueue as jest.Mock).mockRejectedValueOnce(new Error('Redis blip'));
      await expect(svc.enqueue({ type: 'evt', data: {} }, 'prn_A')).resolves.toBeUndefined();
    });
  });
});
