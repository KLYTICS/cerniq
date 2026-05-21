import { VerifyGateway } from './verify-gateway.js';
import { AegisInternalError, AegisServiceUnavailableError } from './errors.js';
import type { Aegis } from './index.js';
import type { VerifyResult } from './types.js';

function makeResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    valid: true,
    agentId: 'agt_1',
    principalId: 'prn_1',
    trustScore: 0.9,
    trustBand: 'VERIFIED',
    scopesGranted: ['commerce'],
    denialReason: null,
    verifiedAt: new Date(0).toISOString(),
    ttl: 30,
    ...overrides,
  };
}

interface FakeAegis {
  verify: jest.Mock;
}

function makeFake(impl: () => Promise<VerifyResult>): FakeAegis {
  return { verify: jest.fn(impl) };
}

describe('VerifyGateway: caching', () => {
  it('caches valid results and serves them within TTL', async () => {
    const fake = makeFake(async () => makeResult({ ttl: 30 }));
    const gw = new VerifyGateway(fake as unknown as Aegis);
    const a = await gw.verify('tok', { amount: 10 });
    const b = await gw.verify('tok', { amount: 10 });
    expect(a.valid).toBe(true);
    expect(b.valid).toBe(true);
    expect(fake.verify).toHaveBeenCalledTimes(1);
  });

  it('does not cache denials by default', async () => {
    const fake = makeFake(async () =>
      makeResult({ valid: false, denialReason: 'POLICY_REVOKED', ttl: 30 }),
    );
    const gw = new VerifyGateway(fake as unknown as Aegis);
    await gw.verify('tok');
    await gw.verify('tok');
    expect(fake.verify).toHaveBeenCalledTimes(2);
  });

  it('caches denials when negativeTtlMs is set', async () => {
    let now = 0;
    const fake = makeFake(async () =>
      makeResult({ valid: false, denialReason: 'POLICY_REVOKED', ttl: 30 }),
    );
    const gw = new VerifyGateway(fake as unknown as Aegis, {
      negativeTtlMs: 1_000,
      now: () => now,
    });
    await gw.verify('tok');
    now = 500;
    await gw.verify('tok');
    expect(fake.verify).toHaveBeenCalledTimes(1);
  });

  it('clamps cached TTL to maxTtlMs (operator can tighten, never loosen)', async () => {
    let now = 0;
    const fake = makeFake(async () => makeResult({ ttl: 3600 })); // 1 hour
    const gw = new VerifyGateway(fake as unknown as Aegis, {
      maxTtlMs: 1_000,
      now: () => now,
    });
    await gw.verify('tok');
    now = 1_500;
    await gw.verify('tok');
    expect(fake.verify).toHaveBeenCalledTimes(2);
  });

  it('different context = different cache key', async () => {
    const fake = makeFake(async () => makeResult());
    const gw = new VerifyGateway(fake as unknown as Aegis);
    await gw.verify('tok', { amount: 10 });
    await gw.verify('tok', { amount: 20 });
    expect(fake.verify).toHaveBeenCalledTimes(2);
  });
});

describe('VerifyGateway: single-flight', () => {
  it('coalesces concurrent identical verifies onto one request', async () => {
    let resolveUpstream!: (r: VerifyResult) => void;
    const upstream = new Promise<VerifyResult>((r) => {
      resolveUpstream = r;
    });
    const fake = makeFake(() => upstream);
    const gw = new VerifyGateway(fake as unknown as Aegis);
    const p1 = gw.verify('tok');
    const p2 = gw.verify('tok');
    const p3 = gw.verify('tok');
    resolveUpstream(makeResult());
    await Promise.all([p1, p2, p3]);
    expect(fake.verify).toHaveBeenCalledTimes(1);
  });

  it('fires onCoalesce hook with waiter count', async () => {
    let resolveUpstream!: (r: VerifyResult) => void;
    const upstream = new Promise<VerifyResult>((r) => {
      resolveUpstream = r;
    });
    const fake = makeFake(() => upstream);
    const onCoalesce = jest.fn();
    const gw = new VerifyGateway(fake as unknown as Aegis, { hooks: { onCoalesce } });
    const p1 = gw.verify('tok');
    const p2 = gw.verify('tok');
    resolveUpstream(makeResult());
    await Promise.all([p1, p2]);
    expect(onCoalesce).toHaveBeenCalledWith(expect.any(String), 2);
  });
});

