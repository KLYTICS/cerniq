import { VerifyService } from './verify.service';
import { Ed25519Util, encodeBase64Url } from '../../common/crypto/ed25519.util';
import { JwtUtil } from '../../common/crypto/jwt.util';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { SpendGuardService } from './spend-guard.service';
import type { ReplayCacheService } from './replay-cache.service';
import type { AuditService } from '../audit/audit.service';
import type { BateService } from '../bate/bate.service';
import type { AppConfigService } from '../../config/config.service';
import type { MetricsService } from '../../common/observability/metrics.service';
import type { UsageGuardService } from '../billing/usage-guard.service';
import type { TrialService } from '../billing/trial.service';

const RP_PRINCIPAL = 'rp_test_principal';

interface PolicyRecord {
  id: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  expiresAt: Date;
  scopes: Array<Record<string, unknown>>;
}

interface AgentRecord {
  id: string;
  publicKey: string;
  status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED' | 'REVOKED';
  trustScore: number;
  trustBand: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  principalId: string;
}

function buildHarness() {
  const ed = new Ed25519Util();
  const jwt = new JwtUtil();
  const cache = new Map<string, unknown>();
  let auditCounter = 0;
  const audit = {
    append: jest.fn(async () => `evt_${++auditCounter}`),
  } as unknown as AuditService;
  const bate = { ingestSignal: jest.fn().mockResolvedValue(undefined) } as unknown as BateService;
  const spendGuard = {
    check: jest.fn().mockResolvedValue({ allowed: true, remainingDay: 1000, remainingMonth: 5000 }),
    recordSpend: jest.fn().mockResolvedValue(undefined),
  } as unknown as SpendGuardService;
  const config = { enableBate: true } as unknown as AppConfigService;

  const redis = {
    get: jest.fn(async (k: string) => cache.get(k) ?? null),
    set: jest.fn(async (k: string, v: unknown) => {
      cache.set(k, v);
    }),
    del: jest.fn(async (...ks: string[]) => ks.forEach((k) => cache.delete(k))),
  } as unknown as RedisService;

  let agent: AgentRecord | null = null;
  let policy: PolicyRecord | null = null;

  const prisma = {
    agentIdentity: {
      findUnique: jest.fn(async () => agent),
      update: jest.fn(async () => agent),
    },
    agentPolicy: {
      findUnique: jest.fn(async () => policy),
    },
  } as unknown as PrismaService;

  const metrics = {
    verifyLatency: { observe: jest.fn() },
    verifyTotal: { inc: jest.fn() },
    bateScoreDelta: { observe: jest.fn() },
    httpRequestsTotal: { inc: jest.fn() },
    auditAppendTotal: { inc: jest.fn() },
    webhookDeliveryTotal: { inc: jest.fn() },
  } as unknown as MetricsService;

  // ReplayCacheService — fake in-memory consumeJti so tests run without Redis.
  const seenJtis = new Set<string>();
  const replayCache = {
    consume: jest.fn(async (jti: string) => {
      if (seenJtis.has(jti)) return false;
      seenJtis.add(jti);
      return true;
    }),
  } as unknown as ReplayCacheService;

  // UsageGuardService — billing gate, defaults to allow-all so the verify
  // tests don't need to know about plan tiers. Specs that exercise the
  // PLAN_LIMIT_EXCEEDED path can override `checkQuota` per-test.
  const usageGuard = {
    checkQuota: jest.fn(async () => ({
      allowed: true,
      remaining: 999_999,
      planTier: 'DEVELOPER',
      monthlyQuota: 1_000_000,
    })),
    incrementUsage: jest.fn(),
    invalidatePlanCache: jest.fn(async () => undefined),
  } as unknown as UsageGuardService;

  // TrialService — defaults to allow-all (non-FREE tier) so existing
  // verify tests don't need to know about ADR-0014. Specs that exercise
  // the TRIAL_EXHAUSTED path override `checkAndIncrement` per-test.
  const trial = {
    checkAndIncrement: jest.fn(async () => ({ exhausted: false, remaining: -1 })),
    getStatus: jest.fn(),
    reset: jest.fn(async () => undefined),
  } as unknown as TrialService;

  const svc = new VerifyService(
    prisma,
    redis,
    jwt,
    bate,
    spendGuard,
    replayCache,
    usageGuard,
    trial,
    audit,
    config,
    metrics,
  );

  return {
    svc,
    ed,
    jwt,
    setAgent: (a: AgentRecord | null) => {
      agent = a;
      cache.delete(`agent:status:${a?.id}`);
    },
    setPolicy: (p: PolicyRecord | null) => {
      policy = p;
      cache.delete(`policy:${p?.id}`);
    },
    audit,
    spendGuard,
  };
}

