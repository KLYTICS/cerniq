// VerifyGateway — relying-party scaling wrapper around `Aegis.verify`.
//
// Three primitives, composed in order on every call:
//   1. Cache lookup       — collapses repeat verifies of the same
//                           (token, ctx) within the server TTL window.
//   2. Single-flight      — multiple concurrent misses for the same key
//                           coalesce onto one in-flight network call.
//   3. Circuit breaker    — consecutive upstream failures fast-fail or
//                           serve cached-stale (operator-configurable)
//                           so a degraded API does not melt the caller.
//
// Additive only. The existing `Aegis` class is unchanged. Relying parties
// opt in by wrapping their existing client.
//
// Portability: zero Node-only imports. Runs unchanged in Node 20+,
// browsers, Bun, Deno, Cloudflare Workers, Vercel Edge.

import type { Aegis } from './index.js';
import { AegisError, AegisServiceUnavailableError } from './errors.js';
import {
  MemoryVerifyCache,
  buildCacheKey,
  clampTtlMs,
  type VerifyCache,
  type VerifyCacheContext,
} from './cache.js';
import type { VerifyResult } from './types.js';

export type BreakerState = 'closed' | 'open' | 'half-open';

export type FallbackMode = 'fail-fast' | 'serve-stale';

export interface VerifyGatewayOptions {
  /** Cache backend. Defaults to in-memory LRU with 10k entries. */
  cache?: VerifyCache;
  /** Hard TTL ceiling regardless of server `ttl`. Default: 60s. */
  maxTtlMs?: number;
  /**
   * Cache window for `valid: false` denials. Default: 0 (denials never
   * cached). Set a small positive value (e.g. 1000ms) only if you have
   * accepted that revocations may be hidden for that duration.
   */
  negativeTtlMs?: number;
  /** Trip after this many consecutive upstream failures. Default: 5. */
  breakerThreshold?: number;
  /** How long the breaker stays `open` before allowing one half-open probe. Default: 5_000ms. */
  breakerCooldownMs?: number;
  /**
   * Behavior when the breaker is `open`:
   *   - 'fail-fast' (default): throw `AegisServiceUnavailableError` immediately.
   *   - 'serve-stale': return any cached entry regardless of expiry.
   *     Marks `result` with `_stale: true` via observability hook.
   */
  fallbackMode?: FallbackMode;
  /** Observability hooks — fire-and-forget, must not throw. */
  hooks?: VerifyGatewayHooks;
  /** Clock injection for tests. */
  now?: () => number;
}

export interface VerifyGatewayMetrics {
  state: BreakerState;
  hits: number;
  misses: number;
  coalesced: number;
  staleServed: number;
  breakerTrips: number;
  consecutiveFailures: number;
  cacheSize: number;
}

export interface VerifyGatewayHooks {
  onHit?: (key: string, result: VerifyResult) => void;
  onMiss?: (key: string) => void;
  onCoalesce?: (key: string, inflightCount: number) => void;
  onBreakerStateChange?: (from: BreakerState, to: BreakerState) => void;
  onStale?: (key: string, result: VerifyResult) => void;
  onError?: (err: AegisError) => void;
}

const DEFAULT_MAX_TTL_MS = 60_000;
const DEFAULT_BREAKER_THRESHOLD = 5;
const DEFAULT_BREAKER_COOLDOWN_MS = 5_000;

export class VerifyGateway {
  private readonly aegis: Aegis;
  private readonly cache: VerifyCache;
  private readonly maxTtlMs: number;
  private readonly negativeTtlMs: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly fallbackMode: FallbackMode;
  private readonly hooks: VerifyGatewayHooks;
  private readonly now: () => number;

  // Single-flight registry: key → in-flight Promise. Concurrent callers
  // for the same key await the same Promise.
  private readonly inflight = new Map<string, Promise<VerifyResult>>();
  // Approximate concurrent-waiter count per key, for the onCoalesce hook.
  private readonly inflightWaiters = new Map<string, number>();

