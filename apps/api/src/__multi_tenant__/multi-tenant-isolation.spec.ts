import { NotFoundException } from '@nestjs/common';

import type { AuditChainUtil } from '../common/crypto/audit-chain.util';
import type { Ed25519Util } from '../common/crypto/ed25519.util';
import type { JwtUtil } from '../common/crypto/jwt.util';
import type { WebhookSecretCipher } from '../common/crypto/webhook-secret-cipher';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { RedisService } from '../common/redis/redis.service';
import type { AppConfigService } from '../config/config.service';
import { AuditService } from '../modules/audit/audit.service';
import { IdentityService } from '../modules/identity/identity.service';
import { PolicyService } from '../modules/policy/policy.service';
import type { WebhookDeliveryWorker } from '../modules/webhooks/webhook.delivery';
import { WebhooksService } from '../modules/webhooks/webhooks.service';

/**
 * CLAUDE.md invariant #5 — multi-tenant isolation by `principalId` on every
 * query. Service-layer Prisma `where` clauses MUST scope by principalId so
 * one tenant cannot read, mutate, or revoke another tenant's records.
 *
 * Strategy: mock Prisma; assert each service call (a) emits Prisma queries
 * that include the caller's principalId in `where`, AND (b) cannot reach a
 * row that lives under a different principalId (returns null/throws).
 */

const PRINCIPAL_A = 'p_alice';
const PRINCIPAL_B = 'p_bob';

interface AgentRow {
  id: string;
  principalId: string;
  status: 'ACTIVE' | 'REVOKED';
  publicKey: string;
  runtime: string;
  model: string | null;
  label: string | null;
  trustScore: number;
  trustBand: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}
interface AuditRow {
  id: string;
  agentId: string;
  principalId: string;
  timestamp: Date;
}
interface PolicyRow {
  id: string;
  agentId: string;
}
interface SubRow {
  id: string;
  principalId: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
}

function rowMatches(row: object, where: Record<string, unknown>): boolean {
  const r = row as Record<string, unknown>;
  for (const [k, v] of Object.entries(where)) {
    if (r[k] !== v) return false;
  }
  return true;
}

function buildPrismaMock() {
  const agents = new Map<string, AgentRow>();
  const audits: AuditRow[] = [];
  const policies: PolicyRow[] = [];
  const subs = new Map<string, SubRow>();

  const prisma = {
    agentIdentity: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return Array.from(agents.values()).find((a) => rowMatches(a, where)) ?? null;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<AgentRow> }) => {
          const a = agents.get(where.id);
          if (!a) throw new Error('not found');
          Object.assign(a, data);
          return a;
        },
      ),
    },
    agentPolicy: {
      findMany: jest.fn(async ({ where }: { where: { agentId: string } }) => {
        return policies.filter((p) => p.agentId === where.agentId);
      }),
    },
    auditEvent: {
      findMany: jest.fn(async ({ where, take }: { where: { agentId: string }; take?: number }) => {
        const matched = audits
          .filter((e) => e.agentId === where.agentId)
          .map((e) => ({
            ...e,
            claimedAgentId: null,
            action: 'verify',
            decision: 'APPROVED',
            denialReason: null,
            relyingParty: null,
            requestedAmount: null,
            currency: null,
            policyId: null,
            policySnapshot: null,
            trustScoreAtEvent: 500,
            trustBandAtEvent: 'VERIFIED',
            cerniqSignature: 'sig',
          }));
        return take ? matched.slice(0, take) : matched;
      }),
    },
    webhookSubscription: {
      create: jest.fn(async ({ data }: { data: Omit<SubRow, 'id' | 'active'> }) => {
        const id = `sub_${subs.size + 1}`;
        const row: SubRow = { id, active: true, ...data };
        subs.set(id, row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return Array.from(subs.values()).filter((s) => rowMatches(s, where));
      }),
      deleteMany: jest.fn(async ({ where }: { where: { id: string; principalId: string } }) => {
        let deleted = 0;
        for (const [k, v] of subs) {
          if (v.id === where.id && v.principalId === where.principalId) {
            subs.delete(k);
            deleted += 1;
          }
        }
        return { count: deleted };
      }),
    },
  } as unknown as PrismaService;

  return { prisma, agents, audits, policies, subs };
}

const noopRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
} as unknown as RedisService;

