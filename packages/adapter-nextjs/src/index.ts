// @aegis/adapter-nextjs — drop-in Next.js helpers for AEGIS verification.
//
// Round 25 Lane D — first adapter package. Validates the pattern that
// Round 26+ will follow for `@aegis/adapter-vercel-edge`,
// `@aegis/adapter-aws-lambda`, `@aegis/adapter-cloudflare-workers`,
// `@aegis/adapter-hono`, `@aegis/adapter-fastapi`, etc.
//
// Three entry points cover the App Router + Pages Router + Middleware
// surfaces:
//
//   - `withAegis(handler)`        — App Router route handler wrapper
//   - `withAegisPages(handler)`   — Pages Router API route wrapper
//   - `aegisMiddleware(options)`  — Edge Middleware factory (exported from
//                                    the `/middleware` sub-path so the
//                                    Next 16 edge bundler doesn't pull in
//                                    Node-only deps)
//
// All three converge on the same `AegisContext` shape so business code
// reads the verified principal/agent identity the same way regardless of
// router or runtime.

import { Aegis, type VerifyResult, AegisError, buildDenialEnvelope } from '@aegis/sdk';

/**
 * The verified-identity context the wrapped handler receives. Populated
 * after the AEGIS verify hot path approves the request; absent (the
 * wrapper rejects) when verification fails.
 */
export interface AegisContext {
  /** Raw verify result from AEGIS. */
  verify: VerifyResult;
  /** Convenience: extracted from verify.agentId. Never null on success. */
  agentId: string;
  /** Convenience: extracted from verify.principalId. Never null on success. */
  principalId: string;
  /** Convenience: extracted from verify.trustBand. */
  trustBand: VerifyResult['trustBand'];
}

export interface WithAegisOptions {
  /**
   * Reuse an existing Aegis client (production) or let the wrapper build
   * one from env (development). The default reads `AEGIS_API_KEY` from
   * env via the SDK constructor.
   */
  client?: Aegis;
  /**
   * Header the token rides in. Default `X-AEGIS-Token` — matches the
   * mcp-bridge convention so an MCP-fronted call traverses Next.js
   * routes unchanged.
   */
  tokenHeader?: string;
  /**
   * Minimum acceptable trust band. Requests below are rejected with 403.
   * Default: no minimum (any successful verify passes).
   */
  minTrustBand?: 'FLAGGED' | 'WATCH' | 'VERIFIED' | 'PLATINUM';
  /**
   * Optional verify-context derivation from the request. Lets the
   * relying party assert `action` / `amount` / `merchantDomain` so the
   * AEGIS algorithm can enforce scope and spend semantics.
   */
  deriveContext?: (req: Request) => {
    action?: string;
    amount?: number;
    currency?: string;
    merchantDomain?: string;
    merchantId?: string;
  };
  /**
   * Optional denial hook. When the wrapper rejects a request, this is
   * called with the verify result (or thrown error) before the 401/403
   * response is sent. Use for structured logging — DO NOT mutate the
   * response from here; the wrapper enforces the canonical denial shape.
   */
  onDenial?: (input: { req: Request; reason: string; verify?: VerifyResult }) => void;
}

const TRUST_BAND_RANK: Readonly<Record<string, number>> = Object.freeze({
  FLAGGED: 0,
  WATCH: 1,
  VERIFIED: 2,
  PLATINUM: 3,
});

function meetsMinBand(actual: VerifyResult['trustBand'], min: WithAegisOptions['minTrustBand']): boolean {
  if (!min) return true;
  const a = TRUST_BAND_RANK[actual ?? 'FLAGGED'] ?? 0;
  const m = TRUST_BAND_RANK[min] ?? 0;
  return a >= m;
}