async function token(jwt: JwtUtil, ed: Ed25519Util, sub: string, pid: string, action?: string, amt?: number) {
  const kp = await ed.generateKeypair();
  const t = await jwt.sign(
    {
      sub,
      pid,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      jti: 'jti_' + Math.random(),
      ...(action ? { act: action } : {}),
      ...(amt !== undefined ? { amt } : {}),
    },
    kp.privateKey,
  );
  return { token: t, publicKey: encodeBase64Url(kp.publicKey) };
}

describe('VerifyService denial paths', () => {
  it('returns INVALID_SIGNATURE for malformed token', async () => {
    const { svc } = buildHarness();
    const r = await svc.verify({ token: 'not.a.token' }, RP_PRINCIPAL);
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('returns AGENT_NOT_FOUND when agent missing', async () => {
    const { svc, ed, jwt } = buildHarness();
    const { token: t } = await token(jwt, ed, 'agt_missing', 'pol_x');
    const r = await svc.verify({ token: t }, RP_PRINCIPAL);
    expect(r.valid).toBe(false);
    expect(r.denialReason).toBe('AGENT_NOT_FOUND');
  });

  it('returns AGENT_REVOKED when agent revoked', async () => {
    const { svc, ed, jwt, setAgent } = buildHarness();
    const { token: t, publicKey } = await token(jwt, ed, 'agt_1', 'pol_1');
    setAgent({
      id: 'agt_1',
      publicKey,
      status: 'REVOKED',
      trustScore: 500,
      trustBand: 'VERIFIED',
      principalId: 'p_1',
    });
    const r = await svc.verify({ token: t }, RP_PRINCIPAL);
    expect(r.denialReason).toBe('AGENT_REVOKED');
  });

  it('returns INVALID_SIGNATURE when signed with a foreign key', async () => {
    const { svc, ed, jwt, setAgent } = buildHarness();
    const { token: t } = await token(jwt, ed, 'agt_1', 'pol_1');
    const otherKey = await ed.generateKeypair();
    setAgent({
      id: 'agt_1',
      publicKey: encodeBase64Url(otherKey.publicKey),
      status: 'ACTIVE',
      trustScore: 500,
      trustBand: 'VERIFIED',
      principalId: 'p_1',
    });
    const r = await svc.verify({ token: t }, RP_PRINCIPAL);
    expect(r.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('returns POLICY_REVOKED when policy revoked', async () => {
    const { svc, ed, jwt, setAgent, setPolicy } = buildHarness();
    const { token: t, publicKey } = await token(jwt, ed, 'agt_1', 'pol_1');
    setAgent({ id: 'agt_1', publicKey, status: 'ACTIVE', trustScore: 500, trustBand: 'VERIFIED', principalId: 'p_1' });
    setPolicy({ id: 'pol_1', status: 'REVOKED', expiresAt: new Date(Date.now() + 60_000), scopes: [] });
    const r = await svc.verify({ token: t }, RP_PRINCIPAL);
    expect(r.denialReason).toBe('POLICY_REVOKED');
  });

  it('returns SCOPE_NOT_GRANTED when domain is not allow-listed', async () => {
    const { svc, ed, jwt, setAgent, setPolicy } = buildHarness();
    const { token: t, publicKey } = await token(jwt, ed, 'agt_1', 'pol_1', 'commerce.purchase', 100);
    setAgent({ id: 'agt_1', publicKey, status: 'ACTIVE', trustScore: 500, trustBand: 'VERIFIED', principalId: 'p_1' });
    setPolicy({
      id: 'pol_1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      scopes: [{ category: 'commerce', allowedDomains: ['delta.com'] }],
    });
    const r = await svc.verify({ token: t, action: 'commerce.purchase', merchantDomain: 'evil.example' }, RP_PRINCIPAL);
    expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
  });

  it('approves a valid request', async () => {
    const { svc, ed, jwt, setAgent, setPolicy } = buildHarness();
    const { token: t, publicKey } = await token(jwt, ed, 'agt_1', 'pol_1', 'commerce.purchase', 100);
    setAgent({ id: 'agt_1', publicKey, status: 'ACTIVE', trustScore: 720, trustBand: 'VERIFIED', principalId: 'p_1' });
    setPolicy({
      id: 'pol_1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      scopes: [
        {
          category: 'commerce',
          allowedDomains: ['delta.com'],
          spendLimit: { currency: 'USD', maxPerTransaction: 500, maxPerDay: 1000 },
        },
      ],
    });
    const r = await svc.verify(
      {
        token: t,
        action: 'commerce.purchase',
        amount: 100,
        currency: 'USD',
        merchantDomain: 'delta.com',
      },
      RP_PRINCIPAL,
    );
    expect(r.valid).toBe(true);
    expect(r.trustScore).toBe(720);
    expect(r.scopesGranted).toEqual(['commerce']);
  });
});
