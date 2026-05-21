// Unit tests for UsageGuardService — pure Jest, no NestJS TestingModule.
// CLAUDE.md mandates a unit test per public service method:
//   - checkQuota
//   - incrementUsage
//   - invalidatePlanCache

import type { PlanTier } from '@prisma/client';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';

import { UsageGuardService } from './usage-guard.service';

// type-rationale: jest mock chains use `any` because ioredis-mock chain types
// are not what we need to assert here — we only care call shape.
interface MultiChain {
  set: jest.Mock;
  expire: jest.Mock;
  incr: jest.Mock;
  // type-rationale: exec returns Redis multi reply; tests just resolve [].
  exec: jest.Mock<Promise<unknown[]>, []>;
}

interface MockPrisma {
  auditEvent: { count: jest.Mock };
  principal: { findUnique: jest.Mock };
}

interface MockRedis {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  raw: jest.Mock;
}

function makeMultiChain(): MultiChain {
  const chain = {
    set: jest.fn(),
    expire: jest.fn(),
    incr: jest.fn(),
    exec: jest.fn().mockResolvedValue([]),
  };
  chain.set.mockReturnValue(chain);
  chain.expire.mockReturnValue(chain);
  chain.incr.mockReturnValue(chain);
  return chain;
}

interface RawClientMock {
  get: jest.Mock;
  multi: jest.Mock;
}

function makeMockRedis(): { mock: MockRedis; rawClient: RawClientMock; multiChain: MultiChain } {
  const multiChain = makeMultiChain();
  const rawClient: RawClientMock = {
    get: jest.fn(),
    multi: jest.fn().mockReturnValue(multiChain),
  };
  const mock: MockRedis = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    raw: jest.fn().mockReturnValue(rawClient),
  };
  return { mock, rawClient, multiChain };
}