  // Breaker state. `consecutiveFailures` increments on AegisError;
  // `openedAt` is set when we trip; we revert to half-open after the
  // cooldown, then to closed on the next success.
  private breaker: BreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  // Half-open serialization: at most one probe at a time. Concurrent
  // callers during a probe are treated as if the breaker were still open
  // (fail-fast or serve-stale). Without this, a recovering upstream gets
  // hit with N concurrent probes the moment cooldown elapses.
  private halfOpenProbeInFlight = false;

  // Counters for the metrics() snapshot. Approximate, not for billing.
  private hits = 0;
  private misses = 0;
  private coalesced = 0;
  private staleServed = 0;
  private breakerTrips = 0;

  constructor(aegis: Aegis, opts: VerifyGatewayOptions = {}) {
    this.aegis = aegis;
    this.now = opts.now ?? Date.now;
    this.cache = opts.cache ?? new MemoryVerifyCache({ now: this.now });
    this.maxTtlMs = opts.maxTtlMs ?? DEFAULT_MAX_TTL_MS;
    this.negativeTtlMs = Math.max(0, opts.negativeTtlMs ?? 0);
    this.breakerThreshold = Math.max(1, opts.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD);
    this.breakerCooldownMs = Math.max(0, opts.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS);
    this.fallbackMode = opts.fallbackMode ?? 'fail-fast';
    this.hooks = opts.hooks ?? {};
  }

  /** Current breaker state — exposed for metrics. */
  get state(): BreakerState {
    return this.breaker;
  }

