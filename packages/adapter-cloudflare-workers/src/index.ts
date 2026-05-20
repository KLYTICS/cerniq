// @aegis/adapter-cloudflare-workers — Round 25 seed, Round 26 lane.
//
// Cloudflare Workers expose Web Standards (Request/Response/fetch/
// crypto.subtle) — the same surface `@aegis/adapter-nextjs/middleware`
// targets. This package re-uses that core logic and tunes the defaults
// for the Workers shape: explicit `fetch(request, env, ctx)` handler,
// `env` bindings for the API key, and a passthrough-style return when
// verification succeeds.
//
// Why a dedicated package: bundling. Workers bundles refuse to pull in
// `node:` imports; this package's declared deps are SDK + workers-types
// only, so a downstream `wrangler deploy` cannot accidentally drag Node
// modules into the worker bundle.
//
// Usage (`src/worker.ts`):
//
//   import { wrapWorker } from '@aegis/adapter-cloudflare-workers';
//
//   export default wrapWorker({
//     minTrustBand: 'VERIFIED',
//     handler: async (req, ctx) => {
//       return Response.json({ approvedBy: ctx.agentId });
//     },
//   });
//
// The `env` bindings are read off the second argument to the worker's
// `fetch()` — set `AEGIS_API_KEY` in `wrangler.toml [vars]` (or as a
// secret via `wrangler secret put AEGIS_API_KEY`).

import { Aegis, type VerifyResult, AegisError, buildDenialEnvelope } from '@aegis/sdk';

export interface CloudflareEnv {
  /** AEGIS API key. Set via `wrangler secret put AEGIS_API_KEY`. */
  AEGIS_API_KEY?: string;
  /** Optional override of the AEGIS API endpoint. */
  AEGIS_API_URL?: string;
  /** Optional region selector. */
  AEGIS_REGION?: 'us' | 'eu' | 'apac' | 'auto';
  /** Catch-all for additional bindings the caller supplies. */
  [key: string]: unknown;
}

export interface CloudflareContext {
  verify: VerifyResult;
  agentId: string;
  principalId: string;
  trustBand: VerifyResult['trustBand'];
}

export interface WrapWorkerOptions {
  /** The route handler. Receives the original Request + the verified context. */
  handler: (req: Request, ctx: CloudflareContext, env: CloudflareEnv) => Promise<Response> | Response;
  /** Minimum acceptable trust band. Requests below get 403. */
  minTrustBand?: 'FLAGGED' | 'WATCH' | 'VERIFIED' | 'PLATINUM';
  /** Token header name. Default `X-AEGIS-Token`. */
  tokenHeader?: string;
  /** Optional context derivation for the verify call. */
  deriveContext?: (req: Request) => {
    action?: string;
    amount?: number;
    currency?: string;
    merchantDomain?: string;
    merchantId?: string;
  };
  /**
   * Optional override of which paths the wrapper gates. Requests outside
   * these prefixes pass straight to the handler with NO verification
   * (use sparingly — defaults to gating every request).
   */
  protectedPaths?: string[];
  /**
   * Pre-built Aegis client. When provided, env bindings are ignored.
   * Useful for tests and for callers that want to reuse a long-lived
   * client across requests in a single isolate. When omitted, the
   * wrapper builds a client from `env.AEGIS_API_KEY` / `env.AEGIS_API_URL`
   * / `env.AEGIS_REGION` on every request.
   */
  client?: Aegis;
}

const TRUST_BAND_RANK: Readonly<Record<string, number>> = Object.freeze({
  FLAGGED: 0,
  WATCH: 1,
  VERIFIED: 2,
  PLATINUM: 3,
});

function meetsMinBand(actual: VerifyResult['trustBand'], min: WrapWorkerOptions['minTrustBand']): boolean {
  if (!min) return true;
  return (TRUST_BAND_RANK[actual ?? 'FLAGGED'] ?? 0) >= (TRUST_BAND_RANK[min] ?? 0);
}

function isProtected(path: string, prefixes: string[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) return true;
  return prefixes.some((p) => path === p || path.startsWith(p));
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
 * Wrap a Workers fetch handler with AEGIS verification. Returns the
 * canonical `export default { fetch }` object Workers expects.
 */
export function wrapWorker(options: WrapWorkerOptions): { fetch: (req: Request, env: CloudflareEnv) => Promise<Response> } {
  const tokenHeader = options.tokenHeader ?? 'X-AEGIS-Token';

  return {
    async fetch(req: Request, env: CloudflareEnv): Promise<Response> {
      const url = new URL(req.url);
      // Build per-request Aegis client so each Worker invocation honors the
      // env-bound key. Workers reuse instances across requests, but the
      // `new Aegis()` here is cheap (no I/O) and avoids cross-request key
      // bleed when env changes. Test injection: `options.client` overrides.
      const client =
        options.client ??
        new Aegis({
          apiKey: env.AEGIS_API_KEY,
          ...(env.AEGIS_API_URL ? { baseUrl: env.AEGIS_API_URL } : {}),
          ...(env.AEGIS_REGION ? { region: env.AEGIS_REGION } : {}),
        });

      if (!isProtected(url.pathname, options.protectedPaths)) {
        // Construct a minimal pass-through context — handler still runs but
        // ctx is empty because no verification took place. Distinct from the
        // verified branch via the absence of `verify.valid`.
        return options.handler(req, {} as CloudflareContext, env);
      }

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

      return options.handler(
        req,
        {
          verify,
          agentId: verify.agentId,
          principalId: verify.principalId,
          trustBand: verify.trustBand,
        },
        env,
      );
    },
  };
}
