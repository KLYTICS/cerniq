// @aegis/adapter-hono — Round 25 seed, Round 26 lane.
//
// Hono is a fast, edge-native web framework with its own middleware
// idiom: `app.use('*', mw)` where `mw` is `(c, next) => Promise<void>`.
// The adapter exposes `aegis()` as a Hono middleware factory.
//
// Edge-safe: the verify path uses only `@aegis/sdk` core (which uses
// `@noble/ed25519`), so this package runs on every runtime Hono targets
// — Cloudflare Workers, Vercel Edge, Deno, Bun, Node.
//
// Usage:
//
//   import { Hono } from 'hono';
//   import { aegis } from '@aegis/adapter-hono';
//
//   const app = new Hono();
//   app.use('/api/*', aegis({ minTrustBand: 'VERIFIED' }));
//   app.post('/api/purchase', (c) => {
//     const { agentId, principalId } = c.get('aegis');
//     return c.json({ approvedBy: agentId, principalId });
//   });
//
//   export default app;

import { Aegis, type VerifyResult, AegisError, buildDenialEnvelope } from '@aegis/sdk';
import type { Context, MiddlewareHandler } from 'hono';

export interface HonoAegisContext {
  verify: VerifyResult;
  agentId: string;
  principalId: string;
  trustBand: VerifyResult['trustBand'];
}

/**
 * Augment Hono's `Variables` typing so consumers can do
 * `c.get('aegis')` with full type narrowing.
 *
 *   const app = new Hono<{ Variables: AegisHonoVars }>();
 */
export interface AegisHonoVars {
  aegis: HonoAegisContext;
}

export interface AegisHonoOptions {
  /** Reuse an existing Aegis client. */
  client?: Aegis;
  /** Token header. Default `X-AEGIS-Token`. */
  tokenHeader?: string;
  /** Minimum trust band. */
  minTrustBand?: 'FLAGGED' | 'WATCH' | 'VERIFIED' | 'PLATINUM';
  /** Optional context derivation. Receives the Hono context. */
  deriveContext?: (c: Context) => {
    action?: string;
    amount?: number;
    currency?: string;
    merchantDomain?: string;
    merchantId?: string;
  };
}

const TRUST_BAND_RANK: Readonly<Record<string, number>> = Object.freeze({
  FLAGGED: 0,
  WATCH: 1,
  VERIFIED: 2,
  PLATINUM: 3,
});

function meetsMinBand(actual: VerifyResult['trustBand'], min: AegisHonoOptions['minTrustBand']): boolean {
  if (!min) return true;
  return (TRUST_BAND_RANK[actual ?? 'FLAGGED'] ?? 0) >= (TRUST_BAND_RANK[min] ?? 0);
}

/**
 * Hono middleware that gates downstream routes on AEGIS verification.
 *
 * On success: sets `c.var.aegis` (read via `c.get('aegis')`) and calls
 * `next()`. On any denial: returns the canonical AEGIS error envelope as
 * JSON and does NOT call `next()`.
 */
export function aegis(options: AegisHonoOptions = {}): MiddlewareHandler {
  const tokenHeader = options.tokenHeader ?? 'X-AEGIS-Token';
  const client = options.client ?? new Aegis();

  return async (c, next) => {
    // Round 25 supplement audit fix W10: shared envelope shape via @aegis/types.
    const token = c.req.header(tokenHeader);
    if (!token) {
      return c.json(
        buildDenialEnvelope({
          error: 'auth_required',
          message: `Missing ${tokenHeader} header.`,
          statusCode: 401,
          next: `Pass the AEGIS-signed token in the ${tokenHeader} header (https://docs.aegislabs.io/errors/auth_required)`,
        }),
        401,
      );
    }

    let verify: VerifyResult;
    try {
      const ctxInput = options.deriveContext?.(c);
      verify = await client.verify(token, ctxInput);
    } catch (err: unknown) {
      const next_ = err instanceof AegisError ? err.next : undefined;
      const message = err instanceof Error ? err.message : 'AEGIS verify failed.';
      return c.json(
        buildDenialEnvelope({
          error: 'service_unavailable',
          message,
          statusCode: 502,
          ...(next_ ? { next: next_ } : {}),
        }),
        502,
      );
    }

    if (!verify.valid || !verify.agentId || !verify.principalId) {
      return c.json(
        buildDenialEnvelope({
          error: 'forbidden',
          message: `AEGIS denied request: ${verify.denialReason ?? 'unknown'}`,
          statusCode: 403,
          next: 'Inspect verify.denialReason and follow the matching docs/errors/<code> page',
        }),
        403,
      );
    }

    if (!meetsMinBand(verify.trustBand, options.minTrustBand)) {
      return c.json(
        buildDenialEnvelope({
          error: 'trust_score_too_low',
          message: `Agent trust band ${verify.trustBand} below required ${options.minTrustBand}.`,
          statusCode: 403,
        }),
        403,
      );
    }

    // type-rationale: `c.set` is typed against the Hono Variables generic;
    // we cast through `unknown` since this middleware doesn't know the
    // caller's Variables shape at compile time. Consumers who want full
    // typing should declare `new Hono<{ Variables: AegisHonoVars }>()`.
    (c as unknown as { set: (key: 'aegis', value: HonoAegisContext) => void }).set('aegis', {
      verify,
      agentId: verify.agentId,
      principalId: verify.principalId,
      trustBand: verify.trustBand,
    });

    await next();
    return undefined;
  };
}
