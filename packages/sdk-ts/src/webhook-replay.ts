// Webhook replay defense — delivery-id dedupe adapter.
//
// PROBLEM SHAPE
// -------------
// `verifyWebhookSignature` (M-WEBHOOK-1) verifies HMAC + a timestamp window.
// Inside that window (default 300s, operator-pinned), a captured signature
// is still cryptographically valid. An attacker who reads the wire OR a
// well-meaning load balancer that re-fires a request can deliver the same
// payload twice — and the customer's handler will execute twice unless
// they dedupe on `X-AEGIS-Delivery-Id`.
//
// The API stamps that header at `apps/api/src/modules/webhooks/
// webhook.delivery.ts:355` with the WebhookDelivery row id (server-minted,
// unique-per-attempt). Every retry of the same logical delivery reuses the
// same id, so dedupe is correct under at-least-once semantics.
//
// WHY AN ADAPTER, NOT A BUILT-IN
// ------------------------------
// Replay defense needs storage. In-process memory works for a single
// container but fails the moment a customer horizontally scales their
// receiver — process A admits delivery X, process B admits the same X.
// Customers running > 1 receiver pod need Redis / Memcached / DynamoDB /
// Cloudflare KV / Deno KV / Vercel KV.
//
// The SDK ships:
//   1. A pluggable `WebhookReplayStore` interface — the dedupe backend.
//   2. `createMemoryReplayStore({ maxEntries, ttlSeconds })` — bounded LRU
//      + TTL for quickstarts, tests, and single-process receivers.
//   3. `assertNotReplay({ store, deliveryId, ttlSeconds })` — the helper
//      customers actually call from inside their webhook handler.
//
// PORTABILITY
// -----------
// Zero Node-only imports. Runs unchanged in Node 20+, browsers, Bun, Deno,
// Cloudflare Workers, Vercel Edge. Customers wanting a Redis-backed store
// implement the interface in their own code — the SDK never depends on
// Redis. Same shape as `VerifyCache` (cache.ts) — sync-or-async tolerant
// via `Promise<T> | T` return types.
//
// COMPOSES WITH M-WEBHOOK-1 AND M-WEBHOOK-3
// -----------------------------------------
//   verify signature → assert-not-replay → narrow event:
//
//     const sig = req.headers.get(WEBHOOK_SIGNATURE_HEADER);
//     const id  = req.headers.get(WEBHOOK_DELIVERY_ID_HEADER);
//     await verifyWebhookSignature({ payload, signature: sig!, secret });
//     await assertNotReplay({ store, deliveryId: id!, ttlSeconds: 600 });
//     const event = interpretWebhookEvent(JSON.parse(payload));
//     switch (event.event) { ... }

import { AegisError, type ErrorCatalogEntry } from './errors.js';

// ────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────

/**
 * Raised when a delivery id has already been processed. The handler should
 * respond 200 to the API (the delivery is genuinely already-handled — NOT
 * an error from the API's perspective) and skip its business logic. The
 * 200 prevents the API's BullMQ retry worker from re-firing the same
 * delivery, which would just trigger the same replay error in a loop.
 *
 * Receivers concerned about distinguishing "we already saw this" from
 * "we successfully processed this" should log the `deliveryId` on the
 * replay-detected path before returning 200.
 */
