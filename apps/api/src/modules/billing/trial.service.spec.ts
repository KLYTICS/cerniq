// Unit tests for TrialService (ADR-0014).
// CLAUDE.md: every public service method has a unit test —
//   - checkAndIncrement
//   - getStatus
//   - reset

import type { PlanTier } from '@prisma/client';

import type { MetricsService } from '../../common/observability/metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';

import { TRIAL_LIFETIME_CAP } from './plans';
import { TrialService } from './trial.service';

interface MockPrisma {
  principal: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
}

interface RawClient {
  incr: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
  set: jest.Mock;
}

interface MockRedis {
  raw: jest.Mock;
}

interface MockMetrics {
  trialUsageIncrementedTotal: { inc: jest.Mock };
  trialExhaustedTotal: { inc: jest.Mock };
}

function buildHarness() {
  const rawClient: RawClient = {
    incr: jest.fn(),
    get: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue('OK'),
  };
  const redis: MockRedis = { raw: jest.fn().mockReturnValue(rawClient) };
  const prisma: MockPrisma = {
    principal: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const metrics: MockMetrics = {
    trialUsageIncrementedTotal: { inc: jest.fn() },
    trialExhaustedTotal: { inc: jest.fn() },
  };
  const service = new TrialService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    metrics as unknown as MetricsService,
  );
  return { service, prisma, redis, rawClient, metrics };
}

const PRINCIPAL_ID = 'prin_trial_test';

describe('TrialService.checkAndIncrement', () => {
  it('happy path increments counter and returns remaining', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'FREE' as PlanTier,
      trialExhaustedAt: null,
    });
    h.rawClient.incr.mockResolvedValue(1);

    const result = await h.service.checkAndIncrement(PRINCIPAL_ID);

    expect(result).toEqual({ exhausted: false, remaining: TRIAL_LIFETIME_CAP - 1 });
    expect(h.rawClient.incr).toHaveBeenCalledWith(`trial:used:${PRINCIPAL_ID}`);
    expect(h.metrics.trialUsageIncrementedTotal.inc).toHaveBeenCalledTimes(1);
  });

  it('non-FREE tier short-circuits without DB write or Redis hit', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'DEVELOPER' as PlanTier,
      trialExhaustedAt: null,
    });

    const result = await h.service.checkAndIncrement(PRINCIPAL_ID);

    expect(result).toEqual({ exhausted: false, remaining: -1 });
    expect(h.rawClient.incr).not.toHaveBeenCalled();
    expect(h.prisma.principal.update).not.toHaveBeenCalled();
  });

  it('already-flagged trial principal returns exhausted without INCR', async () => {
    const h = buildHarness();
    const exhaustedAt = new Date('2026-04-01T00:00:00Z');
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'FREE' as PlanTier,
      trialExhaustedAt: exhaustedAt,
    });

    const result = await h.service.checkAndIncrement(PRINCIPAL_ID);

    expect(result).toEqual({ exhausted: true, exhaustedAt, reason: 'CAP_REACHED' });
    expect(h.rawClient.incr).not.toHaveBeenCalled();
  });

  it('last allowed call (cap-th) succeeds; cap+1 triggers exhausted + DB persist', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'FREE' as PlanTier,
      trialExhaustedAt: null,
    });
    h.rawClient.incr.mockResolvedValueOnce(TRIAL_LIFETIME_CAP); // exactly at cap
    const ok = await h.service.checkAndIncrement(PRINCIPAL_ID);
    expect(ok).toEqual({ exhausted: false, remaining: 0 });

    h.rawClient.incr.mockResolvedValueOnce(TRIAL_LIFETIME_CAP + 1); // over
    const denied = await h.service.checkAndIncrement(PRINCIPAL_ID);
    expect(denied.exhausted).toBe(true);
    if (denied.exhausted) expect(denied.reason).toBe('CAP_REACHED');
    expect(h.prisma.principal.update).toHaveBeenCalledWith({
      where: { id: PRINCIPAL_ID },
      data: expect.objectContaining({ trialUsedCount: TRIAL_LIFETIME_CAP + 1 }),
    });
    expect(h.metrics.trialExhaustedTotal.inc).toHaveBeenCalledTimes(1);
  });

  it('Redis INCR failure fails CLOSED with reason=REDIS_UNAVAILABLE and metric increment', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'FREE' as PlanTier,
      trialExhaustedAt: null,
    });
    h.rawClient.incr.mockRejectedValue(new Error('connection reset'));

    const result = await h.service.checkAndIncrement(PRINCIPAL_ID);

    expect(result.exhausted).toBe(true);
    if (result.exhausted) expect(result.reason).toBe('REDIS_UNAVAILABLE');
    expect(h.metrics.trialExhaustedTotal.inc).toHaveBeenCalledTimes(1);
  });

  it('missing principal fails CLOSED', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue(null);

    const result = await h.service.checkAndIncrement(PRINCIPAL_ID);

    expect(result.exhausted).toBe(true);
    expect(h.rawClient.incr).not.toHaveBeenCalled();
  });

  it('every 100th increment flushes to DB (best-effort)', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'FREE' as PlanTier,
      trialExhaustedAt: null,
    });

    h.rawClient.incr.mockResolvedValueOnce(99);
    await h.service.checkAndIncrement(PRINCIPAL_ID);
    expect(h.prisma.principal.update).not.toHaveBeenCalled();

    h.rawClient.incr.mockResolvedValueOnce(100);
    await h.service.checkAndIncrement(PRINCIPAL_ID);
    // Allow the fire-and-forget update to settle.
    await new Promise((r) => setImmediate(r));
    expect(h.prisma.principal.update).toHaveBeenCalledWith({
      where: { id: PRINCIPAL_ID },
      data: { trialUsedCount: 100 },
    });
  });

  it('concurrent increments do not double-count (Redis INCR is atomic)', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'FREE' as PlanTier,
      trialExhaustedAt: null,
    });
    let counter = 0;
    h.rawClient.incr.mockImplementation(async () => ++counter);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => h.service.checkAndIncrement(PRINCIPAL_ID)),
    );
    const remainings = results.map((r) => (r.exhausted ? -1 : r.remaining));
    // Each call sees a unique remaining → no two share the same INCR result.
    expect(new Set(remainings).size).toBe(5);
  });
});