  /**
   * Verify a token through the cache + single-flight + breaker stack.
   * Identical signature to `Aegis.verify` so this is a drop-in replacement.
   */
  async verify(token: string, ctx: VerifyCacheContext = {}): Promise<VerifyResult> {
    const key = buildCacheKey(token, ctx);

    // 1. Cache lookup. Prefer `peek` so a stale entry survives for the
    // serve-stale breaker fallback below; gateway validates expiry itself.
    const cached = await Promise.resolve(
      this.cache.peek ? this.cache.peek(key) : this.cache.get(key),
    );
    if (cached !== undefined && cached.expiresAt > this.now()) {
      this.hits += 1;
      this.safeHook('onHit', key, cached.result);
      return cached.result;
    }

    // 2. Breaker check before any network attempt.
    this.maybeTransitionBreaker();
    if (this.breaker === 'open') {
      return this.handleBreakerOpen(key, cached);
    }
    // Half-open: serialize to a single probe. Subsequent concurrent
    // callers are treated like 'open' (fail-fast or serve-stale) so the
    // recovering upstream sees one request, not N.
    if (this.breaker === 'half-open' && this.halfOpenProbeInFlight) {
      return this.handleBreakerOpen(key, cached);
    }
    if (this.breaker === 'half-open') {
      this.halfOpenProbeInFlight = true;
    }

    // 3. Single-flight coalesce.
    const existing = this.inflight.get(key);
    if (existing !== undefined) {
      const next = (this.inflightWaiters.get(key) ?? 1) + 1;
      this.inflightWaiters.set(key, next);
      this.coalesced += 1;
      this.safeHook('onCoalesce', key, next);
      return existing;
    }

    this.misses += 1;
    this.safeHook('onMiss', key);
    const promise = this.executeAndStore(key, token, ctx);
    this.inflight.set(key, promise);
    this.inflightWaiters.set(key, 1);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
      this.inflightWaiters.delete(key);
    }
  }

  /** Drop a single cache entry. Use after webhook-driven revocation. */
  async invalidate(token: string, ctx: VerifyCacheContext = {}): Promise<void> {
    await Promise.resolve(this.cache.delete(buildCacheKey(token, ctx)));
  }

  private async executeAndStore(
    key: string,
    token: string,
    ctx: VerifyCacheContext,
  ): Promise<VerifyResult> {
    try {
      const result = await this.aegis.verify(token, ctx);
      this.recordSuccess();

      const ttlMs = this.computeTtlMs(result);
      if (ttlMs > 0) {
        // Negative-only jitter. Spreads expiries so 10k tokens cached in
        // the same second don't all stampede 30 seconds later. Server
        // TTL is the ceiling — we only ever shorten, never extend.
        const jittered = Math.floor(ttlMs * (1 - this.randomJitterFactor()));
        await Promise.resolve(
          this.cache.set(key, { result, expiresAt: this.now() + jittered }),
        );
      }
      return result;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  private computeTtlMs(result: VerifyResult): number {
    // Positive results respect server TTL clamped by operator ceiling.
    if (result.valid) return clampTtlMs(result.ttl, this.maxTtlMs);
    // Denials only cached if operator explicitly opted in.
    if (this.negativeTtlMs <= 0) return 0;
    return Math.min(this.negativeTtlMs, clampTtlMs(result.ttl, this.maxTtlMs) || this.negativeTtlMs);
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.halfOpenProbeInFlight = false;
    if (this.breaker !== 'closed') this.transitionBreaker('closed');
  }

  private recordFailure(err: unknown): void {
    if (!(err instanceof AegisError)) return;
    this.safeHook('onError', err);
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.breakerThreshold && this.breaker === 'closed') {
      this.openedAt = this.now();
      this.breakerTrips += 1;
      this.transitionBreaker('open');
    } else if (this.breaker === 'half-open') {
      // Half-open probe failed: re-open with full cooldown.
      this.openedAt = this.now();
      this.halfOpenProbeInFlight = false;
      this.breakerTrips += 1;
      this.transitionBreaker('open');
    }
  }

  private maybeTransitionBreaker(): void {
    if (this.breaker !== 'open') return;
    if (this.now() - this.openedAt >= this.breakerCooldownMs) {
      this.transitionBreaker('half-open');
    }
  }

  private transitionBreaker(to: BreakerState): void {
    if (this.breaker === to) return;
    const from = this.breaker;
    this.breaker = to;
    this.safeHook('onBreakerStateChange', from, to);
  }

  private async handleBreakerOpen(
    key: string,
    cached: { result: VerifyResult; expiresAt: number } | undefined,
  ): Promise<VerifyResult> {
    if (this.fallbackMode === 'serve-stale' && cached !== undefined) {
      this.staleServed += 1;
      this.safeHook('onStale', key, cached.result);
      return cached.result;
    }
    throw new AegisServiceUnavailableError(
      'AEGIS verify gateway breaker is open — upstream is failing.',
      503,
      undefined,
    );
  }

  /**
   * Snapshot of approximate counters since gateway construction. Useful
   * for ops dashboards that cannot wire hooks. All counters are best-
   * effort — never relied on for billing or audit.
   */
  metrics(): VerifyGatewayMetrics {
    return {
      state: this.breaker,
      hits: this.hits,
      misses: this.misses,
      coalesced: this.coalesced,
      staleServed: this.staleServed,
      breakerTrips: this.breakerTrips,
      consecutiveFailures: this.consecutiveFailures,
      cacheSize: this.cache.size?.() ?? 0,
    };
  }

  /**
   * 0..0.10 random factor used to jitter cache TTL downward. Uses Web
   * Crypto so we don't pull in Node-only RNG and so it survives in
   * security-adjacent codepaths (CLAUDE.md quality bar: no Math.random
   * in identity/policy/audit paths). One byte is plenty of entropy for
   * a 10% jitter window.
   */
  private randomJitterFactor(): number {
    const buf = new Uint8Array(1);
    globalThis.crypto.getRandomValues(buf);
    const byte = buf[0] ?? 0;
    return (byte / 255) * 0.1; // [0, 0.1]
  }

  // type-rationale: `unknown[]` here keeps the dispatch table generic
  // without losing per-hook type safety at call sites; only the four
  // narrow `safeHook(...)` callers above produce arguments and they
  // each match the corresponding hook signature.
  private safeHook<K extends keyof VerifyGatewayHooks>(
    name: K,
    ...args: unknown[]
  ): void {
    const hook = this.hooks[name];
    if (typeof hook !== 'function') return;
    try {
      (hook as (...a: unknown[]) => void)(...args);
    } catch {
      // Hooks must never break the verify path. Swallow.
    }
  }
}
