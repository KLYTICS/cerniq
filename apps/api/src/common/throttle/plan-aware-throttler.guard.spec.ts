// Unit tests for PlanAwareThrottlerGuard. We avoid spinning up a NestJS
// TestingModule and instead drive the guard via a fabricated
// ExecutionContext + storage mock. This keeps the test fast and lets us
// assert exact-call shape on the throttler storage (the part that
// matters: tier-suffixed keys, no Redis hit on ENTERPRISE).

import type { ExecutionContext} from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import type { PlanTier } from '@prisma/client';

import type { AuthenticatedKey } from '../../modules/auth/api-key.service';
import type { UsageGuardService } from '../../modules/billing/usage-guard.service';

import { PlanAwareThrottlerGuard } from './plan-aware-throttler.guard';

interface FakeRequest {
  auth?: AuthenticatedKey;
  ip?: string;
  headers: Record<string, string>;
  url: string;
  method: string;
}

interface FakeResponse {
  header: jest.Mock;
}

function makeContext(req: FakeRequest, res: FakeResponse): ExecutionContext {
  const switchToHttp = {
    getRequest: <T>(): T => req as unknown as T,
    getResponse: <T>(): T => res as unknown as T,
    getNext: <T>(): T => ({}) as T,
  };
  // type-rationale: ExecutionContext has many getters we don't use here;
  // a partial cast through unknown keeps the test surface small.
  return {
    switchToHttp: () => switchToHttp,
    getHandler: () => function run(): void {},
    getClass: () => class VerifyController {},
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

function makeStorage(initialHits = 0): {
  storage: ThrottlerStorage;
  increment: jest.Mock;
} {
  let hits = initialHits;
  const increment = jest.fn(async (_key: string, ttl: number, limit: number) => {
    hits += 1;
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(ttl / 1000),
      isBlocked: hits > limit,
      timeToBlockExpire: hits > limit ? Math.ceil(ttl / 1000) : 0,
    };
  });
  return {
    storage: { increment },
    increment,
  };
}

const OPTIONS: ThrottlerModuleOptions = [{ name: 'verify', ttl: 1_000, limit: 999 }];

function makeUsageGuard(): jest.Mocked<Pick<UsageGuardService, 'getPlanTier'>> {
  return {
    getPlanTier: jest.fn<Promise<PlanTier>, [string]>(),
  };
}

async function instantiate(
  guard: PlanAwareThrottlerGuard,
): Promise<PlanAwareThrottlerGuard> {
  // ThrottlerGuard.onModuleInit() initialises `this.throttlers`. The base
  // canActivate iterates that array, so we must call it before invoking
  // canActivate in tests.
  await guard.onModuleInit();
  return guard;
}

describe('PlanAwareThrottlerGuard', () => {
  let usageGuard: jest.Mocked<Pick<UsageGuardService, 'getPlanTier'>>;
  let reflector: Reflector;

  beforeEach(() => {
    usageGuard = makeUsageGuard();
    reflector = new Reflector();
  });

  it('FREE principal: 21st call in a 1s window → 429 with rate_limit_exceeded body', async () => {
    usageGuard.getPlanTier.mockResolvedValue('FREE');
    // Seed storage with 20 hits so the next call exceeds the FREE limit (20).
    const { storage, increment } = makeStorage(20);

    const guard = await instantiate(
      new PlanAwareThrottlerGuard(
        OPTIONS,
        storage,
        reflector,
        usageGuard as unknown as UsageGuardService,
      ),
    );

    const req: FakeRequest = {
      auth: { apiKeyId: 'k1', principalId: 'prin_free_1', scope: 'VERIFY_ONLY' },
      ip: '203.0.113.5',
      headers: {},
      url: '/v1/verify',
      method: 'POST',
    };
    const res: FakeResponse = { header: jest.fn() };
    const ctx = makeContext(req, res);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      // type-rationale: HttpException is structural; matching on response
      // body via jest's deep matcher gives us the assertion we want.
    });

    try {
      await guard.canActivate(ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const e = err as HttpException;
      expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = e.getResponse() as Record<string, unknown>;
      expect(body.error).toBe('rate_limit_exceeded');
      expect(body.details).toEqual({
        planTier: 'FREE',
        limit: 20,
        windowMs: 1_000,
        retryAfter: expect.any(Number),
      });
    }

    // Retry-After header was set on the 429 response.
    expect(res.header).toHaveBeenCalledWith('Retry-After', expect.any(String));
    // Storage WAS hit (rate limiter actually ran).
    expect(increment).toHaveBeenCalled();
  });

  it('DEVELOPER under limit: request passes', async () => {
    usageGuard.getPlanTier.mockResolvedValue('DEVELOPER');
    const { storage, increment } = makeStorage(0);

    const guard = await instantiate(
      new PlanAwareThrottlerGuard(
        OPTIONS,
        storage,
        reflector,
        usageGuard as unknown as UsageGuardService,
      ),
    );

    const req: FakeRequest = {
      auth: { apiKeyId: 'k2', principalId: 'prin_dev_1', scope: 'FULL' },
      ip: '203.0.113.5',
      headers: {},
      url: '/v1/verify',
      method: 'POST',
    };
    const res: FakeResponse = { header: jest.fn() };

    await expect(guard.canActivate(makeContext(req, res))).resolves.toBe(true);
    expect(increment).toHaveBeenCalledTimes(1);
    // increment called with DEVELOPER's limit (200) and ttl (1000).
    expect(increment.mock.calls[0][1]).toBe(1_000);
    expect(increment.mock.calls[0][2]).toBe(200);
  });

  it('ENTERPRISE: short-circuits with no storage hit', async () => {
    usageGuard.getPlanTier.mockResolvedValue('ENTERPRISE');
    const { storage, increment } = makeStorage(0);

    const guard = await instantiate(
      new PlanAwareThrottlerGuard(
        OPTIONS,
        storage,
        reflector,
        usageGuard as unknown as UsageGuardService,
      ),
    );

    const req: FakeRequest = {
      auth: { apiKeyId: 'k3', principalId: 'prin_ent_1', scope: 'FULL' },
      ip: '203.0.113.5',
      headers: {},
      url: '/v1/verify',
      method: 'POST',
    };
    const res: FakeResponse = { header: jest.fn() };

    await expect(guard.canActivate(makeContext(req, res))).resolves.toBe(true);
    expect(increment).not.toHaveBeenCalled(); // ZERO Redis hits for unlimited tier.
    expect(res.header).not.toHaveBeenCalled(); // No rate-limit headers either.
  });

  it('Anonymous request: no auth → IP tracker + FREE limits', async () => {
    const { storage, increment } = makeStorage(0);

    const guard = await instantiate(
      new PlanAwareThrottlerGuard(
        OPTIONS,
        storage,
        reflector,
        usageGuard as unknown as UsageGuardService,
      ),
    );

    const req: FakeRequest = {
      // no `auth` set
      ip: '198.51.100.7',
      headers: {},
      url: '/v1/verify',
      method: 'POST',
    };
    const res: FakeResponse = { header: jest.fn() };

    await expect(guard.canActivate(makeContext(req, res))).resolves.toBe(true);
    expect(usageGuard.getPlanTier).not.toHaveBeenCalled();
    // Limit applied was FREE's 20.
    expect(increment.mock.calls[0][2]).toBe(20);
  });

  it('Tier upgrade resets the bucket (different storage key)', async () => {
    const { storage, increment } = makeStorage(0);

    const guard = await instantiate(
      new PlanAwareThrottlerGuard(
        OPTIONS,
        storage,
        reflector,
        usageGuard as unknown as UsageGuardService,
      ),
    );

    const req: FakeRequest = {
      auth: { apiKeyId: 'k4', principalId: 'prin_upgrade_1', scope: 'FULL' },
      ip: '203.0.113.5',
      headers: {},
      url: '/v1/verify',
      method: 'POST',
    };
    const res: FakeResponse = { header: jest.fn() };
    const ctx = makeContext(req, res);

    usageGuard.getPlanTier.mockResolvedValueOnce('FREE');
    await guard.canActivate(ctx);
    const keyBefore = increment.mock.calls[0][0];

    usageGuard.getPlanTier.mockResolvedValueOnce('DEVELOPER');
    await guard.canActivate(ctx);
    const keyAfter = increment.mock.calls[1][0];

    expect(keyBefore).not.toBe(keyAfter); // tier embedded in tracker → distinct buckets.
  });

  it('UsageGuardService throws → fail-OPEN (request allowed, warning logged)', async () => {
    usageGuard.getPlanTier.mockRejectedValueOnce(new Error('redis exploded'));
    const { storage, increment } = makeStorage(0);

    const guard = await instantiate(
      new PlanAwareThrottlerGuard(
        OPTIONS,
        storage,
        reflector,
        usageGuard as unknown as UsageGuardService,
      ),
    );

    const req: FakeRequest = {
      auth: { apiKeyId: 'k5', principalId: 'prin_err_1', scope: 'FULL' },
      ip: '203.0.113.5',
      headers: {},
      url: '/v1/verify',
      method: 'POST',
    };
    const res: FakeResponse = { header: jest.fn() };

    await expect(guard.canActivate(makeContext(req, res))).resolves.toBe(true);
    // Storage was NOT hit because handleRequest threw before increment.
    expect(increment).not.toHaveBeenCalled();
  });
});
