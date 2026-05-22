// KV cache shape for the Cloudflare Worker edge verify path.
//
// Purpose: answer the common case (active agent + active policy + token
// signature good + scope OK) at the edge in <30ms p99 globally, falling
// back to the Railway origin only for cache misses or anomalies.
//
// What we cache, keyed:
//   trust:{agentId}     → CachedAgent     (60 s)
//   policy:{policyId}   → CachedPolicy    (≤ policy.expiresAt - now, max 30 s)
//   spend:{agentId}:{policyId}:{currency}:{day} → number (24 h)
//
// Trust model:
//   - Cache invalidation: origin pushes invalidations via KV writes when
//     the policy or agent changes. CF Workers re-read on miss.
//   - Stale safety: every cached record carries `cachedAt`. The Worker
//     refuses cache responses older than `MAX_STALENESS_S` even if KV
//     hasn't expired the entry yet (defense in depth against KV TTL bugs).
//   - On ANY suspicion (revoked agent, expired policy, scope mismatch,
//     spend miss): forward to origin. The Worker NEVER writes to the DB.

import type { TrustBand } from '@okoro/types';

export interface CachedAgent {
  id: string;
  publicKey: string;
  status: 'ACTIVE' | 'REVOKED' | 'SUSPENDED';
  trustScore: number;
  trustBand: TrustBand;
  principalId: string;
  cachedAt: number; // unix ms
}

export interface CachedPolicy {
  id: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expiresAtMs: number;
  scopes: {
    category: string;
    actions?: string[];
    merchantDomains?: string[];
    spendLimit?: { amount: string; currency: string; window: 'per_request' | 'per_day' | 'lifetime' };
  }[];
  cachedAt: number;
}

const MAX_STALENESS_MS = 90_000; // 90 s — twice the KV TTL ceiling we use.

export interface KvCache {
  getAgent(agentId: string): Promise<CachedAgent | null>;
  getPolicy(policyId: string): Promise<CachedPolicy | null>;
  /**
   * Get the per-day spend total. Returns 0 if not cached (origin will
   * authoritatively load and write the spend on the response path).
   */
  getDaySpend(agentId: string, policyId: string, currency: string, dayUtc: string): Promise<number>;
}

export function makeKvCache(kv: KVNamespace): KvCache {
  return {
    async getAgent(agentId: string): Promise<CachedAgent | null> {
      const raw = await kv.get(`trust:${agentId}`);
      if (!raw) return null;
      try {
        const a = JSON.parse(raw) as CachedAgent;
        if (Date.now() - a.cachedAt > MAX_STALENESS_MS) return null;
        return a;
      } catch {
        return null;
      }
    },
    async getPolicy(policyId: string): Promise<CachedPolicy | null> {
      const raw = await kv.get(`policy:${policyId}`);
      if (!raw) return null;
      try {
        const p = JSON.parse(raw) as CachedPolicy;
        if (Date.now() - p.cachedAt > MAX_STALENESS_MS) return null;
        if (p.expiresAtMs <= Date.now()) return null;
        return p;
      } catch {
        return null;
      }
    },
    async getDaySpend(agentId, policyId, currency, dayUtc): Promise<number> {
      const raw = await kv.get(`spend:${agentId}:${policyId}:${currency}:${dayUtc}`);
      if (!raw) return 0;
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? n : 0;
    },
  };
}