describe('TrialService.getStatus', () => {
  it('never-used FREE principal reports 0 used / cap remaining', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'FREE' as PlanTier,
      trialUsedCount: 0,
      trialExhaustedAt: null,
    });
    h.rawClient.get.mockResolvedValue(null);

    const status = await h.service.getStatus(PRINCIPAL_ID);

    expect(status).toEqual({
      planTier: 'FREE',
      used: 0,
      cap: TRIAL_LIFETIME_CAP,
      remaining: TRIAL_LIFETIME_CAP,
      exhausted: false,
      exhaustedAt: null,
    });
  });

  it('mid-use prefers Redis live count over DB mirror', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'FREE' as PlanTier,
      trialUsedCount: 100, // last DB flush
      trialExhaustedAt: null,
    });
    h.rawClient.get.mockResolvedValue('157'); // live counter

    const status = await h.service.getStatus(PRINCIPAL_ID);
    expect(status).not.toBeNull();
    expect(status!.used).toBe(157);
    expect(status!.remaining).toBe(TRIAL_LIFETIME_CAP - 157);
  });

  it('exhausted principal reports exhausted=true', async () => {
    const h = buildHarness();
    const exhaustedAt = new Date('2026-04-30T00:00:00Z');
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'FREE' as PlanTier,
      trialUsedCount: TRIAL_LIFETIME_CAP,
      trialExhaustedAt: exhaustedAt,
    });
    h.rawClient.get.mockResolvedValue(String(TRIAL_LIFETIME_CAP + 1));

    const status = await h.service.getStatus(PRINCIPAL_ID);
    expect(status).not.toBeNull();
    expect(status!.exhausted).toBe(true);
    expect(status!.exhaustedAt).toEqual(exhaustedAt);
  });

  it('non-FREE tier reports cap=-1 / remaining=-1', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue({
      planTier: 'GROWTH' as PlanTier,
      trialUsedCount: 0,
      trialExhaustedAt: null,
    });

    const status = await h.service.getStatus(PRINCIPAL_ID);
    expect(status).not.toBeNull();
    expect(status!.cap).toBe(-1);
    expect(status!.remaining).toBe(-1);
    expect(status!.exhausted).toBe(false);
  });

  // Round-19: peer review F-04 — `getStatus` must return null on
  // principal-not-found instead of -1 sentinels.
  it('returns null when principal does not exist', async () => {
    const h = buildHarness();
    h.prisma.principal.findUnique.mockResolvedValue(null);

    const status = await h.service.getStatus(PRINCIPAL_ID);
    expect(status).toBeNull();
  });
});

describe('TrialService.reset', () => {
  it('SETs Redis key to 0 (idempotent), nulls DB columns, logs event', async () => {
    const h = buildHarness();

    await h.service.reset(PRINCIPAL_ID);

    // Round-19: peer review F-02 — use SET 0 (idempotent) not DEL.
    // DEL leaves a stale counter on failure; SET 0 lands in known state.
    expect(h.rawClient.set).toHaveBeenCalledWith(`trial:used:${PRINCIPAL_ID}`, '0');
    expect(h.prisma.principal.update).toHaveBeenCalledWith({
      where: { id: PRINCIPAL_ID },
      data: { trialUsedCount: 0, trialExhaustedAt: null },
    });
  });

  // Round-19: peer review F-02 — when Redis SET throws, the error must
  // surface so the Stripe webhook handler retries. Otherwise the customer
  // pays $49 and then receives HTTP 402 on the next verify because Redis
  // still holds the stale lifetime counter.
  it('throws when Redis SET fails (Stripe webhook will retry)', async () => {
    const h = buildHarness();
    h.rawClient.set.mockRejectedValueOnce(new Error('redis down'));

    await expect(h.service.reset(PRINCIPAL_ID)).rejects.toThrow('redis down');
    // DB update must NOT have run on the throw path — partial state would be
    // worse than nothing (would leave Postgres saying "trial is reset" while
    // Redis still says "exhausted").
    expect(h.prisma.principal.update).not.toHaveBeenCalled();
  });
});
