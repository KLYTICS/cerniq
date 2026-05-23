import { RedisVerifyCache, type RedisLike } from './redis.js';
import type { CachedVerify } from '../cache.js';
import type { VerifyResult } from '../types.js';

const result: VerifyResult = {
  valid: true,
  agentId: 'agt_1',
  principalId: 'prn_1',
  trustScore: 0.9,
  trustBand: 'VERIFIED',
  scopesGranted: ['commerce'],
  denialReason: null,
  verifiedAt: new Date(0).toISOString(),
  ttl: 30,
};

class FakeRedis implements RedisLike {
  private store = new Map<string, string>();
  public lastSetArgs: unknown[] = [];
  public throwOn: 'none' | 'get' | 'set' | 'del' = 'none';

  async get(key: string): Promise<string | null> {
    if (this.throwOn === 'get') throw new Error('redis down');
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    if (this.throwOn === 'set') throw new Error('redis down');
    this.lastSetArgs = [key, value, ...args];
    this.store.set(key, value);
    return 'OK';
  }
  async del(key: string | string[]): Promise<unknown> {
    if (this.throwOn === 'del') throw new Error('redis down');
    const keys = Array.isArray(key) ? key : [key];
    keys.forEach((k) => this.store.delete(k));
    return keys.length;
  }
}

describe('RedisVerifyCache', () => {
  it('round-trips a CachedVerify entry', async () => {
    let now = 1_000;
    const fake = new FakeRedis();
    const cache = new RedisVerifyCache(fake, { now: () => now });
    const entry: CachedVerify = { result, expiresAt: now + 30_000 };
    await cache.set('abc', entry);
    const hit = await cache.get('abc');
    expect(hit?.result.valid).toBe(true);
    expect(hit?.expiresAt).toBe(now + 30_000);
  });

  it('uses ioredis-style set(key, value, "EX", seconds) signature', async () => {
    const fake = new FakeRedis();
    const cache = new RedisVerifyCache(fake, { now: () => 0 });
    await cache.set('k', { result, expiresAt: 30_000 });
    expect(fake.lastSetArgs[0]).toBe('aegis:verify:k');
    expect(fake.lastSetArgs[2]).toBe('EX');
    expect(fake.lastSetArgs[3]).toBe(30); // 30s
  });

  it('namespaces keys with the configured prefix', async () => {
    const fake = new FakeRedis();
    const cache = new RedisVerifyCache(fake, { keyPrefix: 'rp1:verify:' });
    await cache.set('xyz', { result, expiresAt: Date.now() + 30_000 });
    const raw = await fake.get('rp1:verify:xyz');
    expect(raw).not.toBeNull();
  });

  it('fails soft on Redis get error — returns undefined and fires onError', async () => {
    const fake = new FakeRedis();
    fake.throwOn = 'get';
    const errors: Array<[string, string]> = [];
    const cache = new RedisVerifyCache(fake, {
      onError: (op, _err, key) => errors.push([op, key]),
    });
    const hit = await cache.get('k');
    expect(hit).toBeUndefined();
    expect(errors[0]?.[0]).toBe('get');
  });

  it('fails soft on Redis set error — does not throw', async () => {
    const fake = new FakeRedis();
    fake.throwOn = 'set';
    const errors: string[] = [];
    const cache = new RedisVerifyCache(fake, {
      onError: (op) => errors.push(op),
    });
    // Must not throw — verify result must still be returnable.
    await cache.set('k', { result, expiresAt: Date.now() + 30_000 });
    expect(errors).toContain('set');
  });

  it('returns undefined for malformed payload (defensive decode)', async () => {
    const fake = new FakeRedis();
    await fake.set('aegis:verify:bad', 'not-json{{{', 'EX', 60);
    const errors: string[] = [];
    const cache = new RedisVerifyCache(fake, {
      onError: (op) => errors.push(op),
    });
    const hit = await cache.get('bad');
    expect(hit).toBeUndefined();
    expect(errors).toContain('get');
  });

  it('falls back to setex when set is absent (node-redis v3 style)', async () => {
    const calls: Array<[string, number, string]> = [];
    const fake: RedisLike = {
      async get() {
        return null;
      },
      async setex(key, sec, value) {
        calls.push([key, sec, value]);
        return 'OK';
      },
      async del() {
        return 0;
      },
    };
    const cache = new RedisVerifyCache(fake, { now: () => 0 });
    await cache.set('k', { result, expiresAt: 5_000 });
    expect(calls[0]?.[0]).toBe('aegis:verify:k');
    expect(calls[0]?.[1]).toBe(5);
  });
});
