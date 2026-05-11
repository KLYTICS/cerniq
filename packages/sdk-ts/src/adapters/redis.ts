// Redis adapter for `VerifyCache`. Duck-typed against any client that
// exposes `get(key) → string|Buffer|null`, `setex(key, seconds, value)`
// or `set(key, value, "EX", seconds)`, and `del(key)`. Works with
// `ioredis`, `node-redis`, and the Upstash REST shim out of the box.
//
// Design (validated against the AEGIS server-side Redis pattern at
// apps/api/src/common/redis/redis.service.ts):
//
//   * Fail-soft. A Redis miss, timeout, or decode error returns
//     `undefined` — the gateway then falls through to the network.
//     We NEVER let a backend wobble cascade into denied verifies.
//   * TTL in seconds (Redis native). Adapter computes
//     `ceil((expiresAt − now) / 1000)` from the gateway's epoch-ms.
//   * Key namespace: `aegis:verify:<sha256>` — matches the existing
//     `namespace:resource:id` colon convention.
//   * `onError` hook surfaces backend errors so operators can alarm
//     without having to touch the gateway's `onError` (cache backend
//     errors are not AegisErrors).
//
// No hard dependency on any Redis client — package consumers install
// their preferred client themselves.

import type { CachedVerify, VerifyCache } from '../cache.js';
import type { VerifyResult } from '../types.js';

/** Minimal Redis surface this adapter relies on. */
export interface RedisLike {
  get(key: string): Promise<string | null | undefined>;
  // Two common signatures across clients:
  //   ioredis:        set(key, value, "EX", seconds)
  //   node-redis v4:  set(key, value, { EX: seconds })
  // We expose both for the adapter's own internal `setEx` helper.
  set?(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  setex?(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
}

export interface RedisVerifyCacheOptions {
  /** Key prefix. Default: `'aegis:verify:'` (matches server convention). */
  keyPrefix?: string;
  /**
   * Backend error hook. Fires when Redis throws or returns malformed
   * data. Use for metrics/alarms. Must not throw. Backend errors are
   * NEVER propagated to the verify call — they degrade to cache miss.
   */
  onError?: (op: 'get' | 'set' | 'delete', err: unknown, key: string) => void;
  /** Clock injection for tests. Default: `Date.now`. */
  now?: () => number;
}

const DEFAULT_PREFIX = 'aegis:verify:';

export class RedisVerifyCache implements VerifyCache {
  private readonly client: RedisLike;
  private readonly prefix: string;
  private readonly onError: ((op: 'get' | 'set' | 'delete', err: unknown, key: string) => void) | undefined;
  private readonly now: () => number;

  constructor(client: RedisLike, opts: RedisVerifyCacheOptions = {}) {
    this.client = client;
    this.prefix = opts.keyPrefix ?? DEFAULT_PREFIX;
    this.onError = opts.onError;
    this.now = opts.now ?? Date.now;
  }

  async get(key: string): Promise<CachedVerify | undefined> {
    const fullKey = this.prefix + key;
    let raw: string | null | undefined;
    try {
      raw = await this.client.get(fullKey);
    } catch (err) {
      this.safeOnError('get', err, fullKey);
      return undefined;
    }
    if (raw === null || raw === undefined) return undefined;
    return this.decode(raw, fullKey);
  }

  /**
   * Redis enforces TTL natively, so peek and get are equivalent at the
   * backend — Redis already evicted anything past its TTL. The gateway
   * still validates `expiresAt` itself for the half-open serve-stale
   * window, but that window is bounded by the server's `ttl` field.
   */
  async peek(key: string): Promise<CachedVerify | undefined> {
    return this.get(key);
  }

  async set(key: string, value: CachedVerify): Promise<void> {
    const fullKey = this.prefix + key;
    const ttlSec = Math.max(1, Math.ceil((value.expiresAt - this.now()) / 1000));
    let payload: string;
    try {
      payload = JSON.stringify({ result: value.result, expiresAt: value.expiresAt });
    } catch (err) {
      this.safeOnError('set', err, fullKey);
      return;
    }
    try {
      if (typeof this.client.setex === 'function') {
        await this.client.setex(fullKey, ttlSec, payload);
        return;
      }
      if (typeof this.client.set === 'function') {
        // ioredis: set(key, value, "EX", seconds)
        // node-redis v4: set(key, value, { EX: seconds })
        // Try ioredis-style first (more common in AEGIS' own apps/api).
        await this.client.set(fullKey, payload, 'EX', ttlSec);
        return;
      }
      throw new TypeError('RedisLike client must implement set or setex');
    } catch (err) {
      this.safeOnError('set', err, fullKey);
    }
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.prefix + key;
    try {
      await this.client.del(fullKey);
    } catch (err) {
      this.safeOnError('delete', err, fullKey);
    }
  }

  private decode(raw: string, fullKey: string): CachedVerify | undefined {
    try {
      const parsed = JSON.parse(raw) as { result: VerifyResult; expiresAt: number };
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        typeof parsed.expiresAt !== 'number' ||
        parsed.result === undefined
      ) {
        // type-rationale: defensive — a corrupt payload should degrade
        // to miss, not crash the gateway. Surface via onError so the
        // operator notices.
        throw new TypeError('Malformed VerifyCache payload');
      }
      return { result: parsed.result, expiresAt: parsed.expiresAt };
    } catch (err) {
      this.safeOnError('get', err, fullKey);
      return undefined;
    }
  }

  private safeOnError(op: 'get' | 'set' | 'delete', err: unknown, key: string): void {
    if (!this.onError) return;
    try {
      this.onError(op, err, key);
    } catch {
      // Hooks must never break the verify path.
    }
  }
}
