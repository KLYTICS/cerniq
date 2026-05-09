/**
 * WebhooksController — unit tests
 *
 * Critical invariant (CLAUDE.md §5 + PARALLEL_SESSIONS_v2 Terminal-E):
 *   Multi-tenant isolation: principal A CANNOT read or delete principal B's
 *   subscriptions. Every service call must be scoped by principalId extracted
 *   from the auth context — never from the request body.
 *
 * Coverage:
 *   POST   /v1/webhooks  — subscribe: persists, returns secret once
 *   GET    /v1/webhooks  — list: returns only caller's subs
 *   DELETE /v1/webhooks/:id — unsubscribe: idempotent, scoped by principalId
 *
 *   Multi-tenant isolation:
 *     - list() for principal A returns empty when principal B has subs
 *     - unsubscribe() for principal A on principal B's id is a no-op (204,
 *       not an error — deleteMany with principalId filter silently skips)
 */

import { Test } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

// ── Auth context doubles ─────────────────────────────────────────────────────

const authA = { principalId: 'prn_A', keyId: 'key_A', plan: 'FREE' } as const;
const authB = { principalId: 'prn_B', keyId: 'key_B', plan: 'FREE' } as const;

// ── Service stub ─────────────────────────────────────────────────────────────

type ListResult = Array<{ id: string; url: string; events: string[]; active: boolean }>;

interface SubsStore {
  [principalId: string]: Array<{ id: string; url: string; events: string[]; active: boolean }>;
}

/**
 * In-memory WebhooksService stub that enforces the same principalId scoping
 * as the real Prisma queries:
 *   subscribe  → scoped create
 *   list       → scoped findMany
 *   unsubscribe → scoped deleteMany (silent on missing)
 */
function makeWebhooksServiceStub() {
  const store: SubsStore = {};
  let seq = 0;

  const stub: jest.Mocked<WebhooksService> = {
    subscribe: jest.fn(async (principalId: string, url: string, events: string[]) => {
      if (!store[principalId]) store[principalId] = [];
      const id = `sub_${++seq}`;
      store[principalId].push({ id, url, events, active: true });
      return { id, secret: `whsec_${id}_secret` };
    }) as unknown as jest.MockedFunction<WebhooksService['subscribe']>,

    list: jest.fn(async (principalId: string): Promise<ListResult> => {
      return store[principalId] ?? [];
    }) as unknown as jest.MockedFunction<WebhooksService['list']>,

    unsubscribe: jest.fn(async (principalId: string, id: string): Promise<void> => {
      // Mirror Prisma deleteMany — scoped; silently a no-op if not found/wrong principal
      const subs = store[principalId];
      if (!subs) return;
      const idx = subs.findIndex((s) => s.id === id);
      if (idx !== -1) subs.splice(idx, 1);
    }) as unknown as jest.MockedFunction<WebhooksService['unsubscribe']>,

    enqueue: jest.fn() as unknown as jest.MockedFunction<WebhooksService['enqueue']>,
  } as unknown as jest.Mocked<WebhooksService>;

  return { stub, store };
}

// ── Test helpers ─────────────────────────────────────────────────────────────

