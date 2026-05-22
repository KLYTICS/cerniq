import { randomBytes } from 'node:crypto';

import {
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';

import { AgentRuntimeDto, AgentStatusFilter } from './identity.dto';
import { IdentityService } from './identity.service';

// `@noble/ed25519` v2 needs a synchronous SHA-512 hasher for the sync API.
// We use the async API in tests, but install the sync hash anyway in case
// other specs in the same Jest worker rely on it.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

function b64Url(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

async function makeKeypair(): Promise<{
  privateKey: Uint8Array;
  publicKeyB64: string;
  signMessage: (utf8: string) => Promise<string>;
}> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey,
    publicKeyB64: b64Url(publicKey),
    async signMessage(utf8: string) {
      const sig = await ed.signAsync(new TextEncoder().encode(utf8), privateKey);
      return b64Url(sig);
    },
  };
}

interface FakeAgent {
  id: string;
  publicKey: string;
  principalId: string;
  runtime: string;
  model: string | null;
  label: string | null;
  status: string;
  trustScore: number;
  trustBand: string;
  lastSeenAt: Date | null;
  createdAt: Date;
}

describe('IdentityService.list', () => {
  function build(seed: FakeAgent[]) {
    const findMany = jest.fn(
      async (args: {
        where: { principalId: string; status?: string; runtime?: string; OR?: unknown };
        orderBy: { createdAt: 'desc' };
        take: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        let rows = seed.filter((a) => a.principalId === args.where.principalId);
        if (args.where.status) rows = rows.filter((a) => a.status === args.where.status);
        if (args.where.runtime) rows = rows.filter((a) => a.runtime === args.where.runtime);
        rows = rows.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (args.cursor) {
          const idx = rows.findIndex((r) => r.id === args.cursor!.id);
          rows = idx >= 0 ? rows.slice(idx + (args.skip ?? 0)) : [];
        }
        return rows.slice(0, args.take);
      },
    );
    const count = jest.fn(async (args: { where: { principalId: string } }) =>
      seed.filter((a) => a.principalId === args.where.principalId).length,
    );

    const prisma = { agentIdentity: { findMany, count } } as unknown as PrismaService;
    const redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    return new IdentityService(prisma, redis);
  }

  function fakeAgent(overrides: Partial<FakeAgent> = {}): FakeAgent {
    return {
      id: 'agt_default',
      publicKey: 'pk_test',
      principalId: 'prn_alpha',
      runtime: 'OPENAI',
      model: null,
      label: null,
      status: 'ACTIVE',
      trustScore: 500,
      trustBand: 'VERIFIED',
      lastSeenAt: null,
      createdAt: new Date('2026-05-01T00:00:00Z'),
      ...overrides,
    };
  }

  it('returns only agents owned by the calling principal', async () => {
    const svc = build([
      fakeAgent({ id: 'agt_a', principalId: 'prn_alpha' }),
      fakeAgent({ id: 'agt_b', principalId: 'prn_beta' }),
      fakeAgent({ id: 'agt_c', principalId: 'prn_alpha' }),
    ]);

    const res = await svc.list('prn_alpha', {});
    expect(res.agents.map((a) => a.agentId).sort()).toEqual(['agt_a', 'agt_c']);
    expect(res.total).toBe(2);
    expect(res.nextCursor).toBeNull();
  });

  it('paginates with hasMore + nextCursor when count exceeds limit', async () => {
    const seed = Array.from({ length: 5 }, (_, i) =>
      fakeAgent({
        id: `agt_${i}`,
        principalId: 'prn_alpha',
        createdAt: new Date(2026, 4, i + 1),
      }),
    );
    const svc = build(seed);

    const page1 = await svc.list('prn_alpha', { limit: 2 });
    expect(page1.agents).toHaveLength(2);
    expect(page1.nextCursor).toBe(page1.agents[1]?.agentId);
    expect(page1.total).toBe(5);
  });

  it('clamps limits below 1 and above 100', async () => {
    const seed = Array.from({ length: 3 }, (_, i) =>
      fakeAgent({ id: `agt_${i}`, principalId: 'prn_alpha' }),
    );
    const svc = build(seed);

    // out-of-range limits get clamped silently — controller-level validation
    // already rejects them at the wire, this protects against direct service calls.
    const tooLarge = await svc.list('prn_alpha', { limit: 9999 });
    expect(tooLarge.agents).toHaveLength(3);

    const tooSmall = await svc.list('prn_alpha', { limit: 0 });
    expect(tooSmall.agents).toHaveLength(1);
  });

  it('filters by status and runtime', async () => {
    const svc = build([
      fakeAgent({ id: 'agt_active', principalId: 'prn_alpha', status: 'ACTIVE', runtime: 'OPENAI' }),
      fakeAgent({ id: 'agt_revoked', principalId: 'prn_alpha', status: 'REVOKED', runtime: 'OPENAI' }),
      fakeAgent({ id: 'agt_anthropic', principalId: 'prn_alpha', status: 'ACTIVE', runtime: 'ANTHROPIC' }),
    ]);

    const onlyRevoked = await svc.list('prn_alpha', { status: AgentStatusFilter.REVOKED });
    expect(onlyRevoked.agents.map((a) => a.agentId)).toEqual(['agt_revoked']);

    const onlyAnthropic = await svc.list('prn_alpha', { runtime: AgentRuntimeDto.ANTHROPIC });
    expect(onlyAnthropic.agents.map((a) => a.agentId)).toEqual(['agt_anthropic']);
  });

  it('ignores cross-principal cursors (multi-tenant isolation, CLAUDE.md invariant 5)', async () => {
    const svc = build([
      fakeAgent({ id: 'agt_alpha_only', principalId: 'prn_alpha' }),
      fakeAgent({ id: 'agt_beta_only', principalId: 'prn_beta' }),
    ]);

    // Beta hands an alpha cursor — service must not leak alpha rows.
    const res = await svc.list('prn_beta', { cursor: 'agt_alpha_only' });
    expect(res.agents.every((a) => a.agentId !== 'agt_alpha_only')).toBe(true);
  });
});

describe('IdentityService.findOne / revoke', () => {
  it('findOne throws AGENT_NOT_FOUND when the principal does not own the agent', async () => {
    const prisma = {
      agentIdentity: {
        findFirst: jest.fn(async () => null),
      },
    } as unknown as PrismaService;
    const redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    const svc = new IdentityService(prisma, redis);

    await expect(svc.findOne('prn_alpha', 'agt_belongs_to_beta')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('IdentityService.issueChallenge / verifyHandshake (M-003)', () => {
  function buildHarness(opts: {
    publicKeyB64: string;
    principalId?: string;
    agentId?: string;
    status?: string;
    trustScore?: number;
  }) {
    const principalId = opts.principalId ?? 'prn_alpha';
    const agentId = opts.agentId ?? 'agt_handshake';
    const status = opts.status ?? 'PENDING_VERIFICATION';
    const initialTrust = opts.trustScore ?? 500;
    const updates: { where: { id: string }; data: Record<string, unknown> }[] = [];

    const findFirst = jest.fn(
      async (args: { where: { id: string; principalId: string }; select?: Record<string, true> }) => {
        if (args.where.id !== agentId || args.where.principalId !== principalId) return null;
        return {
          id: agentId,
          publicKey: opts.publicKeyB64,
          status,
          trustScore: initialTrust,
        };
      },
    );
    const update = jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      updates.push(args);
      return { trustScore: (args.data.trustScore as number) ?? initialTrust };
    });

    const store = new Map<string, string>();
    const setCalls: [string, unknown, number | undefined][] = [];
    const redis = {
      get: jest.fn(async <T>(key: string): Promise<T | null> => {
        const raw = store.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
      }),
      set: jest.fn(async <T>(key: string, value: T, ttl?: number): Promise<void> => {
        store.set(key, JSON.stringify(value));
        setCalls.push([key, value, ttl]);
      }),
      del: jest.fn(async (...keys: string[]): Promise<void> => {
        for (const k of keys) store.delete(k);
      }),
    } as unknown as RedisService;

    const prisma = {
      agentIdentity: { findFirst, update },
    } as unknown as PrismaService;

    return {
      svc: new IdentityService(prisma, redis),
      principalId,
      agentId,
      redis: redis as unknown as { get: jest.Mock; set: jest.Mock; del: jest.Mock },
      store,
      setCalls,
      updates,
    };
  }

  it('issues a 256-bit base64url challenge and stores it under a per-agent key', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });

    const res = await h.svc.issueChallenge(h.principalId, h.agentId);

    expect(res.protocolVersion).toBe('okoro-handshake-v1');
    expect(res.expiresIn).toBe(300);
    // 32 raw bytes encoded as base64url ⇒ 43 chars (no padding).
    expect(res.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.message).toBe(`okoro-handshake-v1::${h.agentId}::${res.challenge}`);
    expect(h.store.get(`agent:challenge:${h.agentId}`)).toBe(JSON.stringify(res.challenge));
    // TTL must be applied — fail-closed semantics depend on it.
    expect(h.setCalls[0]?.[2]).toBe(300);
  });

  it('rejects challenge issuance for a revoked agent (FORBIDDEN, no Redis write)', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64, status: 'REVOKED' });

    await expect(h.svc.issueChallenge(h.principalId, h.agentId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(h.redis.set).not.toHaveBeenCalled();
  });

  it('rejects challenge issuance across principals (multi-tenant isolation)', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });

    await expect(h.svc.issueChallenge('prn_attacker', h.agentId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('verifies a correct Ed25519 signature, lifts trust score to ≥600, persists handshake record', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64, trustScore: 500 });

    const challenge = await h.svc.issueChallenge(h.principalId, h.agentId);
    const sig = await kp.signMessage(challenge.message);

    const verified = await h.svc.verifyHandshake(h.principalId, h.agentId, sig);

    expect(verified.protocolVersion).toBe('okoro-handshake-v1');
    expect(verified.agentId).toBe(h.agentId);
    expect(verified.trustScore).toBe(600);
    expect(verified.recordTtlSeconds).toBe(30 * 86_400);
    // Nonce must be consumed.
    expect(h.store.has(`agent:challenge:${h.agentId}`)).toBe(false);
    // Handshake record persisted with TTL.
    const recordKey = `agent:handshake-completed:${h.agentId}`;
    expect(h.store.has(recordKey)).toBe(true);
    const recordEntry = h.setCalls.find(([k]) => k === recordKey);
    expect(recordEntry?.[2]).toBe(30 * 86_400);
    // Trust update was the only write to Postgres.
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]?.data.trustScore).toBe(600);
  });

  it('does not lower trust score for already-trusted agents (no double-bump)', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64, trustScore: 850 });

    const challenge = await h.svc.issueChallenge(h.principalId, h.agentId);
    const sig = await kp.signMessage(challenge.message);

    const verified = await h.svc.verifyHandshake(h.principalId, h.agentId, sig);

    expect(verified.trustScore).toBe(850);
    expect(h.updates).toHaveLength(0);
  });

  it('rejects an invalid signature with INVALID_HANDSHAKE and consumes the nonce (no replay)', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });

    await h.svc.issueChallenge(h.principalId, h.agentId);
    const wrongSig = b64Url(randomBytes(64));

    await expect(
      h.svc.verifyHandshake(h.principalId, h.agentId, wrongSig),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // Nonce must be deleted even on failure — next attempt requires a fresh challenge.
    expect(h.store.has(`agent:challenge:${h.agentId}`)).toBe(false);
    // No handshake record on failure.
    expect(h.store.has(`agent:handshake-completed:${h.agentId}`)).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it('rejects a signature for a different challenge (signed bytes ≠ stored bytes)', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });

    await h.svc.issueChallenge(h.principalId, h.agentId);
    // Attacker signs a self-chosen message rather than the stored nonce.
    const sigForOtherMessage = await kp.signMessage(
      `okoro-handshake-v1::${h.agentId}::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
    );

    await expect(
      h.svc.verifyHandshake(h.principalId, h.agentId, sigForOtherMessage),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects verify with no active challenge as CHALLENGE_EXPIRED (Gone)', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });
    const sig = await kp.signMessage('whatever');

    await expect(
      h.svc.verifyHandshake(h.principalId, h.agentId, sig),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('rejects replay: second verify after success has no nonce → CHALLENGE_EXPIRED', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });

    const challenge = await h.svc.issueChallenge(h.principalId, h.agentId);
    const sig = await kp.signMessage(challenge.message);

    // First call succeeds.
    await h.svc.verifyHandshake(h.principalId, h.agentId, sig);
    // Replaying the same signature: nonce gone, throws GoneException.
    await expect(
      h.svc.verifyHandshake(h.principalId, h.agentId, sig),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('rejects malformed signature length without crashing (input validation, fail-closed)', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });
    await h.svc.issueChallenge(h.principalId, h.agentId);

    const tooShort = b64Url(randomBytes(32));
    await expect(
      h.svc.verifyHandshake(h.principalId, h.agentId, tooShort),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects cross-principal verify-handshake (cannot verify handshake for someone else’s agent)', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });
    const challenge = await h.svc.issueChallenge(h.principalId, h.agentId);
    const sig = await kp.signMessage(challenge.message);

    await expect(
      h.svc.verifyHandshake('prn_attacker', h.agentId, sig),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getHandshakeStatus returns verified=false when no record exists', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });

    const status = await h.svc.getHandshakeStatus(h.principalId, h.agentId);
    expect(status).toEqual({ agentId: h.agentId, verified: false });
  });

  it('getHandshakeStatus reflects a successful handshake (verified + verifiedAt + protocolVersion)', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });

    const challenge = await h.svc.issueChallenge(h.principalId, h.agentId);
    const sig = await kp.signMessage(challenge.message);
    const verified = await h.svc.verifyHandshake(h.principalId, h.agentId, sig);

    const status = await h.svc.getHandshakeStatus(h.principalId, h.agentId);
    expect(status.verified).toBe(true);
    expect(status.verifiedAt).toBe(verified.verifiedAt);
    expect(status.protocolVersion).toBe('okoro-handshake-v1');
  });

  it('getHandshakeStatus is principal-scoped (cross-principal reads throw AGENT_NOT_FOUND)', async () => {
    const kp = await makeKeypair();
    const h = buildHarness({ publicKeyB64: kp.publicKeyB64 });

    await expect(
      h.svc.getHandshakeStatus('prn_attacker', h.agentId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
