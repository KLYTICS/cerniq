// JWKS client — fetches the AEGIS JWKS once, caches by kid with TTL +
// stale-while-revalidate. Used to verify policy tokens (issuer-signed) where
// the JWS header carries a `kid`.

import { b64uDecode } from './_internal/b64u.js';
import { JwksFetchError, JwksParseError } from './errors.js';
import { JwksMemoryCache } from './jwks-cache.js';
import type { JwksDocument, JwksKey, Logger } from './types.js';

export interface JwksClientOptions {
  baseUrl: string;
  cacheTtlSeconds: number;
  fetchImpl: typeof globalThis.fetch;
  logger?: Logger;
  /** Override the default JWKS path. */
  jwksPath?: string;
}

const DEFAULT_JWKS_PATH = '/.well-known/jwks.json';

function isJwksKey(value: unknown): value is JwksKey {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kty !== 'OKP') return false;
  if (v.crv !== 'Ed25519') return false;
  if (typeof v.x !== 'string' || v.x.length === 0) return false;
  if (typeof v.kid !== 'string' || v.kid.length === 0) return false;
  return true;
}

function isJwksDocument(value: unknown): value is JwksDocument {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.keys)) return false;
  return v.keys.every(isJwksKey);
}

export class JwksClient {
  private readonly cache: JwksMemoryCache;
  private readonly opts: JwksClientOptions;
  private inFlight: Promise<void> | null = null;

  constructor(opts: JwksClientOptions) {
    this.opts = opts;
    this.cache = new JwksMemoryCache(opts.cacheTtlSeconds);
  }

  /**
   * Resolve a kid to a raw 32-byte public key. On cache miss/stale, refreshes
   * once. If the kid is still missing after refresh, returns null — caller
   * should treat as INVALID_SIGNATURE.
   */
  async getKey(kid: string): Promise<Uint8Array | null> {
    const stale = this.cache.getStale(kid);
    if (stale && !stale.stale) {
      return b64uDecode(stale.key.x);
    }
    if (stale && stale.stale) {
      // SWR: kick off background refresh, return stale immediately.
      void this.refreshOnce().catch((err) => {
        this.opts.logger?.warn?.('jwks background refresh failed', { error: String(err) });
      });
      return b64uDecode(stale.key.x);
    }
    // Cold miss — must wait for refresh.
    await this.refreshOnce();
    const fresh = this.cache.get(kid);
    return fresh ? b64uDecode(fresh.x) : null;
  }

  /** Force a refresh — used by `prefetchJwks()`. */
  async prefetch(): Promise<void> {
    await this.refreshOnce();
  }

  /** Replace cache (used by tests). */
  _seed(keys: JwksKey[]): void {
    this.cache.replaceAll(keys);
  }

  private async refreshOnce(): Promise<void> {
    if (this.inFlight) { await this.inFlight; return; }
    this.inFlight = (async () => {
      try {
        const url = this.buildUrl();
        const res = await this.opts.fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          throw new JwksFetchError(`JWKS fetch failed: ${res.status} ${res.statusText}`);
        }
        const json: unknown = await res.json();
        if (!isJwksDocument(json)) {
          throw new JwksParseError('JWKS document is malformed');
        }
        this.cache.replaceAll(json.keys);
        this.opts.logger?.debug?.('jwks refreshed', { count: json.keys.length });
      } finally {
        this.inFlight = null;
      }
    })();
    await this.inFlight;
  }

  private buildUrl(): string {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    const path = this.opts.jwksPath ?? DEFAULT_JWKS_PATH;
    // Resolve the JWKS at the host root; baseUrl is typically `…/v1` and the
    // well-known endpoint sits above that.
    try {
      const u = new URL(base);
      return `${u.origin}${path}`;
    } catch {
      return `${base}${path}`;
    }
  }
}
