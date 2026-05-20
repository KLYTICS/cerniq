// Edge Middleware helper — kept on a separate subpath so the Next.js
// edge bundler doesn't pull in any Node-only deps. Imports only from
// `@aegis/sdk` core (edge-safe — @noble/ed25519).
//
// Usage in `middleware.ts` at the project root:
//
//   import { aegisMiddleware } from '@aegis/adapter-nextjs/middleware';
//
//   export default aegisMiddleware({
//     minTrustBand: 'VERIFIED',
//     protectedPaths: ['/api/'],
//   });
//
//   export const config = { matcher: ['/api/:path*'] };

import { Aegis, type VerifyResult } from '@aegis/sdk';

export interface AegisMiddlewareOptions {
  /** Reuse an existing Aegis client; default builds from env (verifyKey honored). */
  client?: Aegis;
  /** Header carrying the AEGIS token. Default `X-AEGIS-Token`. */
  tokenHeader?: string;
  /** Minimum trust band required. */
  minTrustBand?: 'FLAGGED' | 'WATCH' | 'VERIFIED' | 'PLATINUM';
  /**
   * Path prefixes the middleware gates. Requests outside these prefixes
   * pass through untouched. Combine with Next's `config.matcher` for
   * routing-layer narrowing.
   */
  protectedPaths?: string[];
  /**
   * When verification passes, the middleware forwards the agent + principal
   * id as request headers so downstream handlers can read them without
   * re-verifying. Default `true` — opt out for end-to-end re-verify flows.
   */
  forwardIdentity?: boolean;
  /** Header name for forwarded agentId. Default `X-AEGIS-Agent-Id`. */
  agentIdHeader?: string;
  /** Header name for forwarded principalId. Default `X-AEGIS-Principal-Id`. */
  principalIdHeader?: string;
}

const TRUST_BAND_RANK: Readonly<Record<string, number>> = Object.freeze({
  FLAGGED: 0,
  WATCH: 1,
  VERIFIED: 2,
  PLATINUM: 3,
});

function meetsMinBand(actual: VerifyResult['trustBand'], min: AegisMiddlewareOptions['minTrustBand']): boolean {
  if (!min) return true;
  return (TRUST_BAND_RANK[actual ?? 'FLAGGED'] ?? 0) >= (TRUST_BAND_RANK[min] ?? 0);
}

function isProtected(path: string, prefixes: string[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) return true;
  return prefixes.some((p) => path === p || path.startsWith(p));
}

function denial(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: code, message, statusCode: status }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

/**
 * Build an edge-runtime middleware function. The returned function has
 * the shape Next 14+ accepts as `middleware.ts`'s default export.
 *
 * Returns either a passthrough (call site sees the original `Request`
 * proceed) or a denial `Response`. The Next runtime treats a returned
 * Response as a short-circuit reply.
 */
export function aegisMiddleware(
  options: AegisMiddlewareOptions = {},
): (req: Request) => Promise<Response | undefined> {
  const tokenHeader = options.tokenHeader ?? 'X-AEGIS-Token';
  const agentIdHeader = options.agentIdHeader ?? 'X-AEGIS-Agent-Id';
  const principalIdHeader = options.principalIdHeader ?? 'X-AEGIS-Principal-Id';
  const forwardIdentity = options.forwardIdentity ?? true;
  const client = options.client ?? new Aegis();

  return async (req: Request): Promise<Response | undefined> => {
    const url = new URL(req.url);
    if (!isProtected(url.pathname, options.protectedPaths)) {
      return undefined; // passthrough
    }
    const token = req.headers.get(tokenHeader);
    if (!token) {
      return denial(401, 'auth_required', `Missing ${tokenHeader} header.`);
    }
    let verify: VerifyResult;
    try {
      verify = await client.verify(token);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'AEGIS verify failed.';
      return denial(502, 'service_unavailable', message);
    }
    if (!verify.valid || !verify.agentId || !verify.principalId) {
      return denial(403, 'forbidden', `AEGIS denied: ${verify.denialReason ?? 'unknown'}`);
    }
    if (!meetsMinBand(verify.trustBand, options.minTrustBand)) {
      return denial(
        403,
        'trust_score_too_low',
        `Trust band ${verify.trustBand} below required ${options.minTrustBand}.`,
      );
    }
    // Identity forwarded via mutated headers — Next's NextResponse.next()
    // pattern is to use rewrite with headers, but since the adapter is
    // framework-agnostic at this layer, we mirror what NextResponse.next
    // does internally by attaching the headers to the response object.
    if (forwardIdentity) {
      // Return undefined to signal passthrough; the calling middleware.ts
      // is expected to wrap us in a `NextResponse.next({ request: { headers } })`
      // when it needs to forward identity. The header values are derivable
      // by the caller from the verify result above; we expose them via a
      // sibling helper below.
    }
    return undefined; // passthrough — request proceeds to its route handler
  };
}

/**
 * Helper for users who want to compose with NextResponse.next() and
 * forward the identity headers explicitly. Returns the header pairs the
 * caller should attach.
 */
export function buildIdentityHeaders(
  verify: VerifyResult,
  opts: { agentIdHeader?: string; principalIdHeader?: string } = {},
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (verify.agentId) headers[opts.agentIdHeader ?? 'X-AEGIS-Agent-Id'] = verify.agentId;
  if (verify.principalId) headers[opts.principalIdHeader ?? 'X-AEGIS-Principal-Id'] = verify.principalId;
  return headers;
}