async function buildController(stub: jest.Mocked<WebhooksService>) {
  const module = await Test.createTestingModule({
    controllers: [WebhooksController],
    providers: [{ provide: WebhooksService, useValue: stub }],
  }).compile();
  return module.get(WebhooksController);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: jest.Mocked<WebhooksService>;
  let store: SubsStore;

  beforeEach(async () => {
    const built = makeWebhooksServiceStub();
    service = built.stub;
    store = built.store;
    controller = await buildController(service);
  });

  // ── POST /v1/webhooks ────────────────────────────────────────────────────

  describe('POST /v1/webhooks (subscribe)', () => {
    it('creates a subscription and returns id + one-time secret', async () => {
      const result = await controller.subscribe(authA as never, {
        url: 'https://example.com/webhooks',
        events: ['aegis.agent.trust_score_changed'],
      });

      expect(result).toMatchObject({
        id: expect.stringMatching(/^sub_/),
        secret: expect.stringMatching(/^whsec_/),
      });
    });

    it('forwards principalId from auth context, not from body', async () => {
      await controller.subscribe(authA as never, {
        url: 'https://example.com/wh',
        events: ['*'],
      });

      expect(service.subscribe).toHaveBeenCalledWith(
        authA.principalId,
        'https://example.com/wh',
        ['*'],
      );
      // The subscription must be scoped to A, not leaked to B
      expect(store['prn_A']).toHaveLength(1);
      expect(store['prn_B']).toBeUndefined();
    });

    it('returns a unique secret for each subscription (not reused)', async () => {
      const first = await controller.subscribe(authA as never, {
        url: 'https://example.com/wh1',
        events: ['*'],
      });
      const second = await controller.subscribe(authA as never, {
        url: 'https://example.com/wh2',
        events: ['*'],
      });
      expect(first.secret).not.toBe(second.secret);
    });
  });

  // ── GET /v1/webhooks ─────────────────────────────────────────────────────

  describe('GET /v1/webhooks (list)', () => {
    it('returns only subscriptions belonging to the calling principal', async () => {
      // Seed A and B independently
      await controller.subscribe(authA as never, {
        url: 'https://a.example.com/wh',
        events: ['aegis.agent.revoked'],
      });
      await controller.subscribe(authB as never, {
        url: 'https://b.example.com/wh',
        events: ['aegis.agent.anomaly_detected'],
      });

      const aList = await controller.list(authA as never);
      const bList = await controller.list(authB as never);

      // Each principal sees exactly their own subscription(s)
      expect(aList).toHaveLength(1);
      expect(aList[0].url).toBe('https://a.example.com/wh');
      expect(bList).toHaveLength(1);
      expect(bList[0].url).toBe('https://b.example.com/wh');
    });

    it('returns empty array when no subscriptions exist for principal', async () => {
      // Principal B has a subscription, A has none
      await controller.subscribe(authB as never, {
        url: 'https://b.example.com/wh',
        events: ['*'],
      });

      const aList = await controller.list(authA as never);
      expect(aList).toEqual([]);
    });

    it('returns all subscriptions for the principal (multiple)', async () => {
      await controller.subscribe(authA as never, {
        url: 'https://a.example.com/wh1',
        events: ['aegis.agent.trust_score_changed'],
      });
      await controller.subscribe(authA as never, {
        url: 'https://a.example.com/wh2',
        events: ['aegis.agent.revoked'],
      });

      const list = await controller.list(authA as never);
      expect(list).toHaveLength(2);
    });

    it('calls service.list with the auth principalId', async () => {
      await controller.list(authA as never);
      expect(service.list).toHaveBeenCalledWith(authA.principalId);
    });
  });

  // ── DELETE /v1/webhooks/:id ───────────────────────────────────────────────

  describe('DELETE /v1/webhooks/:id (unsubscribe)', () => {
    it('removes the subscription and returns void (204)', async () => {
      const { id } = await controller.subscribe(authA as never, {
        url: 'https://example.com/wh',
        events: ['*'],
      });

      await controller.unsubscribe(authA as never, id);

      expect(store['prn_A'] ?? []).toHaveLength(0);
    });

    it('is idempotent — deleting a non-existent id does not throw', async () => {
      await expect(
        controller.unsubscribe(authA as never, 'sub_does_not_exist'),
      ).resolves.toBeUndefined();
    });

    it('calls service.unsubscribe with principalId from auth context', async () => {
      const { id } = await controller.subscribe(authA as never, {
        url: 'https://example.com/wh',
        events: ['*'],
      });

      await controller.unsubscribe(authA as never, id);

      expect(service.unsubscribe).toHaveBeenCalledWith(authA.principalId, id);
    });
  });

  // ── MULTI-TENANT ISOLATION ───────────────────────────────────────────────
  // This is the critical security invariant: CLAUDE.md §5 — "no cross-
  // principal data leaks". These tests prove that even if an attacker
  // knows subscription IDs belonging to another principal, they cannot
  // access or delete them through this controller.

  describe('Multi-tenant isolation', () => {
    it('principal A cannot delete principal B subscription (scoped by principalId)', async () => {
      // B creates a subscription
      const { id: bSubId } = await controller.subscribe(authB as never, {
        url: 'https://b.example.com/wh',
        events: ['*'],
      });

      // A attempts to delete B's subscription using the known id
      await controller.unsubscribe(authA as never, bSubId);

      // B's subscription must still exist — deleteMany scoped to A found nothing
      expect(store['prn_B']).toHaveLength(1);
      expect(store['prn_B']![0].id).toBe(bSubId);
    });

    it('principal A list does not return principal B subscriptions', async () => {
      // B has 3 subscriptions
      for (let i = 0; i < 3; i++) {
        await controller.subscribe(authB as never, {
          url: `https://b.example.com/wh${i}`,
          events: ['*'],
        });
      }

      // A has none — list should be empty, not B's subs
      const aList = await controller.list(authA as never);
      expect(aList).toHaveLength(0);
    });

    it('service.unsubscribe is always called with calling-principal id, never body-supplied id', async () => {
      const { id: bSubId } = await controller.subscribe(authB as never, {
        url: 'https://b.example.com/wh',
        events: ['*'],
      });

      // A calls delete with B's sub id — the controller MUST pass authA.principalId
      await controller.unsubscribe(authA as never, bSubId);

      expect(service.unsubscribe).toHaveBeenCalledWith(
        authA.principalId, // ← NOT authB.principalId
        bSubId,
      );
    });

    it('service.list is always called with calling-principal id', async () => {
      // Register something under B so a generic list() could leak it
      await controller.subscribe(authB as never, {
        url: 'https://b.example.com/wh',
        events: ['*'],
      });

      await controller.list(authA as never);

      expect(service.list).toHaveBeenCalledWith(authA.principalId);
      expect(service.list).not.toHaveBeenCalledWith(authB.principalId);
    });
  });
});
