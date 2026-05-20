// @aegis/adapter-vercel-edge — Round 25 seed, Round 26 lane.
//
// Vercel Edge Functions are Web-standard Request/Response handlers
// running on V8 isolates. The shape is the same as Cloudflare Workers
// (so this package's core mirrors `@aegis/adapter-cloudflare-workers`)
// but the developer-facing surface differs:
//
//   - Vercel Edge Functions live at `api/<route>.ts` with a default
//     export of `(request: Request) => Response | Promise<Response>`
//     and an exported `config = { runtime: 'edge' }`.
//   - Env vars come from `process.env.AEGIS_API_KEY` at build time
//     (Vercel injects them at deploy; no `env` arg like Workers).
//
// Usage (`api/protected.ts`):
//
//   import { wrapEdgeFunction } from '@aegis/adapter-vercel-edge';
//
//   export const config = { runtime: 'edge' };
//   export default wrapEdgeFunction({
//     minTrustBand: 'VERIFIED',
//     handler: async (req, ctx) => Response.json({ approvedBy: ctx.agentId }),
//   });
//
// For Next.js `middleware.ts` use `@aegis/adapter-nextjs/middleware`
// instead — that file IS Edge Middleware, with the Next-specific config
// matcher pattern already wired.

import { Aegis, type VerifyResult, AegisError, buildDenialEnvelope } from '@aegis/sdk';

export interface EdgeContext {
  verify: VerifyResult;
  agentId: string;
  principalId: string;
  trustBand: VerifyResult['trustBand'];
}

export interface WrapEdgeFunctionOptions {
  /** The Edge Function handler. Receives the Request + verified context. */
  handler: (req: Request, ctx: EdgeContext) => Promise<Response> | Response;
  /** Minimum trust band; default none (any successful verify passes). */
  minTrustBand?: 'FLAGGED' | 'WATCH' | 'VERIFIED' | 'PLATINUM';
  /** Token header. Default `X-AEGIS-Token`. */
  tokenHeader?: string;
  /** Optional context derivation. */
  deriveContext?: (req: Request) => {
    action?: string;
    amount?: number;
    currency?: string;
    merchantDomain?: string;
    merchantId?: string;
  };
  /**
   * Reuse a pre-built Aegis client. Useful in dev/test; production
   * usually omits this and lets the wrapper build from env.
   */
  client?: Aegis;
}

const TRUST_BAND_RANK: Readonly<Record<string, number>> = Object.freeze({
  FLAGGED: 0,
  WATCH: 1,
  VERIFIED: 2,
  PLATINUM: 3,
});

function meetsMinBand(actual: VerifyResult['trustBand'], min: WrapEdgeFunctionOptions['minTrustBand']): boolean {
  if (!min) return true;
  return (TRUST_BAND_RANK[actual ?? 'FLAGGED'] ?? 0) >= (TRUST_BAND_RANK[min] ?? 0);
}

function denial(status: number, code: string, message: string, next?: string): Response {
  // Round 25 supplement audit fix W10: shared envelope shape via @aegis/types.
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
 * Wrap an Edge Function handler with AEGIS verification.
 *
 * Returns a function with the canonical Vercel Edge shape
 * `(req: Request) => Promise<Response>`. Use as the `default export`
 * of an `api/*.ts` file alongside `export const config = { runtime: 'edge' }`.
 */
export function wrapEdgeFunction(
  options: WrapEdgeFunctionOptions,
): (req: Request) => Promise<Response> {
  const tokenHeader = options.tokenHeader ?? 'X-AEGIS-Token';
  const client = options.client ?? new Aegis();

  return async (req: Request): Promise<Response> => {
    const token = req.headers.get(tokenHeader);
    if (!token) {
      return denial(
        401,
        'auth_required',
        `Missing ${tokenHeader} header.`,
        `Pass the AEGIS-signed token in the ${tokenHeader} header (https://docs.aegislabs.io/errors/auth_required)`,
      );
    }

    let verify: VerifyResult;
    try {
      const ctxInput = options.deriveContext?.(req);
      verify = await client.verify(token, ctxInput);
    } catch (err: unknown) {
      const next = err instanceof AegisError ? err.next : undefined;
      const message = err instanceof Error ? err.message : 'AEGIS verify failed.';
      return denial(502, 'service_unavailable', message, next);
    }

    if (!verify.valid || !verify.agentId || !verify.principalId) {
      return denial(
        403,
        'forbidden',
        `AEGIS denied request: ${verify.denialReason ?? 'unknown'}`,
        'Inspect verify.denialReason and follow the matching docs/errors/<code> page',
      );
    }

    if (!meetsMinBand(verify.trustBand, options.minTrustBand)) {
      return denial(
        403,
        'trust_score_too_low',
        `Agent trust band ${verify.trustBand} below required ${options.minTrustBand}.`,
      );
    }

    return options.handler(req, {
      verify,
      agentId: verify.agentId,
      principalId: verify.principalId,
      trustBand: verify.trustBand,
    });
  };
}
