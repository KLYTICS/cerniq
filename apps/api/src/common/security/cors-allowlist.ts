// OKORO — strict CORS allow-list.
//
// Default Nest CORS with `origin: '*'` is convenient but wide. Production
// must:
//
//   1. Explicitly allow only the domains we publish (dashboard, docs site,
//      *.okoroapp.com for our own properties).
//   2. Reflect the requesting Origin only when it appears in the allow-list,
//      so a browser CORS preflight from any other host fails.
//   3. Deny `credentials: true` when origin is the wildcard
//      (browsers treat that combination as misconfigured anyway, but
//      we make it impossible at the source).
//
// The verify hot path is intentionally callable from any origin (relying
// parties live anywhere on the internet) and uses an API key, not cookies.
// We achieve that by NOT setting `credentials: true` when the request is
// to a verify-key-protected endpoint — the SDK's `fetch()` doesn't carry
// cookies anyway. CORS sets `Access-Control-Allow-Origin: *` in that case
// safely.

import type {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface';
import type { Request } from 'express';

export interface CorsConfig {
  /**
   * Comma-separated list of allowed origins for management-plane endpoints
   * (anything that uses cookies / X-OKORO-API-Key). Public verify-key
   * endpoints get `*` regardless.
   *
   * Examples:
   *   `https://app.okoroapp.com,https://docs.okoroapp.com`
   *   `*` (development only)
   */
  managementOrigins: string;
  /**
   * Routes that are intentionally world-callable (they use the verify-only
   * API key, no cookies). Substring-matched on the request URL path.
   */
  publicPathPrefixes?: string[];
}

const DEFAULT_PUBLIC_PATH_PREFIXES = ['/v1/verify', '/.well-known/', '/health', '/ready'];

/** Regex-style public matchers (path-segment-aware). Each must match the
 *  whole path. Used in addition to {@link DEFAULT_PUBLIC_PATH_PREFIXES}. */
const DEFAULT_PUBLIC_PATH_REGEX = [
  // /v1/agents/<id>/status — the public agent-status endpoint per docs/SECURITY.md §2.
  // The rest of /v1/agents/* is management and goes through the strict allow-list.
  /^\/v1\/agents\/[^/]+\/status$/,
];

/**
 * Build a CORS delegate. NestJS calls the delegate per request, so we can
 * vary the response by request URL — strict allow-list for management,
 * wide-open for the verify hot path.
 */
export function buildCorsDelegate(config: CorsConfig): CorsOptionsDelegate<Request> {
  const allowList = parseAllowList(config.managementOrigins);
  const publicPrefixes = config.publicPathPrefixes ?? DEFAULT_PUBLIC_PATH_PREFIXES;

  return (req, callback) => {
    const url = req.url ?? '';
    const path = url.split('?')[0] ?? url;
    const isPublic =
      publicPrefixes.some((p) => path.startsWith(p)) ||
      DEFAULT_PUBLIC_PATH_REGEX.some((r) => r.test(path));

    if (isPublic) {
      // Wide-open for relying parties; no cookies.
      const opts: CorsOptions = {
        origin: '*',
        credentials: false,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'X-OKORO-Verify-Key',
          'X-OKORO-API-Key',
          'Idempotency-Key',
          'X-Request-Id',
        ],
        exposedHeaders: ['X-Request-Id', 'X-OKORO-Trace-Id'],
        maxAge: 86_400, // 24h preflight cache
      };
      callback(null, opts);
      return;
    }

    // Management-plane: strict allow-list with credentials.
    const origin = req.headers.origin;
    const allowed = origin !== undefined && allowList.includes(origin);

    const opts: CorsOptions = {
      origin: allowed ? origin : false, // false → no Access-Control-Allow-Origin → browser blocks
      credentials: allowed,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'X-OKORO-API-Key',
        'Authorization',
        'Idempotency-Key',
        'X-Request-Id',
        'X-CSRF-Token',
      ],
      exposedHeaders: ['X-Request-Id', 'X-OKORO-Trace-Id'],
      maxAge: 600, // 10 min preflight cache (shorter for management to react to allow-list changes faster)
    };
    callback(null, opts);
  };
}

function parseAllowList(raw: string): string[] {
  if (raw === '*') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Wildcard '*' acceptance — only valid in non-production environments.
 * Production env validation lives in config.schema.ts; this helper is for
 * test-only assertions.
 */
export function isWildcard(raw: string): boolean {
  return raw.trim() === '*';
}
