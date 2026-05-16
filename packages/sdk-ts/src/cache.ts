// Verify-result cache primitives for the relying-party hot path.
//
// Why this lives in the SDK and not the API: architecture invariant #2
// requires the verify decision logic to stay portable. A relying party
// running at 10k QPS is overwhelmingly resolving the same (token, ctx)
// tuple repeatedly within the server-declared TTL window — collapsing
// that to a single network call per unique tuple is the difference
// between "scales" and "doesn't".
//
// Safety contract:
//   * Only positive (`valid: true`) results are cached by default.
//     Denials are short-lived state (revocation, spend bumps, anomaly
//     flags) — caching them risks contradicting the API after state
//     changes. A bounded `negativeTtlMs` opt-in exists for operators
//     who explicitly accept that trade-off.
//   * TTL is always min(server.ttl, operator-configured ceiling). The
//     server is authoritative; the client never extends past what the
//     server said was safe.
//   * Cache key spans the full verify context. Same token + different
//     amount = different decision and must miss.

import { sha256 } from '@noble/hashes/sha256';
import type { VerifyResult } from './types.js';

/** Inputs that affect a verify decision and therefore the cache key. */
export interface VerifyCacheContext {
  action?: string | undefined;
  amount?: number | undefined;
  currency?: string | undefined;
  merchantId?: string | undefined;
  merchantDomain?: string | undefined;
}

export interface CachedVerify {
  result: VerifyResult;
  /** Absolute epoch-ms expiry. */
  expiresAt: number;
}

/**
 * Pluggable cache backend. The default `MemoryVerifyCache` is in-process;
 * operators can swap in Redis, Cloudflare KV, Deno KV, etc. by
 * implementing this interface — every method is sync-or-async tolerant
 * via Promise return types so remote stores fit without API churn.
 */
export interface VerifyCache {
  get(key: string): Promise<CachedVerify | undefined> | CachedVerify | undefined;
  set(key: string, value: CachedVerify): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  /**
   * Optional: return a cached entry regardless of expiry. The gateway uses
   * this for the `serve-stale` fallback when the breaker is open. Backends
   * that cannot cheaply produce stale entries may omit this method —
   * `serve-stale` will then degrade to `fail-fast`.
   */
  peek?(key: string): Promise<CachedVerify | undefined> | CachedVerify | undefined;
  /** Approximate size — used for metrics, not for correctness. */
  size?(): number;
}

/**
 * Insertion-order LRU. Map iteration order in JS is insertion order, so
 * `delete + set` on touch is the canonical zero-dependency LRU. Eviction
 * happens lazily on `set` past `maxEntries` and on `get` past TTL.
 */
export class MemoryVerifyCache implements VerifyCache {
  private readonly store = new Map<string, CachedVerify>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: { maxEntries?: number; now?: () => number } = {}) {
    this.maxEntries = Math.max(1, opts.maxEntries ?? 10_000);
    this.now = opts.now ?? Date.now;
  }

  get(key: string): CachedVerify | undefined {
    const hit = this.store.get(key);
    if (hit === undefined) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // LRU touch: re-insert to move to most-recent end of insertion order.
    this.store.delete(key);
    this.store.set(key, hit);
    return hit;
  }

  set(key: string, value: CachedVerify): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, value);
    while (this.store.size > this.maxEntries) {
      // Evict oldest. Map.keys() yields insertion order.
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  /** Returns the entry regardless of expiry. Does not LRU-touch. */
  peek(key: string): CachedVerify | undefined {
    return this.store.get(key);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }
}

/**
 * Stable cache key. Hashing the token (rather than embedding it) means a
 * cache dump from logs/metrics never leaks bearer credentials. Context
 * fields are joined with a separator that cannot appear in any single
 * field, so `("a","b")` and `("a|b","")` cannot collide.
 */
export function buildCacheKey(token: string, ctx: VerifyCacheContext = {}): string {
  const parts = [
    token,
    ctx.action ?? '',
    ctx.amount === undefined ? '' : String(ctx.amount),
    ctx.currency ?? '',
    ctx.merchantId ?? '',
    ctx.merchantDomain ?? '',
  ];
  // Use NUL separator — illegal in HTTP header values, agent IDs, and
  // every context field above per the API schema. Defensive: a malformed
  // token (e.g. smuggled through a proxy) containing NUL must not silently
  // collide across contexts in a shared backend (Redis/CF KV). Reject at
  // the boundary instead.
  for (const p of parts) {
    if (p.indexOf('\x00') !== -1) {
      throw new Error('cache-key field contains NUL byte');
    }
  }
  const canonical = parts.join('\x00');
  const digest = sha256(new TextEncoder().encode(canonical));
  return bytesToHex(digest);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * TTL clamp: server is authoritative, operator can tighten but never
 * loosen. Server `ttl` is in seconds (per VerifyResult contract).
 */
export function clampTtlMs(serverTtlSeconds: number, maxTtlMs: number): number {
  if (!Number.isFinite(serverTtlSeconds) || serverTtlSeconds <= 0) return 0;
  const serverMs = Math.floor(serverTtlSeconds * 1000);
  return Math.max(0, Math.min(serverMs, maxTtlMs));
}