export class AegisWebhookReplayDetectedError extends AegisError {
  static override readonly catalogKey = 'AegisWebhookReplayDetectedError';
  override readonly code = 'WEBHOOK_REPLAY_DETECTED';
  static override readonly catalog: ErrorCatalogEntry | undefined = undefined;
  constructor(
    message: string,
    /** The delivery id that was already in the store. */
    public readonly deliveryId: string,
  ) {
    super(message, 409, undefined);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Store interface
// ────────────────────────────────────────────────────────────────────────
//
// Operator-chosen shape (2026-05-22): atomic single-call `recordOrReplay`
// returning a discriminated `'first-sight' | 'replay'`. Rationale:
//   - Atomic by construction — no TOCTOU on concurrent deliveries.
//   - Maps to Redis `SET NX EX` in one round trip (canonical impl below).
//   - Discriminated return matches the SDK's existing union-return style
//     (`VerifyOutcome`, `WebhookEnvelope`) and reads cleanly at call sites.
//
// Rejected alternatives:
//   - `has(id)` + `add(id, ttl)`: TOCTOU race in distributed receivers.
//   - boolean `setIfAbsent`: less self-documenting at call sites.
//
// CANONICAL REDIS IMPLEMENTATION (paste into customer code, ~3 lines):
//
//   const recordOrReplay = async (id, ttl) => {
//     const ok = await redis.set(`whrp:${id}`, '1', 'NX', 'EX', ttl);
//     return ok === 'OK' ? 'first-sight' : 'replay';
//   };

export interface WebhookReplayStore {
  /**
   * Atomically: if `deliveryId` has not been seen, record it with the
   * supplied TTL and return `'first-sight'`. If already present (and
   * unexpired), return `'replay'`. The decision must be atomic — between
   * the lookup and the write, no other caller may observe a different
   * verdict for the same id. Sync-or-async tolerant via `Promise<T> | T`
   * so in-memory stores can return without forcing `await`.
   */
  recordOrReplay(
    deliveryId: string,
    ttlSeconds: number,
  ): Promise<'first-sight' | 'replay'> | 'first-sight' | 'replay';

  /** Approximate entry count — metrics only, NOT used for correctness. */
  size?(): number;
}

// ────────────────────────────────────────────────────────────────────────
// In-memory implementation — bounded LRU with per-entry TTL
// ────────────────────────────────────────────────────────────────────────

export interface MemoryReplayStoreOptions {
  /**
   * Max retained entries. When the bound is hit, the oldest entry is
   * evicted before a new one is added. Default 10_000 — covers ~3 hours
   * of webhook traffic at 1 RPS without any TTL-driven eviction.
   */
  maxEntries?: number;
  /**
   * Override the clock — tests inject `() => fakeNow` for deterministic
   * TTL behaviour. Defaults to `Date.now`.
   */
  now?: () => number;
}

interface Entry {
  /** Absolute epoch-ms expiry. */
  expiresAt: number;
}

/**
 * In-process bounded LRU with per-entry TTL. Use for quickstarts, tests,
 * and single-process receivers. **Not safe across horizontally scaled
 * receivers** — two processes will admit the same delivery once each.
 * Operators running > 1 receiver pod must supply a shared-store
 * implementation (Redis SETNX is the canonical mapping).
 *
 * Eviction order: a Map's insertion order is its iteration order in JS.
 * Re-recording an existing key DOES NOT refresh its LRU position — replay
 * detection should not reset the eviction clock on a hit, otherwise an
 * attacker could keep a delivery id "alive" by re-attempting it.
 */
export function createMemoryReplayStore(
  opts: MemoryReplayStoreOptions = {},
): WebhookReplayStore {
  const maxEntries = opts.maxEntries ?? 10_000;
  const now = opts.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();

  function purgeExpired(currentMs: number): void {
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= currentMs) entries.delete(id);
      else break; // Map iterates in insertion order; older entries expire first.
    }
  }

  return {
    recordOrReplay(deliveryId: string, ttlSeconds: number) {
      const currentMs = now();
      purgeExpired(currentMs);

      const existing = entries.get(deliveryId);
      if (existing && existing.expiresAt > currentMs) {
        return 'replay';
      }
      // Either no entry, or it was expired (already purged above, but
      // belt-and-braces).
      if (existing) entries.delete(deliveryId);

      if (entries.size >= maxEntries) {
        // Evict the oldest entry (insertion order).
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) entries.delete(oldestKey);
      }

      entries.set(deliveryId, { expiresAt: currentMs + ttlSeconds * 1000 });
      return 'first-sight';
    },

    size() {
      return entries.size;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Customer-facing helper
// ────────────────────────────────────────────────────────────────────────

export interface AssertNotReplayOptions {
  /** Backing store — `createMemoryReplayStore()` for single-process, Redis-backed for distributed. */
  store: WebhookReplayStore;
  /** Value of the `X-AEGIS-Delivery-Id` header. */
  deliveryId: string;
  /**
   * Retention TTL in seconds. Should be ≥ the webhook subscription's max
   * retry duration so every retry of the same delivery hits the dedupe.
   * Default 86_400 (24h) — generous; tighten if your store is expensive.
   */
  ttlSeconds?: number;
}

/**
 * Throws `AegisWebhookReplayDetectedError` if `deliveryId` has been seen
 * inside the TTL window. Otherwise records the id and returns. Idempotent
 * with respect to repeated calls for the same id (subsequent calls throw).
 *
 * Place this **after** `verifyWebhookSignature` — there is no point
 * deduping an unverified id (an attacker would just pick a fresh one).
 */
export async function assertNotReplay(opts: AssertNotReplayOptions): Promise<void> {
  const ttl = opts.ttlSeconds ?? 86_400;
  const verdict = await opts.store.recordOrReplay(opts.deliveryId, ttl);
  if (verdict === 'replay') {
    throw new AegisWebhookReplayDetectedError(
      `webhook delivery already processed: ${opts.deliveryId}`,
      opts.deliveryId,
    );
  }
}
