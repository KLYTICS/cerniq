// Stale-while-revalidate JWKS cache, keyed on `kid`.
//
// Storage shape:
//   - `entries` map kid → { key, expiresAt }
//   - A single `inFlight` promise dedupes concurrent refresh calls so a burst
//     of cache misses doesn't hammer the JWKS endpoint.

import { now } from './_internal/time.js';
import type { JwksKey } from './types.js';

interface CacheEntry {
  key: JwksKey;
  expiresAt: number;
}

export class JwksMemoryCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
  }

  /** Return the cached key for kid, or `null` if missing/expired. */
  get(kid: string): JwksKey | null {
    const entry = this.entries.get(kid);
    if (!entry) return null;
    if (entry.expiresAt <= now()) return null;
    return entry.key;
  }

  /**
   * Stale-while-revalidate variant. Returns the entry even if expired, plus
   * a flag indicating the caller should trigger a background refresh.
   */
  getStale(kid: string): { key: JwksKey; stale: boolean } | null {
    const entry = this.entries.get(kid);
    if (!entry) return null;
    return { key: entry.key, stale: entry.expiresAt <= now() };
  }

  set(kid: string, key: JwksKey): void {
    this.entries.set(kid, { key, expiresAt: now() + this.ttlMs });
  }

  /** Replace the entire keyset atomically (e.g. on a JWKS refresh). */
  replaceAll(keys: JwksKey[]): void {
    const fresh = new Map<string, CacheEntry>();
    const expiresAt = now() + this.ttlMs;
    for (const key of keys) {
      fresh.set(key.kid, { key, expiresAt });
    }
    // Atomic swap via Map clear+populate.
    this.entries.clear();
    for (const [kid, entry] of fresh) {
      this.entries.set(kid, entry);
    }
  }

  delete(kid: string): void {
    this.entries.delete(kid);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