// OD-024 Phase A4: IdentityService and PolicyService now depend on
// AuditService. For the multi-tenant isolation suite (which asserts
// that cross-principal attacks are rejected BEFORE any state-change
// happens), a no-op append stub is sufficient — the suite never expects
// audit.append to be called on the attack path.
const noopAudit = {
  append: jest.fn().mockResolvedValue('evt_noop'),
} as unknown as AuditService;

// OD-024 Phase A5: same shape for WebhooksService.enqueue — no-op stub
// since the attack path never reaches the fanout.
const noopWebhooks = {
  enqueue: jest.fn().mockResolvedValue(undefined),
} as unknown as import('../modules/webhooks/webhooks.service').WebhooksService;

function makeAgent(id: string, principalId: string): AgentRow {
  return {
    id,
    principalId,
    status: 'ACTIVE',
    publicKey: 'pk',
    runtime: 'CUSTOM',
    model: null,
    label: null,
    trustScore: 500,
    trustBand: 'VERIFIED',
    createdAt: new Date(),
    lastSeenAt: null,
    revokedAt: null,
    revokedReason: null,
  };
}

describe('Multi-tenant isolation (CLAUDE.md invariant #5)', () => {
  describe('IdentityService', () => {
    it('denies cross-principal findOne — Prisma where carries the caller principalId', async () => {
      const harness = buildPrismaMock();
      harness.agents.set('agt_b', makeAgent('agt_b', PRINCIPAL_B));
      const svc = new IdentityService(harness.prisma, noopRedis, noopAudit, noopWebhooks);

      await expect(svc.findOne(PRINCIPAL_A, 'agt_b')).rejects.toBeInstanceOf(NotFoundException);

      expect(harness.prisma.agentIdentity.findFirst as unknown as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'agt_b', principalId: PRINCIPAL_A } }),
      );
    });

    it('denies cross-principal revoke — agent owned by B is NOT updated when A attacks', async () => {
      const harness = buildPrismaMock();
      harness.agents.set('agt_b', makeAgent('agt_b', PRINCIPAL_B));
      const svc = new IdentityService(harness.prisma, noopRedis, noopAudit, noopWebhooks);

      await expect(svc.revoke(PRINCIPAL_A, 'agt_b', 'malicious')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(harness.prisma.agentIdentity.update as unknown as jest.Mock).not.toHaveBeenCalled();
      expect(harness.agents.get('agt_b')!.status).toBe('ACTIVE');
      expect(harness.agents.get('agt_b')!.revokedAt).toBeNull();
    });

    it('owner can revoke own agent — happy-path control', async () => {
      const harness = buildPrismaMock();
      harness.agents.set('agt_a', makeAgent('agt_a', PRINCIPAL_A));
      const svc = new IdentityService(harness.prisma, noopRedis, noopAudit, noopWebhooks);

      await svc.revoke(PRINCIPAL_A, 'agt_a', 'rotation');
      expect(harness.agents.get('agt_a')!.status).toBe('REVOKED');
    });
  });

  describe('PolicyService', () => {
    function makePolicySvc(prisma: PrismaService) {
      const jwt = { sign: jest.fn().mockResolvedValue('signed.jwt.token') } as unknown as JwtUtil;
      return new PolicyService(prisma, noopRedis, jwt, noopAudit, noopWebhooks);
    }

    it('denies cross-principal list — returns NotFound when agent belongs to another principal', async () => {
      const harness = buildPrismaMock();
      harness.agents.set('agt_b', makeAgent('agt_b', PRINCIPAL_B));
      const svc = makePolicySvc(harness.prisma);

      await expect(svc.list(PRINCIPAL_A, 'agt_b')).rejects.toBeInstanceOf(NotFoundException);

      expect(harness.prisma.agentIdentity.findFirst as unknown as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'agt_b', principalId: PRINCIPAL_A } }),
      );
      // Must short-circuit — no policy lookup with stranger's data.
      expect(harness.prisma.agentPolicy.findMany as unknown as jest.Mock).not.toHaveBeenCalled();
    });

    it('denies cross-principal revoke — no policy mutation against another tenant', async () => {
      const harness = buildPrismaMock();
      harness.agents.set('agt_b', makeAgent('agt_b', PRINCIPAL_B));
      const svc = makePolicySvc(harness.prisma);

      await expect(svc.revoke(PRINCIPAL_A, 'agt_b', 'pol_x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('AuditService', () => {
    function makeAuditSvc(prisma: PrismaService) {
      const config = { nodeEnv: 'test' } as unknown as AppConfigService;
      const chain = { sign: jest.fn() } as unknown as AuditChainUtil;
      const ed = { generateKeypair: jest.fn() } as unknown as Ed25519Util;
      return new AuditService(prisma, config, chain, ed);
    }

    it('denies cross-principal audit list — ownership check uses caller principalId', async () => {
      const harness = buildPrismaMock();
      harness.agents.set('agt_b', makeAgent('agt_b', PRINCIPAL_B));
      harness.audits.push({
        id: 'evt_1',
        agentId: 'agt_b',
        principalId: PRINCIPAL_B,
        timestamp: new Date(),
      });
      const svc = makeAuditSvc(harness.prisma);

      await expect(svc.list(PRINCIPAL_A, 'agt_b', {})).rejects.toBeInstanceOf(NotFoundException);

      expect(harness.prisma.agentIdentity.findFirst as unknown as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'agt_b', principalId: PRINCIPAL_A } }),
      );
      // Must NOT reach the auditEvent table when ownership fails.
      expect(harness.prisma.auditEvent.findMany as unknown as jest.Mock).not.toHaveBeenCalled();
    });

    it("owner sees only their own agent's events", async () => {
      const harness = buildPrismaMock();
      harness.agents.set('agt_a', makeAgent('agt_a', PRINCIPAL_A));
      harness.audits.push({
        id: 'evt_1',
        agentId: 'agt_a',
        principalId: PRINCIPAL_A,
        timestamp: new Date(),
      });
      // Foreign-tenant noise:
      harness.audits.push({
        id: 'evt_2',
        agentId: 'agt_b',
        principalId: PRINCIPAL_B,
        timestamp: new Date(),
      });

      const svc = makeAuditSvc(harness.prisma);
      const out = await svc.list(PRINCIPAL_A, 'agt_a', {});

      expect(out.events).toHaveLength(1);
      expect(out.events[0].eventId).toBe('evt_1');
      // Sanity — Prisma was queried with the agent FK, never bare-empty.
      expect(harness.prisma.auditEvent.findMany as unknown as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ agentId: 'agt_a' }) }),
      );
    });
  });

  describe('WebhooksService', () => {
    function makeWebhooksSvc(prisma: PrismaService) {
      const delivery = {
        enqueue: jest.fn().mockResolvedValue(undefined),
      } as unknown as WebhookDeliveryWorker;
      // Identity-encrypt cipher: tenant isolation tests don't care about
      // ciphertext shape, only that the principalId scoping is honored.
      const cipher = {
        encrypt: (s: string) => s,
        decrypt: (s: string) => s,
        isEncrypted: () => false,
      } as unknown as WebhookSecretCipher;
      return new WebhooksService(prisma, delivery, cipher);
    }

    it('subscribe persists with caller principalId', async () => {
      const harness = buildPrismaMock();
      const svc = makeWebhooksSvc(harness.prisma);

      const { id } = await svc.subscribe(PRINCIPAL_A, 'https://example.com/hook', [
        'policy.created',
      ]);

      expect(
        harness.prisma.webhookSubscription.create as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ principalId: PRINCIPAL_A }),
        }),
      );
      expect(harness.subs.get(id)!.principalId).toBe(PRINCIPAL_A);
    });

    it('list scopes by caller principalId — never leaks foreign subscriptions', async () => {
      const harness = buildPrismaMock();
      const svc = makeWebhooksSvc(harness.prisma);

      await svc.subscribe(PRINCIPAL_A, 'https://a.example.com', ['policy.created']);
      await svc.subscribe(PRINCIPAL_B, 'https://b.example.com', ['policy.created']);

      const aList = await svc.list(PRINCIPAL_A);
      expect(aList).toHaveLength(1);
      expect(aList[0].url).toBe('https://a.example.com');

      expect(
        harness.prisma.webhookSubscription.findMany as unknown as jest.Mock,
      ).toHaveBeenCalledWith(expect.objectContaining({ where: { principalId: PRINCIPAL_A } }));
    });

    it("unsubscribe is principalId-scoped — A cannot delete B's subscription", async () => {
      const harness = buildPrismaMock();
      const svc = makeWebhooksSvc(harness.prisma);

      const bSub = await svc.subscribe(PRINCIPAL_B, 'https://b.example.com', ['policy.created']);

      await svc.unsubscribe(PRINCIPAL_A, bSub.id);

      // The deleteMany call MUST include both id AND principalId — the
      // primary defence against cross-tenant deletion.
      expect(
        harness.prisma.webhookSubscription.deleteMany as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: bSub.id, principalId: PRINCIPAL_A } }),
      );
      // And the row still exists.
      expect(harness.subs.get(bSub.id)).toBeDefined();
      expect(harness.subs.get(bSub.id)!.principalId).toBe(PRINCIPAL_B);
    });
  });

  describe('Webhook subscriptions — cross-tenant isolation', () => {
    interface DeliveryRow {
      id: string;
      subscriptionId: string;
      event: string;
      payload: Record<string, unknown>;
    }

    interface WebhooksHarness {
      prisma: PrismaService;
      subs: Map<string, SubRow>;
      deliveries: DeliveryRow[];
      deliveryCreate: jest.Mock;
      subFindMany: jest.Mock;
      subDeleteMany: jest.Mock;
    }

    function buildWebhooksHarness(): WebhooksHarness {
      const subs = new Map<string, SubRow>();
      const deliveries: DeliveryRow[] = [];

      const subCreate = jest.fn(async ({ data }: { data: Omit<SubRow, 'id' | 'active'> }) => {
        const id = `sub_${subs.size + 1}`;
        const row: SubRow = { id, active: true, ...data };
        subs.set(id, row);
        return row;
      });

      // Handles both list's simple `{ principalId }` and enqueue's
      // `{ principalId, active, events: { has: X } }` shape.
      const subFindMany = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return Array.from(subs.values()).filter((s) => {
          for (const [k, v] of Object.entries(where)) {
            if (k === 'events') {
              const filter = v as { has?: string };
              if (filter.has !== undefined && !s.events.includes(filter.has)) return false;
              continue;
            }
            if ((s as unknown as Record<string, unknown>)[k] !== v) return false;
          }
          return true;
        });
      });

      const subDeleteMany = jest.fn(
        async ({ where }: { where: { id: string; principalId: string } }) => {
          let count = 0;
          for (const [k, v] of subs) {
            if (v.id === where.id && v.principalId === where.principalId) {
              subs.delete(k);
              count += 1;
            }
          }
          return { count };
        },
      );

      const deliveryCreate = jest.fn(async ({ data }: { data: Omit<DeliveryRow, 'id'> }) => {
        const row: DeliveryRow = { id: `del_${deliveries.length + 1}`, ...data };
        deliveries.push(row);
        return row;
      });

      // type-rationale: $transaction here just sequentially awaits the
      // promise array the service passes in; matches Prisma's array-form
      // contract well enough for these isolation assertions.
      const $transaction = jest.fn(async (ops: Promise<unknown>[]) => {
        return await Promise.all(ops);
      });

      const prisma = {
        webhookSubscription: {
          create: subCreate,
          findMany: subFindMany,
          deleteMany: subDeleteMany,
        },
        webhookDelivery: { create: deliveryCreate },
        $transaction,
      } as unknown as PrismaService;

      return { prisma, subs, deliveries, deliveryCreate, subFindMany, subDeleteMany };
    }

    function makeWebhooksSvc(prisma: PrismaService): WebhooksService {
      const delivery = {
        enqueue: jest.fn().mockResolvedValue(undefined),
      } as unknown as WebhookDeliveryWorker;
      const cipher = {
        encrypt: (s: string) => s,
        decrypt: (s: string) => s,
        isEncrypted: () => false,
      } as unknown as WebhookSecretCipher;
      return new WebhooksService(prisma, delivery, cipher);
    }

    it("subscribe is principal-scoped — list returns only the caller's subscription", async () => {
      const harness = buildWebhooksHarness();
      const svc = makeWebhooksSvc(harness.prisma);

      await svc.subscribe(PRINCIPAL_A, 'https://hookA.example.com', ['verify.completed']);
      await svc.subscribe(PRINCIPAL_B, 'https://hookB.example.com', ['verify.completed']);

      const aList = await svc.list(PRINCIPAL_A);
      const bList = await svc.list(PRINCIPAL_B);

      expect(aList).toHaveLength(1);
      expect(aList[0].url).toBe('https://hookA.example.com');
      expect(bList).toHaveLength(1);
      expect(bList[0].url).toBe('https://hookB.example.com');

      // Cross-pollution check.
      expect(aList.some((s) => s.url === 'https://hookB.example.com')).toBe(false);
      expect(bList.some((s) => s.url === 'https://hookA.example.com')).toBe(false);
    });

    it("unsubscribe respects principal scope — B cannot delete A's subscription", async () => {
      const harness = buildWebhooksHarness();
      const svc = makeWebhooksSvc(harness.prisma);

      const subA = await svc.subscribe(PRINCIPAL_A, 'https://hookA.example.com', [
        'verify.completed',
      ]);

      // B attacks A's id — must be a no-op deleteMany.
      await svc.unsubscribe(PRINCIPAL_B, subA.id);
      expect(harness.subs.get(subA.id)).toBeDefined();
      expect(harness.subs.get(subA.id)!.principalId).toBe(PRINCIPAL_A);

      const aListAfterAttack = await svc.list(PRINCIPAL_A);
      expect(aListAfterAttack).toHaveLength(1);
      expect(aListAfterAttack[0].id).toBe(subA.id);

      // A cleans up their own — succeeds.
      await svc.unsubscribe(PRINCIPAL_A, subA.id);
      expect(harness.subs.get(subA.id)).toBeUndefined();
      expect(await svc.list(PRINCIPAL_A)).toHaveLength(0);
    });

    it('list is principal-scoped under bulk data — A=3, B=5, no leakage', async () => {
      const harness = buildWebhooksHarness();
      const svc = makeWebhooksSvc(harness.prisma);

      for (let i = 0; i < 3; i += 1) {
        await svc.subscribe(PRINCIPAL_A, `https://a-${i}.example.com`, ['verify.completed']);
      }
      for (let i = 0; i < 5; i += 1) {
        await svc.subscribe(PRINCIPAL_B, `https://b-${i}.example.com`, ['verify.completed']);
      }

      const aList = await svc.list(PRINCIPAL_A);
      const bList = await svc.list(PRINCIPAL_B);

      expect(aList).toHaveLength(3);
      expect(bList).toHaveLength(5);
      expect(aList.every((s) => s.url.startsWith('https://a-'))).toBe(true);
      expect(bList.every((s) => s.url.startsWith('https://b-'))).toBe(true);
      expect(aList.some((s) => s.url.startsWith('https://b-'))).toBe(false);
      expect(bList.some((s) => s.url.startsWith('https://a-'))).toBe(false);
    });

    it("enqueue routes only to the subscribing principal — B's sub is never enqueued for A's event", async () => {
      const harness = buildWebhooksHarness();
      const svc = makeWebhooksSvc(harness.prisma);

      const subA = await svc.subscribe(PRINCIPAL_A, 'https://hookA.example.com', [
        'verify.completed',
      ]);
      const subB = await svc.subscribe(PRINCIPAL_B, 'https://hookB.example.com', [
        'verify.completed',
      ]);

      await svc.enqueue({ type: 'verify.completed', data: { agentId: 'agt_a' } }, PRINCIPAL_A);

      // Exactly one delivery row, scoped to A's subscription.
      expect(harness.deliveryCreate).toHaveBeenCalledTimes(1);
      expect(harness.deliveryCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subscriptionId: subA.id, event: 'verify.completed' }),
        }),
      );
      expect(harness.deliveries).toHaveLength(1);
      expect(harness.deliveries[0].subscriptionId).toBe(subA.id);
      expect(harness.deliveries[0].subscriptionId).not.toBe(subB.id);

      // And the lookup itself was scoped — this is the upstream guard.
      expect(harness.subFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ principalId: PRINCIPAL_A, active: true }),
        }),
      );
    });

    it('cross-principal delete leakage check — deleteMany where-clause carries id AND principalId', async () => {
      const harness = buildWebhooksHarness();
      const svc = makeWebhooksSvc(harness.prisma);

      const subA = await svc.subscribe(PRINCIPAL_A, 'https://hookA.example.com', [
        'verify.completed',
      ]);

      await svc.unsubscribe(PRINCIPAL_B, subA.id);

      // The captured where MUST include BOTH `id` and `principalId: B`.
      // An id-only delete here would silently drop A's row — the bug we're
      // guarding against.
      expect(harness.subDeleteMany).toHaveBeenCalledTimes(1);
      const callArg = harness.subDeleteMany.mock.calls[0]![0] as { where: Record<string, unknown> };
      expect(callArg.where).toEqual({ id: subA.id, principalId: PRINCIPAL_B });
      expect(callArg.where.principalId).toBe(PRINCIPAL_B);
      expect(callArg.where.id).toBe(subA.id);

      // And the row still lives under A.
      expect(harness.subs.get(subA.id)).toBeDefined();
      expect(harness.subs.get(subA.id)!.principalId).toBe(PRINCIPAL_A);
    });
  });
});
