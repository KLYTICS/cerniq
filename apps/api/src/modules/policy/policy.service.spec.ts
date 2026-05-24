/**
 * PolicyService — unit tests
 *
 * Coverage:
 *   create()  — agent ownership check, revoked-agent guard, expiry guard,
 *               signing-material guard, token issued + DB row created
 *   list()    — ownership scoped; returns mapped DTOs
 *   revoke()  — ownership scoped; policy status → REVOKED; Redis cache evicted
 *
 * Isolation invariant: every operation must verify that the agent belongs
 * to the requesting principalId before touching any policy data.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { JwtUtil } from '../../common/crypto/jwt.util';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { AuditService } from '../audit/audit.service';
import type { WebhooksService } from '../webhooks/webhooks.service';

import { ScopeCategory } from './policy.dto';
import { PolicyService } from './policy.service';

// ── Signing material ──────────────────────────────────────────────────────────

const FAKE_PRIVATE_KEY = new Uint8Array(32).fill(1);
const FAKE_PUBLIC_KEY_B64 = 'cHVibGlja2V5Zm9ydGVzdGluZw==';

// ── Prisma stub ───────────────────────────────────────────────────────────────

interface AgentRow {
  id: string;
  principalId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  trustScore: number;
  trustBand: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
}

interface PolicyRow {
  id: string;
  agentId: string;
  label: string | null;
  scopes: unknown;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  signedToken: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
}

function makePrisma(agents: AgentRow[] = [], policies: PolicyRow[] = []) {
  return {
    agentIdentity: {
      findFirst: jest.fn(async ({ where }: { where: Partial<AgentRow> }) => {
        return (
          agents.find(
            (a) =>
              (!where.id || a.id === where.id) &&
              (!where.principalId || a.principalId === where.principalId),
          ) ?? null
        );
      }),
    },
    agentPolicy: {
      create: jest.fn(async ({ data }: { data: Partial<PolicyRow> }) => {
        const row: PolicyRow = {
          id: data.id!,
          agentId: data.agentId!,
          label: data.label ?? null,
          scopes: data.scopes ?? [],
          status: 'ACTIVE',
          signedToken: data.signedToken!,
          tokenHash: data.tokenHash!,
          expiresAt: data.expiresAt!,
          revokedAt: null,
          revokedReason: null,
          createdAt: new Date(),
        };
        policies.push(row);
        return row;
      }),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { agentId: string; status?: 'ACTIVE' | 'EXPIRED' | 'REVOKED' };
        }) => {
          return policies.filter(
            (p) =>
              p.agentId === where.agentId && (where.status ? p.status === where.status : true),
          );
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string; agentId: string } }) => {
        return policies.find((p) => p.id === where.id && p.agentId === where.agentId) ?? null;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<PolicyRow> }) => {
          const p = policies.find((x) => x.id === where.id);
          if (p) Object.assign(p, data);
          return p;
        },
      ),
    },
  };
}

function makeRedis(): jest.Mocked<Pick<RedisService, 'del'>> {
  return { del: jest.fn().mockResolvedValue(1) };
}

function makeJwt(): jest.Mocked<Pick<JwtUtil, 'sign'>> {
  let seq = 0;
  return { sign: jest.fn().mockImplementation(async () => `jwt_signed_${++seq}`) };
}

function makeAudit(): jest.Mocked<Pick<AuditService, 'append'>> {
  let seq = 0;
  return { append: jest.fn().mockImplementation(async () => `evt_test_${++seq}`) };
}

function makeWebhooks(): jest.Mocked<Pick<WebhooksService, 'enqueue'>> {
  return { enqueue: jest.fn().mockResolvedValue(undefined) };
}

// ── Factory ───────────────────────────────────────────────────────────────────

function makeService(opts: { agents?: AgentRow[]; policies?: PolicyRow[] } = {}) {
  const agents: AgentRow[] = opts.agents ?? [];
  const policies: PolicyRow[] = opts.policies ?? [];
  const prisma = makePrisma(agents, policies);
  const redis = makeRedis();
  const jwt = makeJwt();
  const audit = makeAudit();
  const webhooks = makeWebhooks();
  const svc = new PolicyService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    jwt as unknown as JwtUtil,
    audit as unknown as AuditService,
    webhooks as unknown as WebhooksService,
  );
  svc.setSigningMaterial(FAKE_PRIVATE_KEY, FAKE_PUBLIC_KEY_B64);
  return { svc, prisma, redis, jwt, audit, webhooks, agents, policies };
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ACTIVE_AGENT: AgentRow = {
  id: 'agt_1',
  principalId: 'prn_A',
  status: 'ACTIVE',
  trustScore: 750,
  trustBand: 'VERIFIED',
};
const REVOKED_AGENT: AgentRow = {
  id: 'agt_rev',
  principalId: 'prn_A',
  status: 'REVOKED',
  trustScore: 0,
  trustBand: 'FLAGGED',
};

function futureIso(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString();
}

const BASE_DTO = {
  scopes: [{ category: ScopeCategory.COMMERCE }],
  expiresAt: futureIso(),
  label: 'Test policy',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PolicyService', () => {
  describe('create()', () => {
    it('creates a policy and returns policyId + signedToken + expiresAt', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT] });
      const result = await svc.create('prn_A', 'agt_1', BASE_DTO);
      expect(result.policyId).toMatch(/^pol_/);
      expect(result.signedToken).toMatch(/^jwt_signed_/);
      expect(result.expiresAt).toBeDefined();
    });

    it('throws NotFoundException when agent does not belong to principal', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT] });
      // prn_B tries to create a policy on agt_1 (owned by prn_A)
      await expect(svc.create('prn_B', 'agt_1', BASE_DTO)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when agentId does not exist at all', async () => {
      const { svc } = makeService({ agents: [] });
      await expect(svc.create('prn_A', 'agt_nonexistent', BASE_DTO)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when agent is REVOKED', async () => {
      const { svc } = makeService({ agents: [REVOKED_AGENT] });
      await expect(svc.create('prn_A', 'agt_rev', BASE_DTO)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when expiresAt is in the past', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT] });
      const pastDto = { ...BASE_DTO, expiresAt: new Date(Date.now() - 1000).toISOString() };
      await expect(svc.create('prn_A', 'agt_1', pastDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws when signing material has not been set', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT] });
      // Bypass setSigningMaterial
      (svc as unknown as { cerniqPrivateKey: undefined }).cerniqPrivateKey = undefined;
      await expect(svc.create('prn_A', 'agt_1', BASE_DTO)).rejects.toThrow(/signing material/i);
    });

    it('calls jwt.sign and persists the signed token + its sha256 hash', async () => {
      const { svc, jwt, policies } = makeService({ agents: [ACTIVE_AGENT] });
      await svc.create('prn_A', 'agt_1', BASE_DTO);
      expect(jwt.sign).toHaveBeenCalledTimes(1);
      expect(policies[0].signedToken).toMatch(/^jwt_signed_/);
      expect(policies[0].tokenHash).toHaveLength(64); // SHA-256 hex
    });

    it('stores the policy with status ACTIVE', async () => {
      const { svc, policies } = makeService({ agents: [ACTIVE_AGENT] });
      await svc.create('prn_A', 'agt_1', BASE_DTO);
      expect(policies[0].status).toBe('ACTIVE');
    });
  });

  describe('list()', () => {
    it('returns policies for the given agent owned by the principal', async () => {
      const policies: PolicyRow[] = [
        {
          id: 'pol_1',
          agentId: 'agt_1',
          label: 'Test',
          scopes: [],
          status: 'ACTIVE',
          signedToken: 'tok',
          tokenHash: 'h',
          expiresAt: new Date(futureIso()),
          revokedAt: null,
          revokedReason: null,
          createdAt: new Date(),
        },
      ];
      const { svc } = makeService({ agents: [ACTIVE_AGENT], policies });
      const list = await svc.list('prn_A', 'agt_1');
      expect(list).toHaveLength(1);
      expect(list[0].policyId).toBe('pol_1');
    });

    it('throws NotFoundException when agent does not belong to principal', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT] });
      await expect(svc.list('prn_B', 'agt_1')).rejects.toThrow(NotFoundException);
    });

    it('returns empty array when agent has no policies', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT], policies: [] });
      const list = await svc.list('prn_A', 'agt_1');
      expect(list).toEqual([]);
    });

    // ── OD-024 Phase A3 ────────────────────────────────────────────────────────
    it('filters by status when supplied (OD-024 Phase A3)', async () => {
      const expiresAt = new Date(futureIso());
      const base = {
        agentId: 'agt_1',
        label: null,
        scopes: [],
        signedToken: 'tok',
        tokenHash: 'h',
        expiresAt,
        revokedAt: null,
        revokedReason: null,
        createdAt: new Date(),
      };
      const policies: PolicyRow[] = [
        { ...base, id: 'pol_active', status: 'ACTIVE' as const },
        { ...base, id: 'pol_revoked', status: 'REVOKED' as const },
        { ...base, id: 'pol_expired', status: 'EXPIRED' as const },
      ];
      const { svc } = makeService({ agents: [ACTIVE_AGENT], policies });

      const onlyActive = await svc.list('prn_A', 'agt_1', { status: 'ACTIVE' });
      expect(onlyActive.map((p) => p.policyId)).toEqual(['pol_active']);

      const onlyRevoked = await svc.list('prn_A', 'agt_1', { status: 'REVOKED' });
      expect(onlyRevoked.map((p) => p.policyId)).toEqual(['pol_revoked']);

      const noFilter = await svc.list('prn_A', 'agt_1', {});
      expect(noFilter.map((p) => p.policyId).sort()).toEqual(
        ['pol_active', 'pol_expired', 'pol_revoked'].sort(),
      );
    });

    it('maps Prisma rows to PolicyResponseDto shape', async () => {
      const expiresAt = new Date(futureIso());
      const policies: PolicyRow[] = [
        {
          id: 'pol_2',
          agentId: 'agt_1',
          label: 'My policy',
          scopes: [{ category: 'commerce' }],
          status: 'ACTIVE',
          signedToken: 'tok',
          tokenHash: 'h',
          expiresAt,
          revokedAt: null,
          revokedReason: null,
          createdAt: new Date(),
        },
      ];
      const { svc } = makeService({ agents: [ACTIVE_AGENT], policies });
      const [dto] = await svc.list('prn_A', 'agt_1');
      expect(dto).toMatchObject({
        policyId: 'pol_2',
        agentId: 'agt_1',
        label: 'My policy',
        status: 'ACTIVE',
        expiresAt: expiresAt.toISOString(),
      });
    });
  });

  describe('findOne()', () => {
    const existing: PolicyRow = {
      id: 'pol_lookup',
      agentId: 'agt_1',
      label: 'lookup target',
      scopes: [],
      status: 'ACTIVE',
      signedToken: 'tok',
      tokenHash: 'h',
      expiresAt: new Date(futureIso()),
      revokedAt: null,
      revokedReason: null,
      createdAt: new Date(),
    };

    it('returns the mapped PolicyResponseDto when policy exists on owned agent', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT], policies: [{ ...existing }] });
      const dto = await svc.findOne('prn_A', 'agt_1', 'pol_lookup');
      expect(dto.policyId).toBe('pol_lookup');
      expect(dto.agentId).toBe('agt_1');
    });

    it('throws NotFoundException when policy does not exist', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT], policies: [] });
      await expect(svc.findOne('prn_A', 'agt_1', 'pol_missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when agent does not belong to principal', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT], policies: [{ ...existing }] });
      await expect(svc.findOne('prn_B', 'agt_1', 'pol_lookup')).rejects.toThrow(NotFoundException);
    });
  });

  describe('revoke()', () => {
    const existingPolicy: PolicyRow = {
      id: 'pol_active',
      agentId: 'agt_1',
      label: 'active',
      scopes: [],
      status: 'ACTIVE',
      signedToken: 'tok',
      tokenHash: 'h',
      expiresAt: new Date(futureIso()),
      revokedAt: null,
      revokedReason: null,
      createdAt: new Date(),
    };

    it('sets policy status to REVOKED', async () => {
      const policies = [{ ...existingPolicy }];
      const { svc, policies: stored } = makeService({ agents: [ACTIVE_AGENT], policies });
      await svc.revoke('prn_A', 'agt_1', 'pol_active');
      expect(stored[0].status).toBe('REVOKED');
    });

    it('evicts the Redis cache key for the policy', async () => {
      const policies = [{ ...existingPolicy }];
      const { svc, redis } = makeService({ agents: [ACTIVE_AGENT], policies });
      await svc.revoke('prn_A', 'agt_1', 'pol_active');
      expect(redis.del).toHaveBeenCalledWith('policy:pol_active');
    });

    it('throws NotFoundException when agent does not belong to principal', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT] });
      await expect(svc.revoke('prn_B', 'agt_1', 'pol_active')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when policy does not exist on the agent', async () => {
      const { svc } = makeService({ agents: [ACTIVE_AGENT], policies: [] });
      await expect(svc.revoke('prn_A', 'agt_1', 'pol_nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('is idempotent — revoking an already-revoked policy just updates and returns', async () => {
      const policies: PolicyRow[] = [{ ...existingPolicy, status: 'REVOKED' }];
      // findFirst still returns it (policy exists, just revoked)
      const { svc } = makeService({ agents: [ACTIVE_AGENT], policies });
      await expect(svc.revoke('prn_A', 'agt_1', 'pol_active')).resolves.toBeUndefined();
    });

    // ── OD-024 Phase A2 — reason capture into AgentPolicy.revokedReason ─────────
    it('persists reason on the policy row when provided', async () => {
      const policies: PolicyRow[] = [{ ...existingPolicy }];
      const { svc, policies: stored } = makeService({ agents: [ACTIVE_AGENT], policies });
      await svc.revoke('prn_A', 'agt_1', 'pol_active', 'key compromised');
      expect(stored[0].status).toBe('REVOKED');
      expect(stored[0].revokedReason).toBe('key compromised');
    });

    it('leaves revokedReason null when no reason supplied', async () => {
      const policies: PolicyRow[] = [{ ...existingPolicy }];
      const { svc, policies: stored } = makeService({ agents: [ACTIVE_AGENT], policies });
      await svc.revoke('prn_A', 'agt_1', 'pol_active');
      expect(stored[0].revokedReason).toBeNull();
    });

    // ── OD-024 Phase A4 — signed audit-chain append on revoke ──────────────────
    it('appends a signed audit-chain event with the policy snapshot', async () => {
      const policies: PolicyRow[] = [{ ...existingPolicy }];
      const { svc, audit } = makeService({ agents: [ACTIVE_AGENT], policies });
      await svc.revoke('prn_A', 'agt_1', 'pol_active', 'rotation');

      expect(audit.append).toHaveBeenCalledTimes(1);
      const [event] = audit.append.mock.calls[0] as unknown as [Record<string, unknown>];
      expect(event).toMatchObject({
        agentId: 'agt_1',
        claimedAgentId: 'agt_1',
        principalId: 'prn_A',
        action: 'policy.revoked',
        decision: 'APPROVED',
        policyId: 'pol_active',
        trustScoreAtEvent: 750,
        trustBandAtEvent: 'VERIFIED',
      });
      expect(event.policySnapshot).toMatchObject({
        reason: 'rotation',
        previousStatus: 'ACTIVE',
        label: 'active',
      });
    });

    it('captures previous status when revoking an already-revoked policy (idempotent)', async () => {
      const policies: PolicyRow[] = [{ ...existingPolicy, status: 'REVOKED' }];
      const { svc, audit } = makeService({ agents: [ACTIVE_AGENT], policies });
      await svc.revoke('prn_A', 'agt_1', 'pol_active', 're-revoke');

      const [event] = audit.append.mock.calls[0] as unknown as [Record<string, unknown>];
      expect((event.policySnapshot as { previousStatus: string }).previousStatus).toBe('REVOKED');
    });

    it('records the agent trust score + band as they stood at revocation', async () => {
      const flagged: AgentRow = {
        id: 'agt_flagged',
        principalId: 'prn_A',
        status: 'ACTIVE',
        trustScore: 250,
        trustBand: 'WATCH',
      };
      const policies: PolicyRow[] = [{ ...existingPolicy, agentId: 'agt_flagged' }];
      const { svc, audit } = makeService({ agents: [flagged], policies });
      await svc.revoke('prn_A', 'agt_flagged', 'pol_active');

      const [event] = audit.append.mock.calls[0] as unknown as [Record<string, unknown>];
      expect(event.trustScoreAtEvent).toBe(250);
      expect(event.trustBandAtEvent).toBe('WATCH');
    });

    // ── OD-024 Phase A5 — webhook fanout `cerniq.policy.revoked` ───────────────
    it('fans `cerniq.policy.revoked` webhook to active subscribers', async () => {
      const policies: PolicyRow[] = [{ ...existingPolicy }];
      const { svc, webhooks } = makeService({ agents: [ACTIVE_AGENT], policies });
      await svc.revoke('prn_A', 'agt_1', 'pol_active', 'rotation');

      expect(webhooks.enqueue).toHaveBeenCalledTimes(1);
      const [event, fanoutPrincipalId] = webhooks.enqueue.mock.calls[0] as unknown as [
        { type: string; data: Record<string, unknown> },
        string,
      ];
      expect(event.type).toBe('cerniq.policy.revoked');
      expect(fanoutPrincipalId).toBe('prn_A');
      expect(event.data).toMatchObject({
        policyId: 'pol_active',
        agentId: 'agt_1',
        reason: 'rotation',
        previousStatus: 'ACTIVE',
      });
      expect(typeof event.data.revokedAt).toBe('string');
    });

    it('webhook fanout carries reason=null when no reason supplied', async () => {
      const policies: PolicyRow[] = [{ ...existingPolicy }];
      const { svc, webhooks } = makeService({ agents: [ACTIVE_AGENT], policies });
      await svc.revoke('prn_A', 'agt_1', 'pol_active');

      const [event] = webhooks.enqueue.mock.calls[0] as unknown as [
        { data: { reason: string | null } },
      ];
      expect(event.data.reason).toBeNull();
    });
  });
});
