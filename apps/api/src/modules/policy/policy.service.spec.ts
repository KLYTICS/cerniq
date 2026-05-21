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
  createdAt: Date;
}

function makePrisma(agents: AgentRow[] = [], policies: PolicyRow[] = []) {
  return {
    agentIdentity: {
      findFirst: jest.fn(async ({ where }: { where: Partial<AgentRow> }) => {
        return agents.find(
          (a) =>
            (!where.id || a.id === where.id) &&
            (!where.principalId || a.principalId === where.principalId),
        ) ?? null;
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
          createdAt: new Date(),
        };
        policies.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: { agentId: string } }) => {
        return policies.filter((p) => p.agentId === where.agentId);
      }),
      findFirst: jest.fn(async ({ where }: { where: { id: string; agentId: string } }) => {
        return policies.find((p) => p.id === where.id && p.agentId === where.agentId) ?? null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<PolicyRow> }) => {
        const p = policies.find((x) => x.id === where.id);
        if (p) Object.assign(p, data);
        return p;
      }),
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

// ── Factory ───────────────────────────────────────────────────────────────────

function makeService(opts: { agents?: AgentRow[]; policies?: PolicyRow[] } = {}) {
  const agents: AgentRow[] = opts.agents ?? [];
  const policies: PolicyRow[] = opts.policies ?? [];
  const prisma = makePrisma(agents, policies);
  const redis = makeRedis();
  const jwt = makeJwt();
  const svc = new PolicyService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    jwt as unknown as JwtUtil,
  );
  svc.setSigningMaterial(FAKE_PRIVATE_KEY, FAKE_PUBLIC_KEY_B64);
  return { svc, prisma, redis, jwt, agents, policies };
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ACTIVE_AGENT: AgentRow = { id: 'agt_1', principalId: 'prn_A', status: 'ACTIVE' };
const REVOKED_AGENT: AgentRow = { id: 'agt_rev', principalId: 'prn_A', status: 'REVOKED' };

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
      await expect(svc.create('prn_A', 'agt_nonexistent', BASE_DTO)).rejects.toThrow(NotFoundException);
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
      (svc as unknown as { aegisPrivateKey: undefined }).aegisPrivateKey = undefined;
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
      const policies: PolicyRow[] = [{
        id: 'pol_1', agentId: 'agt_1', label: 'Test', scopes: [],
        status: 'ACTIVE', signedToken: 'tok', tokenHash: 'h',
        expiresAt: new Date(futureIso()), revokedAt: null, createdAt: new Date(),
      }];
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

    it('maps Prisma rows to PolicyResponseDto shape', async () => {
      const expiresAt = new Date(futureIso());
      const policies: PolicyRow[] = [{
        id: 'pol_2', agentId: 'agt_1', label: 'My policy', scopes: [{ category: 'commerce' }],
        status: 'ACTIVE', signedToken: 'tok', tokenHash: 'h',
        expiresAt, revokedAt: null, createdAt: new Date(),
      }];
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

  describe('revoke()', () => {
    const existingPolicy: PolicyRow = {
      id: 'pol_active', agentId: 'agt_1', label: 'active',
      scopes: [], status: 'ACTIVE', signedToken: 'tok', tokenHash: 'h',
      expiresAt: new Date(futureIso()), revokedAt: null, createdAt: new Date(),
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
      await expect(svc.revoke('prn_A', 'agt_1', 'pol_nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('is idempotent — revoking an already-revoked policy just updates and returns', async () => {
      const policies: PolicyRow[] = [{ ...existingPolicy, status: 'REVOKED' }];
      // findFirst still returns it (policy exists, just revoked)
      const { svc } = makeService({ agents: [ACTIVE_AGENT], policies });
      await expect(svc.revoke('prn_A', 'agt_1', 'pol_active')).resolves.toBeUndefined();
    });
  });
});
