// Lazy revocation cache. On first verify of an agent (or after TTL expiry),
// fetches `/v1/agents/:id/status` and caches the snapshot. Webhook receivers
// can invalidate immediately via {@link RevocationCache.invalidate}.

import { RevocationFetchError } from './errors.js';
import type { AgentStatusSnapshot, AgentStatusValue, Logger, TrustBand } from './types.js';
import { now } from './_internal/time.js';

export interface RevocationCacheOptions {
  baseUrl: string;
  cacheTtlSeconds: number;
  fetchImpl: typeof globalThis.fetch;
  logger?: Logger;
}

interface CacheEntry {
  snapshot: AgentStatusSnapshot;
  expiresAt: number;
}

const ALLOWED_STATUSES: ReadonlySet<AgentStatusValue> = new Set([
  'pending_verification',
  'active',
  'suspended',
  'revoked',
]);

const ALLOWED_BANDS: ReadonlySet<TrustBand> = new Set(['PLATINUM', 'VERIFIED', 'WATCH', 'FLAGGED']);

function isAgentStatusSnapshot(value: unknown, agentId: string): value is AgentStatusSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.agentId !== agentId) return false;
  if (typeof v.status !== 'string' || !ALLOWED_STATUSES.has(v.status as AgentStatusValue)) return false;
  if (typeof v.trustScore !== 'number' || !Number.isFinite(v.trustScore)) return false;
  if (typeof v.trustBand !== 'string' || !ALLOWED_BANDS.has(v.trustBand as TrustBand)) return false;
  return true;
}

export class RevocationCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<AgentStatusSnapshot>>();
  private readonly opts: RevocationCacheOptions;

  constructor(opts: RevocationCacheOptions) {
    this.opts = opts;
  }

  /** Lazy fetch with TTL cache and per-agent in-flight dedup. */
  async getStatus(agentId: string): Promise<AgentStatusSnapshot> {
    const entry = this.entries.get(agentId);
    if (entry && entry.expiresAt > now()) {
      return entry.snapshot;
    }
    const inFlight = this.inFlight.get(agentId);
    if (inFlight) return inFlight;

    const promise = this.fetchStatus(agentId)
      .then((snapshot) => {
        this.entries.set(agentId, {
          snapshot,
          expiresAt: now() + this.opts.cacheTtlSeconds * 1000,
        });
        return snapshot;
      })
      .finally(() => {
        this.inFlight.delete(agentId);
      });
    this.inFlight.set(agentId, promise);
    return promise;
  }

  /** Drop the cached entry — call from a webhook handler. */
  invalidate(agentId: string): void {
    this.entries.delete(agentId);
  }

  /** Test helper — clear all. */
  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  private async fetchStatus(agentId: string): Promise<AgentStatusSnapshot> {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    const url = `${base}/agents/${encodeURIComponent(agentId)}/status`;
    let res: Response;
    try {
      res = await this.opts.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      throw new RevocationFetchError(`status fetch failed for ${agentId}`, err);
    }
    if (res.status === 404) {
      // Surface as a synthetic "revoked" snapshot — agents that don't exist
      // upstream cannot be authorized. Trust score 0, band FLAGGED.
      return {
        agentId,
        status: 'revoked',
        trustScore: 0,
        trustBand: 'FLAGGED',
      };
    }
    if (!res.ok) {
      throw new RevocationFetchError(`status fetch HTTP ${res.status} for ${agentId}`);
    }
    const json: unknown = await res.json();
    if (!isAgentStatusSnapshot(json, agentId)) {
      throw new RevocationFetchError(`status response malformed for ${agentId}`);
    }
    return json;
  }
}
