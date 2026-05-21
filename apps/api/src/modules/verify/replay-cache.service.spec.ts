/**
 * ReplayCacheService — unit tests
 *
 * CRIT-1 fix: the replay cache is the sole guard preventing token reuse.
 * Coverage:
 *   - consume() returns true on first sighting (Redis NX sets OK)
 *   - consume() returns false on replay (Redis NX returns null)
 *   - TTL is capped to HARD_CEILING_SECONDS (90s) regardless of input
 *   - TTL is floored to 1
 *   - Invalid jti (too short, too long) → false (fail closed, no Redis call)
 *   - Redis failure → ServiceUnavailableError (fail closed — CLAUDE.md §4)
 *   - SET key pattern is `verify:jti:<jti>`
 */

import { ServiceUnavailableError } from '../../common/errors';
import type { RedisService } from '../../common/redis/redis.service';

import { ReplayCacheService } from './replay-cache.service';

// ── Redis stub ────────────────────────────────────────────────────────────────

/** Simulates the raw client's SET … NX EX semantics. */
function makeRedis(responses: ('OK' | null)[] = []) {
  const seen = new Set<string>();
  let callCount = 0;
  const set = jest.fn(async (_key: string, _val: string, _mode: string, _ttl: number, _nx: string) => {
    if (responses.length > 0) return responses[callCount++ % responses.length] ?? null;
    // Default: first call per key → OK, subsequent → null
    if (seen.has(_key)) return null;
    seen.add(_key);
    return 'OK';
  });

  const redis = {
    raw: jest.fn(() => ({ set })),
  };
  return { redis: redis as unknown as RedisService, set };
}

function makeService(redis: RedisService) {
  return new ReplayCacheService(redis);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReplayCacheService', () => {
  describe('consume()', () => {
    it('returns true on first sighting (Redis NX → OK)', async () => {
      const { redis } = makeRedis(['OK']);
      const svc = makeService(redis);
      expect(await svc.consume('jti_first_sight_abc123', 30)).toBe(true);
    });

    it('returns false on replay (Redis NX → null)', async () => {
      const { redis } = makeRedis([null]);
      const svc = makeService(redis);
      expect(await svc.consume('jti_replayed_abc123456', 30)).toBe(false);
    });

    it('first call returns true, second call returns false (in-memory sim)', async () => {
      const { redis } = makeRedis();
      const svc = makeService(redis);
      const jti = 'jti_unique_round_trip_x';
      expect(await svc.consume(jti, 30)).toBe(true);
      expect(await svc.consume(jti, 30)).toBe(false);
    });

    it('caps TTL at 90s regardless of supplied value', async () => {
      const { redis, set } = makeRedis(['OK']);
      const svc = makeService(redis);
      await svc.consume('jti_ttl_cap_abcdefgh', 86400); // 24h supplied
      expect(set).toHaveBeenCalledWith(expect.any(String), '1', 'EX', 90, 'NX');
    });

    it('floors TTL to 1 for zero/negative input', async () => {
      const { redis, set } = makeRedis(['OK']);
      const svc = makeService(redis);
      await svc.consume('jti_floor_test_123456', 0);
      expect(set).toHaveBeenCalledWith(expect.any(String), '1', 'EX', 1, 'NX');
    });

    it('uses key pattern verify:jti:<jti>', async () => {
      const { redis, set } = makeRedis(['OK']);
      const svc = makeService(redis);
      await svc.consume('jti_key_pattern_12345', 30);
      expect(set).toHaveBeenCalledWith('verify:jti:jti_key_pattern_12345', '1', 'EX', 30, 'NX');
    });

    it('does NOT call Redis and returns false for too-short jti (<8 chars)', async () => {
      const { redis, set } = makeRedis(['OK']);
      const svc = makeService(redis);
      const result = await svc.consume('short', 30);
      expect(result).toBe(false);
      expect(set).not.toHaveBeenCalled();
    });

    it('does NOT call Redis and returns false for too-long jti (>128 chars)', async () => {
      const { redis, set } = makeRedis(['OK']);
      const svc = makeService(redis);
      const longJti = 'x'.repeat(129);
      const result = await svc.consume(longJti, 30);
      expect(result).toBe(false);
      expect(set).not.toHaveBeenCalled();
    });

    it('does NOT call Redis and returns false for empty jti', async () => {
      const { redis, set } = makeRedis(['OK']);
      const svc = makeService(redis);
      const result = await svc.consume('', 30);
      expect(result).toBe(false);
      expect(set).not.toHaveBeenCalled();
    });

    it('throws ServiceUnavailableError when Redis SET throws (fail closed)', async () => {
      const redis = {
        raw: jest.fn(() => ({
          set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        })),
      } as unknown as RedisService;
      const svc = makeService(redis);
      await expect(svc.consume('jti_redis_down_12345', 30)).rejects.toBeInstanceOf(ServiceUnavailableError);
    });

    it('does not return null or undefined — only boolean', async () => {
      const { redis } = makeRedis(['OK']);
      const svc = makeService(redis);
      const r1 = await svc.consume('jti_bool_check_12345', 30);
      expect(typeof r1).toBe('boolean');
    });

    it('accepts jti at the 128-char boundary', async () => {
      const { redis } = makeRedis(['OK']);
      const svc = makeService(redis);
      const jti = 'a'.repeat(128); // exactly 128 — valid
      const result = await svc.consume(jti, 30);
      expect(result).toBe(true);
    });

    it('accepts jti at the 8-char boundary', async () => {
      const { redis } = makeRedis(['OK']);
      const svc = makeService(redis);
      const result = await svc.consume('abcdefgh', 30); // exactly 8 — valid
      expect(result).toBe(true);
    });
  });
});