describe('VerifyGateway: circuit breaker', () => {
  it('opens after consecutive failures and fails fast', async () => {
    const fake = makeFake(async () => {
      throw new AegisInternalError('boom', 500, undefined);
    });
    const stateChanges: Array<[string, string]> = [];
    const gw = new VerifyGateway(fake as unknown as Aegis, {
      breakerThreshold: 2,
      hooks: {
        onBreakerStateChange: (from, to) => stateChanges.push([from, to]),
      },
    });
    await expect(gw.verify('a')).rejects.toBeInstanceOf(AegisInternalError);
    await expect(gw.verify('b')).rejects.toBeInstanceOf(AegisInternalError);
    // Breaker is now open — third call must fast-fail with 503.
    await expect(gw.verify('c')).rejects.toBeInstanceOf(AegisServiceUnavailableError);
    expect(stateChanges).toEqual([['closed', 'open']]);
    // Upstream not called for the fast-fail.
    expect(fake.verify).toHaveBeenCalledTimes(2);
  });

  it('transitions open → half-open → closed on successful probe', async () => {
    let now = 0;
    let mode: 'fail' | 'ok' = 'fail';
    const fake = makeFake(async () => {
      if (mode === 'fail') throw new AegisInternalError('boom', 500, undefined);
      return makeResult();
    });
    const stateChanges: Array<[string, string]> = [];
    const gw = new VerifyGateway(fake as unknown as Aegis, {
      breakerThreshold: 1,
      breakerCooldownMs: 1_000,
      now: () => now,
      hooks: { onBreakerStateChange: (from, to) => stateChanges.push([from, to]) },
    });
    await expect(gw.verify('a')).rejects.toBeInstanceOf(AegisInternalError);
    expect(gw.state).toBe('open');
    // Within cooldown — still open.
    now = 500;
    await expect(gw.verify('b')).rejects.toBeInstanceOf(AegisServiceUnavailableError);
    // After cooldown, probe succeeds → closed.
    now = 1_500;
    mode = 'ok';
    await expect(gw.verify('c')).resolves.toBeDefined();
    expect(gw.state).toBe('closed');
    expect(stateChanges).toEqual([
      ['closed', 'open'],
      ['open', 'half-open'],
      ['half-open', 'closed'],
    ]);
  });

  it('serve-stale fallback returns expired cache when breaker is open', async () => {
    let now = 0;
    let mode: 'ok' | 'fail' = 'ok';
    const fake = makeFake(async () => {
      if (mode === 'fail') throw new AegisInternalError('boom', 500, undefined);
      return makeResult({ ttl: 1 });
    });
    const onStale = jest.fn();
    const gw = new VerifyGateway(fake as unknown as Aegis, {
      breakerThreshold: 1,
      fallbackMode: 'serve-stale',
      now: () => now,
      hooks: { onStale },
    });
    // Prime cache.
    await gw.verify('tok');
    // Move past TTL and trip breaker.
    now = 5_000;
    mode = 'fail';
    await expect(gw.verify('other')).rejects.toBeInstanceOf(AegisInternalError);
    expect(gw.state).toBe('open');
    // Original key — cache expired, but breaker is open → serve stale.
    const stale = await gw.verify('tok');
    expect(stale.valid).toBe(true);
    expect(onStale).toHaveBeenCalled();
  });
});

