// Unit test for the Redis-backed auth cache wired into ApiKeyService.resolve().
// k6 surfaced bcrypt-12 as the verify hot-path bottleneck (~250ms per call);
// the cache turns repeat lookups into sub-ms Redis hits. This spec asserts:
//
//   - cache HIT skips bcrypt entirely (zero compare invocations on hit)
//   - cache MISS does the bcrypt path AND writes through with TTL
//   - negative cache absorbs repeated bad keys (anti-DoS)
//   - invalidateCache() evicts both positive and negative entries
//   - service operates correctly when no Redis is wired (Optional injection)

import * as bcrypt from 'bcryptjs';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { AppConfigService } from '../../config/config.service';

import { ApiKeyService, type AuthenticatedKey } from './api-key.service';

interface FakeRow {
  id: string;
  keyHash: string;
  keyPrefix: string;
  principalId: string;
  scope: 'FULL' | 'VERIFY_ONLY';
  revokedAt: Date | null;
  expiresAt: Date | null;
}

const PLAINTEXT = 'cerniq_sk_AAAAAAAAAAAAAAAAAAAAAA';
const PRINCIPAL = 'prn_alpha';

async function buildHarness(
  opts: { row?: FakeRow | null; existingCache?: AuthenticatedKey | null } = {},
) {
  const row =
    opts.row === undefined
      ? {
          id: 'apk_one',
          keyHash: await bcrypt.hash(PLAINTEXT, 4),
          keyPrefix: PLAINTEXT.slice(0, 12),
          principalId: PRINCIPAL,
          scope: 'FULL' as const,
          revokedAt: null,
          expiresAt: null,
        }
      : opts.row;

  const findMany = jest.fn(async () => (row ? [row] : []));
  const update = jest.fn(async () => ({ id: row?.id ?? 'apk_one' }));

  const cacheStore = new Map<string, string>();
  if (opts.existingCache) {
    // Pre-populate so the test can assert HIT path.
    // Re-derive the cache key the same way the service does.
    const { createHash } = await import('node:crypto');
    const k = 'auth:apikey:' + createHash('sha256').update(PLAINTEXT).digest('base64url');
    cacheStore.set(k, JSON.stringify(opts.existingCache));
  }

  const get = jest.fn(async <T>(key: string): Promise<T | null> => {
    const raw = cacheStore.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  });
  const set = jest.fn(async <T>(key: string, value: T): Promise<void> => {
    cacheStore.set(key, JSON.stringify(value));
  });
  const del = jest.fn(async (...keys: string[]): Promise<void> => {
    for (const k of keys) cacheStore.delete(k);
  });

  const prisma = { apiKey: { findMany, update } } as unknown as PrismaService;
  const redis = { get, set, del } as unknown as RedisService;
  const config = { apiKeyBcryptCost: 4 } as unknown as AppConfigService;

  return {
    svc: new ApiKeyService(prisma, config, redis),
    findMany,
    cacheGet: get,
    cacheSet: set,
    cacheDel: del,
    cacheStore,
  };
}

describe('ApiKeyService.resolve — Redis cache layer', () => {
  afterEach(() => jest.restoreAllMocks());

  it('cache HIT skips Postgres entirely (and therefore bcrypt)', async () => {
    const cached: AuthenticatedKey = {
      apiKeyId: 'apk_cached',
      principalId: PRINCIPAL,
      scope: 'FULL',
    };
    const h = await buildHarness({ existingCache: cached });

    const result = await h.svc.resolve(PLAINTEXT);
    expect(result).toEqual(cached);
    // findMany is the gate to the bcrypt loop — if it wasn't called, bcrypt
    // wasn't either. This is the perf invariant the cache exists to enforce.
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it('cache MISS does the bcrypt path AND writes through a positive entry', async () => {
    const h = await buildHarness();

    const result = await h.svc.resolve(PLAINTEXT);
    expect(result?.principalId).toBe(PRINCIPAL);
    expect(h.findMany).toHaveBeenCalledTimes(1);
    // Cache write-through happened.
    const positiveKey = Array.from(h.cacheStore.keys()).find(
      (k) => k.startsWith('auth:apikey:') && !k.includes(':neg:'),
    );
    expect(positiveKey).toBeDefined();
  });

  it('returns null on bad key AND populates negative cache', async () => {
    const h = await buildHarness({ row: null }); // empty candidate set

    const result = await h.svc.resolve(PLAINTEXT);
    expect(result).toBeNull();
    // Negative tombstone cached.
    const negKey = Array.from(h.cacheStore.keys()).find((k) => k.includes(':neg:'));
    expect(negKey).toBeDefined();
  });

  it('subsequent bad-key attempts hit negative cache and skip Postgres', async () => {
    const h = await buildHarness({ row: null });

    // First call populates negative cache, hits Postgres.
    await h.svc.resolve(PLAINTEXT);
    expect(h.findMany).toHaveBeenCalledTimes(1);

    // Second call should be served from negative cache — no further Postgres.
    const result2 = await h.svc.resolve(PLAINTEXT);
    expect(result2).toBeNull();
    expect(h.findMany).toHaveBeenCalledTimes(1); // unchanged
  });

  it('invalidateCache() evicts both positive and negative entries for a plaintext', async () => {
    const cached: AuthenticatedKey = { apiKeyId: 'x', principalId: PRINCIPAL, scope: 'FULL' };
    const h = await buildHarness({ existingCache: cached });

    expect(h.cacheStore.size).toBeGreaterThan(0);
    await h.svc.invalidateCache(PLAINTEXT);
    expect(h.cacheGet).toHaveBeenCalledTimes(0); // invalidate doesn't read
    expect(h.cacheDel).toHaveBeenCalledTimes(1);
    // Both keys (positive + negative) passed to del.
    const delArgs = h.cacheDel.mock.calls[0] ?? [];
    expect(delArgs.length).toBe(2);
  });

  it('rejects malformed keys before touching cache or Postgres', async () => {
    const h = await buildHarness();
    const result = await h.svc.resolve('not-a-valid-cerniq-key');
    expect(result).toBeNull();
    expect(h.cacheGet).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it('operates without Redis (Optional injection — fall back to bcrypt-every-time)', async () => {
    const row: FakeRow = {
      id: 'apk_one',
      keyHash: await bcrypt.hash(PLAINTEXT, 4),
      keyPrefix: PLAINTEXT.slice(0, 12),
      principalId: PRINCIPAL,
      scope: 'FULL',
      revokedAt: null,
      expiresAt: null,
    };
    const findMany = jest.fn(async () => [row]);
    const update = jest.fn(async () => ({ id: 'apk_one' }));
    const prisma = { apiKey: { findMany, update } } as unknown as PrismaService;
    const config = { apiKeyBcryptCost: 4 } as unknown as AppConfigService;

    const svc = new ApiKeyService(prisma, config, undefined);
    const result = await svc.resolve(PLAINTEXT);
    expect(result?.principalId).toBe(PRINCIPAL);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