describe('UsageGuardService', () => {
  const PRINCIPAL_ID = 'prin_test_abc123';
  const FROZEN_DATE = new Date('2026-05-15T12:00:00Z');
  const EXPECTED_MONTH_KEY = '2026-05';
  const PLAN_KEY = `aegis:plan:${PRINCIPAL_ID}`;
  const USAGE_KEY = `aegis:usage:${PRINCIPAL_ID}:${EXPECTED_MONTH_KEY}`;

  let prisma: MockPrisma;
  let redisHandles: ReturnType<typeof makeMockRedis>;
  let service: UsageGuardService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FROZEN_DATE);

    prisma = {
      auditEvent: { count: jest.fn() },
      principal: { findUnique: jest.fn() },
    };
    redisHandles = makeMockRedis();

    service = new UsageGuardService(
      prisma as unknown as PrismaService,
      redisHandles.mock as unknown as RedisService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────
  // checkQuota
  // ──────────────────────────────────────────────────────────────────────
  describe('checkQuota', () => {
    it('plan cache hit returns cached tier without DB call', async () => {
      redisHandles.mock.get.mockResolvedValueOnce({ tier: 'DEVELOPER' as PlanTier });
      redisHandles.rawClient.get.mockResolvedValueOnce('100');

      const result = await service.checkQuota(PRINCIPAL_ID);

      expect(redisHandles.mock.get).toHaveBeenCalledWith(PLAN_KEY);
      expect(prisma.principal.findUnique).not.toHaveBeenCalled();
      expect(result.planTier).toBe('DEVELOPER');
    });

    it('plan cache miss queries DB then writes Redis cache', async () => {
      redisHandles.mock.get.mockResolvedValueOnce(null);
      prisma.principal.findUnique.mockResolvedValueOnce({ planTier: 'GROWTH' as PlanTier });
      redisHandles.rawClient.get.mockResolvedValueOnce('5');

      const result = await service.checkQuota(PRINCIPAL_ID);

      expect(prisma.principal.findUnique).toHaveBeenCalledWith({
        where: { id: PRINCIPAL_ID },
        select: { planTier: true },
      });
      expect(redisHandles.mock.set).toHaveBeenCalledWith(
        PLAN_KEY,
        { tier: 'GROWTH' },
        300,
      );
      expect(result.planTier).toBe('GROWTH');
    });

    it('principal not found defaults to FREE tier', async () => {
      redisHandles.mock.get.mockResolvedValueOnce(null);
      prisma.principal.findUnique.mockResolvedValueOnce(null);
      redisHandles.rawClient.get.mockResolvedValueOnce('0');

      const result = await service.checkQuota(PRINCIPAL_ID);

      expect(result.planTier).toBe('FREE');
      expect(redisHandles.mock.set).toHaveBeenCalledWith(
        PLAN_KEY,
        { tier: 'FREE' },
        300,
      );
    });

    it('usage cache hit: skips DB count (FREE bypasses gate per F-08; remaining = Infinity)', async () => {
      // ADR-0014 / F-08 architecture: FREE.monthlyVerifyQuota is
      // Number.POSITIVE_INFINITY; UsageGuard short-circuits FREE and
      // delegates the gate to TrialService (lifetime trial cap).
      // The cache hit still happens (consistent observability path),
      // but `remaining` is the unbounded sentinel.
      redisHandles.mock.get.mockResolvedValueOnce({ tier: 'FREE' as PlanTier });
      redisHandles.rawClient.get.mockResolvedValueOnce('42');

      const result = await service.checkQuota(PRINCIPAL_ID);

      expect(redisHandles.rawClient.get).toHaveBeenCalledWith(USAGE_KEY);
      expect(prisma.auditEvent.count).not.toHaveBeenCalled();
      expect(result.remaining).toBe(Number.POSITIVE_INFINITY);
    });

    it('usage cache miss: queries DB and seeds Redis with multi().set().expire().exec()', async () => {
      redisHandles.mock.get.mockResolvedValueOnce({ tier: 'FREE' as PlanTier });
      redisHandles.rawClient.get.mockResolvedValueOnce(null);
      prisma.auditEvent.count.mockResolvedValueOnce(7);

      await service.checkQuota(PRINCIPAL_ID);

      expect(prisma.auditEvent.count).toHaveBeenCalledTimes(1);
      const where = prisma.auditEvent.count.mock.calls[0][0].where;
      expect(where.principalId).toBe(PRINCIPAL_ID);
      expect(where.timestamp.gte).toEqual(new Date(Date.UTC(2026, 4, 1)));

      expect(redisHandles.rawClient.multi).toHaveBeenCalledTimes(1);
      expect(redisHandles.multiChain.set).toHaveBeenCalledWith(USAGE_KEY, '7');
      expect(redisHandles.multiChain.expire).toHaveBeenCalledWith(USAGE_KEY, expect.any(Number));
      expect(redisHandles.multiChain.exec).toHaveBeenCalledTimes(1);
    });

    it('FREE tier never fires PLAN_LIMIT_EXCEEDED — gate delegated to TrialService (F-08)', async () => {
      // ADR-0014 / F-08: the canonical FREE-tier denial is `TRIAL_EXHAUSTED`
      // from `TrialService` at `TRIAL_LIFETIME_CAP`, NOT `PLAN_LIMIT_EXCEEDED`
      // from `UsageGuardService`. UsageGuard always returns allowed=true
      // with remaining=Infinity for FREE so the verify pipeline reaches
      // TrialService to enforce the lifetime cap.
      redisHandles.mock.get.mockResolvedValueOnce({ tier: 'FREE' as PlanTier });
      redisHandles.rawClient.get.mockResolvedValueOnce('999999');

      const result = await service.checkQuota(PRINCIPAL_ID);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.remaining).toBe(Number.POSITIVE_INFINITY);
    });

    it('DEVELOPER tier at quota (overage permitted) returns allowed=true remaining=0', async () => {
      redisHandles.mock.get.mockResolvedValueOnce({ tier: 'DEVELOPER' as PlanTier });
      redisHandles.rawClient.get.mockResolvedValueOnce('50000');

      const result = await service.checkQuota(PRINCIPAL_ID);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
      expect(result.reason).toBeUndefined();
      expect(result.monthlyQuota).toBe(50000);
    });

    it('ENTERPRISE tier returns monthlyQuota=-1 unlimited sentinel', async () => {
      redisHandles.mock.get.mockResolvedValueOnce({ tier: 'ENTERPRISE' as PlanTier });
      redisHandles.rawClient.get.mockResolvedValueOnce('999999');

      const result = await service.checkQuota(PRINCIPAL_ID);

      expect(result.allowed).toBe(true);
      expect(result.monthlyQuota).toBe(-1);
      expect(result.planTier).toBe('ENTERPRISE');
    });

    it('Redis raw().get throws → fail-OPEN (allowed=true, remaining=-1)', async () => {
      redisHandles.mock.get.mockResolvedValueOnce({ tier: 'FREE' as PlanTier });
      redisHandles.rawClient.get.mockRejectedValueOnce(new Error('redis down'));

      const result = await service.checkQuota(PRINCIPAL_ID);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1);
      expect(result.monthlyQuota).toBe(-1);
    });

    it('prisma.auditEvent.count throws → fail-OPEN', async () => {
      redisHandles.mock.get.mockResolvedValueOnce({ tier: 'FREE' as PlanTier });
      redisHandles.rawClient.get.mockResolvedValueOnce(null);
      prisma.auditEvent.count.mockRejectedValueOnce(new Error('db unreachable'));

      const result = await service.checkQuota(PRINCIPAL_ID);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1);
    });

    it('redis.get (plan cache) throws → fail-OPEN', async () => {
      redisHandles.mock.get.mockRejectedValueOnce(new Error('plan cache exploded'));

      const result = await service.checkQuota(PRINCIPAL_ID);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1);
      expect(result.planTier).toBe('FREE');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // incrementUsage
  // ──────────────────────────────────────────────────────────────────────
  describe('incrementUsage', () => {
    it('calls multi().incr().expire().exec() with correct usage key', async () => {
      service.incrementUsage(PRINCIPAL_ID);

      // Allow the fire-and-forget chain to settle.
      await Promise.resolve();
      await Promise.resolve();

      expect(redisHandles.rawClient.multi).toHaveBeenCalledTimes(1);
      expect(redisHandles.multiChain.incr).toHaveBeenCalledWith(USAGE_KEY);
      expect(redisHandles.multiChain.expire).toHaveBeenCalledWith(USAGE_KEY, expect.any(Number));
      expect(redisHandles.multiChain.exec).toHaveBeenCalledTimes(1);
    });

    it('exec rejection is swallowed (fire-and-forget, no throw)', async () => {
      redisHandles.multiChain.exec.mockRejectedValueOnce(new Error('redis exec fail'));

      expect(() => { service.incrementUsage(PRINCIPAL_ID); }).not.toThrow();

      // Drain the catch handler.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // ── Round 21 Lane B: metered overage wiring ────────────────────────
    describe('overage metering (Round 21 Lane B)', () => {
      // Drain enough microtasks for the .then(maybeRecordOverage → resolvePlanTier)
      // chain to settle. Six ticks covers exec→then→resolvePlanTier→recordOverage.
      async function drainTicks() {
        for (let i = 0; i < 8; i++) await Promise.resolve();
      }

      function buildWithStripe(
        post: number,
        cachedTier: PlanTier,
      ): { recordOverage: jest.Mock; svc: UsageGuardService } {
        // Reset mocks and seed the INCR reply tuple shape: [err, value][].
        redisHandles.multiChain.exec.mockReset();
        redisHandles.multiChain.exec.mockResolvedValueOnce([[null, post], [null, 1]]);
        redisHandles.mock.get.mockResolvedValueOnce({ tier: cachedTier });
        const recordOverage = jest.fn().mockResolvedValue(undefined);
        const svc = new UsageGuardService(
          prisma as unknown as PrismaService,
          redisHandles.mock as unknown as RedisService,
          { recordOverage } as unknown as import('./stripe.service').StripeService,
        );
        return { recordOverage, svc };
      }

      it('fires recordOverage non-blocking when DEVELOPER tier exceeds 50_000 quota', async () => {
        const { recordOverage, svc } = buildWithStripe(50_001, 'DEVELOPER');
        svc.incrementUsage(PRINCIPAL_ID);
        await drainTicks();
        expect(recordOverage).toHaveBeenCalledWith(PRINCIPAL_ID, 1);
      });

      it('does NOT fire recordOverage when DEVELOPER is at quota exactly (50_000)', async () => {
        const { recordOverage, svc } = buildWithStripe(50_000, 'DEVELOPER');
        svc.incrementUsage(PRINCIPAL_ID);
        await drainTicks();
        expect(recordOverage).not.toHaveBeenCalled();
      });

      it('does NOT fire recordOverage for FREE tier even past quota (Invariant 2)', async () => {
        const { recordOverage, svc } = buildWithStripe(99_999, 'FREE');
        svc.incrementUsage(PRINCIPAL_ID);
        await drainTicks();
        expect(recordOverage).not.toHaveBeenCalled();
      });

      it('does NOT fire recordOverage for ENTERPRISE (overagePerCallE4 = null)', async () => {
        const { recordOverage, svc } = buildWithStripe(10_000_000, 'ENTERPRISE');
        svc.incrementUsage(PRINCIPAL_ID);
        await drainTicks();
        expect(recordOverage).not.toHaveBeenCalled();
      });

      it('fires recordOverage when GROWTH tier exceeds 500_000 quota', async () => {
        const { recordOverage, svc } = buildWithStripe(500_001, 'GROWTH');
        svc.incrementUsage(PRINCIPAL_ID);
        await drainTicks();
        expect(recordOverage).toHaveBeenCalledWith(PRINCIPAL_ID, 1);
      });

      it('does not throw when StripeService is not injected (legacy 2-arg ctor)', () => {
        // The class-level test setup uses the 2-arg ctor — confirm
        // incrementUsage still no-ops cleanly with no Stripe wiring.
        redisHandles.multiChain.exec.mockResolvedValueOnce([[null, 999_999]]);
        expect(() => { service.incrementUsage(PRINCIPAL_ID); }).not.toThrow();
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getPlanTier
  // ──────────────────────────────────────────────────────────────────────
  describe('getPlanTier', () => {
    it('cache hit returns cached tier without DB call', async () => {
      redisHandles.mock.get.mockResolvedValueOnce({ tier: 'GROWTH' as PlanTier });

      const tier = await service.getPlanTier(PRINCIPAL_ID);

      expect(redisHandles.mock.get).toHaveBeenCalledWith(PLAN_KEY);
      expect(prisma.principal.findUnique).not.toHaveBeenCalled();
      expect(tier).toBe('GROWTH');
    });

    it('cache miss queries DB and seeds cache', async () => {
      redisHandles.mock.get.mockResolvedValueOnce(null);
      prisma.principal.findUnique.mockResolvedValueOnce({ planTier: 'DEVELOPER' as PlanTier });

      const tier = await service.getPlanTier(PRINCIPAL_ID);

      expect(prisma.principal.findUnique).toHaveBeenCalledWith({
        where: { id: PRINCIPAL_ID },
        select: { planTier: true },
      });
      expect(redisHandles.mock.set).toHaveBeenCalledWith(
        PLAN_KEY,
        { tier: 'DEVELOPER' },
        300,
      );
      expect(tier).toBe('DEVELOPER');
    });

    it('Redis failure → fail-open to FREE (rate limiter caps abuse, never blocks)', async () => {
      redisHandles.mock.get.mockRejectedValueOnce(new Error('plan cache exploded'));

      const tier = await service.getPlanTier(PRINCIPAL_ID);

      expect(tier).toBe('FREE');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // invalidatePlanCache
  // ──────────────────────────────────────────────────────────────────────
  describe('invalidatePlanCache', () => {
    it('calls redis.del with the plan key', async () => {
      await service.invalidatePlanCache(PRINCIPAL_ID);
      expect(redisHandles.mock.del).toHaveBeenCalledWith(PLAN_KEY);
    });
  });
});