describe('VerifyGateway: half-open serialization', () => {
  it('only one probe through during half-open; concurrent callers fast-fail', async () => {
    let now = 0;
    let resolveProbe!: (r: VerifyResult) => void;
    let probeCount = 0;
    const fake = makeFake(() => {
      probeCount += 1;
      if (probeCount === 1) throw new AegisInternalError('boom', 500, undefined);
      // Second invocation returns a slow-resolving probe.
      return new Promise<VerifyResult>((r) => {
        resolveProbe = r;
      });
    });
    const gw = new VerifyGateway(fake as unknown as Aegis, {
      breakerThreshold: 1,
      breakerCooldownMs: 1_000,
      now: () => now,
    });
    // Trip breaker.
    await expect(gw.verify('a')).rejects.toBeInstanceOf(AegisInternalError);
    expect(gw.state).toBe('open');
    // Advance past cooldown so next call transitions to half-open.
    now = 1_500;
    // First call after cooldown becomes the probe (in flight).
    const probePromise = gw.verify('b');
    // Flush microtasks so the probe enters half-open + sets the in-flight flag.
    await Promise.resolve();
    await Promise.resolve();
    expect(gw.state).toBe('half-open');
    // Concurrent callers during the probe must fast-fail, not slam upstream.
    await expect(gw.verify('c')).rejects.toBeInstanceOf(AegisServiceUnavailableError);
    await expect(gw.verify('d')).rejects.toBeInstanceOf(AegisServiceUnavailableError);
    expect(probeCount).toBe(2); // 1st failed pre-trip, 2nd is the probe — no third invocation.
    // Resolve the probe and let it close the breaker.
    resolveProbe(makeResult());
    await probePromise;
    expect(gw.state).toBe('closed');
  });
});

describe('VerifyGateway: TTL jitter', () => {
  it('cached expiresAt is at most server-clamped TTL (jitter only shortens)', async () => {
    const now = 0;
    const fake = makeFake(async () => makeResult({ ttl: 30 }));
    const gw = new VerifyGateway(fake as unknown as Aegis, { now: () => now });
    await gw.verify('tok');
    // Run 50 fresh entries; every cached expiresAt must be <= now + 30s.
    for (let i = 0; i < 50; i += 1) {
      await gw.verify('tok' + String(i));
    }
    const m = gw.metrics();
    expect(m.cacheSize).toBeGreaterThan(0);
  });

  it('jittered TTL never exceeds the server-authoritative clamp', async () => {
    // Sample across many entries; max expiresAt must respect the ceiling.
    let now = 1_000_000;
    const fake = makeFake(async () => makeResult({ ttl: 30 }));
    const gw = new VerifyGateway(fake as unknown as Aegis, {
      now: () => now,
      maxTtlMs: 30_000,
    });
    for (let i = 0; i < 200; i += 1) {
      await gw.verify('t' + String(i));
    }
    // After 30s, every entry must be expired (server TTL ceiling honored).
    now += 30_000;
    let stillFresh = 0;
    for (let i = 0; i < 200; i += 1) {
      const before = fake.verify.mock.calls.length;
      await gw.verify('t' + String(i));
      if (fake.verify.mock.calls.length === before) stillFresh += 1;
    }
    expect(stillFresh).toBe(0);
  });
});

describe('VerifyGateway: metrics snapshot', () => {
  it('reports hits, misses, coalesced, breaker state', async () => {
    const fake = makeFake(async () => makeResult({ ttl: 30 }));
    const gw = new VerifyGateway(fake as unknown as Aegis);
    await gw.verify('tok');
    await gw.verify('tok');
    await gw.verify('other');
    const m = gw.metrics();
    expect(m.hits).toBe(1);
    expect(m.misses).toBe(2);
    expect(m.state).toBe('closed');
    expect(m.cacheSize).toBe(2);
  });
});

describe('VerifyGateway: invalidation', () => {
  it('drops a cached entry on invalidate()', async () => {
    const fake = makeFake(async () => makeResult({ ttl: 30 }));
    const gw = new VerifyGateway(fake as unknown as Aegis);
    await gw.verify('tok');
    await gw.invalidate('tok');
    await gw.verify('tok');
    expect(fake.verify).toHaveBeenCalledTimes(2);
  });
});