function jsonDenial(status: number, code: string, message: string, next?: string): Response {
  // Round 25 supplement audit fix W10: delegate envelope shape to the
  // shared @aegis/types helper so the contract can never drift between
  // adapters. The cross-package parity test enforces every adapter calls
  // buildDenialEnvelope.
  const envelope = buildDenialEnvelope({
    error: code,
    message,
    statusCode: status,
    ...(next ? { next } : {}),
  });
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * App Router (`app/api/.../route.ts`) wrapper. The wrapped handler
 * receives the original `Request` plus an `AegisContext`. Denied
 * requests never reach the handler.
 *
 * Usage:
 *
 *   import { withAegis } from '@aegis/adapter-nextjs';
 *
 *   export const POST = withAegis(
 *     async (req, ctx) => {
 *       return Response.json({ approvedBy: ctx.agentId });
 *     },
 *     { minTrustBand: 'VERIFIED' },
 *   );
 */
export function withAegis<R extends Response = Response>(
  handler: (req: Request, ctx: AegisContext) => Promise<R> | R,
  options: WithAegisOptions = {},
): (req: Request) => Promise<Response> {
  const tokenHeader = options.tokenHeader ?? 'X-AEGIS-Token';
  const client = options.client ?? new Aegis();

  return async (req: Request): Promise<Response> => {
    const token = req.headers.get(tokenHeader);
    if (!token) {
      options.onDenial?.({ req, reason: 'missing_token' });
      return jsonDenial(
        401,
        'auth_required',
        `Missing ${tokenHeader} header.`,
        `Pass the AEGIS-signed token in the ${tokenHeader} header (see https://docs.aegislabs.io/errors/auth_required)`,
      );
    }
    let verify: VerifyResult;
    try {
      const ctx = options.deriveContext?.(req);
      verify = await client.verify(token, ctx);
    } catch (err: unknown) {
      const next = err instanceof AegisError ? err.next : undefined;
      const message = err instanceof Error ? err.message : 'AEGIS verify failed.';
      options.onDenial?.({ req, reason: 'verify_error' });
      return jsonDenial(502, 'service_unavailable', message, next);
    }
    if (!verify.valid || !verify.agentId || !verify.principalId) {
      options.onDenial?.({ req, reason: verify.denialReason ?? 'denied', verify });
      return jsonDenial(
        403,
        'forbidden',
        `AEGIS denied request: ${verify.denialReason ?? 'unknown'}`,
        'Inspect verify.denialReason and follow the matching docs/errors/<code> page',
      );
    }
    if (!meetsMinBand(verify.trustBand, options.minTrustBand)) {
      options.onDenial?.({ req, reason: 'trust_band_too_low', verify });
      return jsonDenial(
        403,
        'trust_score_too_low',
        `Agent trust band ${verify.trustBand} below required ${options.minTrustBand}.`,
        'Build agent reputation over time or lower minTrustBand for this route',
      );
    }
    const ctx: AegisContext = {
      verify,
      agentId: verify.agentId,
      principalId: verify.principalId,
      trustBand: verify.trustBand,
    };
    return handler(req, ctx);
  };
}

// ── Pages Router (Node-runtime API routes) ──────────────────────────────────

/**
 * Pages Router (`pages/api/*.ts`) wrapper. Uses Node's `req/res` shape
 * via lightweight structural types — keeps the package free of a hard
 * Next.js dependency at type-check time. Functionally identical to
 * `withAegis` for App Router.
 */
export interface NextPagesApiRequest {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
  body?: unknown;
}
export interface NextPagesApiResponse {
  status(code: number): NextPagesApiResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  end(body?: unknown): void;
}

export function withAegisPages(
  handler: (req: NextPagesApiRequest, res: NextPagesApiResponse, ctx: AegisContext) => Promise<void> | void,
  options: WithAegisOptions = {},
): (req: NextPagesApiRequest, res: NextPagesApiResponse) => Promise<void> {
  const tokenHeader = (options.tokenHeader ?? 'X-AEGIS-Token').toLowerCase();
  const client = options.client ?? new Aegis();

  return async (req, res) => {
    const raw = req.headers[tokenHeader];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) {
      res.status(401).setHeader('content-type', 'application/json');
      res.json({
        error: 'auth_required',
        message: `Missing ${tokenHeader} header.`,
        next: `Pass the AEGIS-signed token in the ${tokenHeader} header`,
      });
      return;
    }
    let verify: VerifyResult;
    try {
      verify = await client.verify(token);
    } catch (err: unknown) {
      const next = err instanceof AegisError ? err.next : undefined;
      const message = err instanceof Error ? err.message : 'AEGIS verify failed.';
      res.status(502).setHeader('content-type', 'application/json');
      res.json({
        error: 'service_unavailable',
        message,
        ...(next ? { next } : {}),
      });
      return;
    }
    if (!verify.valid || !verify.agentId || !verify.principalId) {
      res.status(403).setHeader('content-type', 'application/json');
      res.json({
        error: 'forbidden',
        message: `AEGIS denied request: ${verify.denialReason ?? 'unknown'}`,
      });
      return;
    }
    if (!meetsMinBand(verify.trustBand, options.minTrustBand)) {
      res.status(403).setHeader('content-type', 'application/json');
      res.json({
        error: 'trust_score_too_low',
        message: `Agent trust band ${verify.trustBand} below required ${options.minTrustBand}.`,
      });
      return;
    }
    await handler(req, res, {
      verify,
      agentId: verify.agentId,
      principalId: verify.principalId,
      trustBand: verify.trustBand,
    });
  };
}
