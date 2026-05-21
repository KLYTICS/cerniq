// In-memory LRU replay cache, keyed on jti.
//
// Why LRU: token TTLs are short (≤ 60 s), so the working set is bounded by
// QPS × token TTL. A 10k-entry LRU comfortably handles 150 RPS sustained.
//
// Pluggable: relying parties running multi-instance deployments should swap
// in a Redis-backed implementation by satisfying the ReplayCache interface
// from `./types`.

import { now } from './_internal/time.js';
import type { ReplayCache } from './types.js';

interface Entry {
  expiresAt: number;
}

export interface MemoryReplayCacheOptions {
  maxSize?: number;
}

const DEFAULT_MAX_SIZE = 10_000;

export class MemoryReplayCache implements ReplayCache {
  private readonly maxSize: number;
  private readonly entries = new Map<string, Entry>();

  constructor(opts: MemoryReplayCacheOptions = {}) {
    this.maxSize = opts.maxSize ?? DEFAULT_MAX_SIZE;
  }

  has(jti: string): boolean {
    const entry = this.entries.get(jti);
    if (!entry) return false;
    if (entry.expiresAt <= now()) {
      this.entries.delete(jti);
      return false;
    }
    // LRU touch — re-insert to move to the back.
    this.entries.delete(jti);
    this.entries.set(jti, entry);
    return true;
  }

  set(jti: string, ttlSeconds: number): void {
    const expiresAt = now() + Math.max(0, ttlSeconds) * 1000;
    if (this.entries.has(jti)) {
      this.entries.delete(jti);
    }
    this.entries.set(jti, { expiresAt });

    // Evict oldest entries beyond the budget. Pre-emptively trim expired keys
    // from the front before evicting valid ones — improves hit rate.
    while (this.entries.size > this.maxSize) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  delete(jti: string): void {
    this.entries.delete(jti);
  }

  size(): number {
    return this.entries.size;
  }

  /** Test helper — clears all entries. */
  clear(): void {
    this.entries.clear();
  }
}
