// AEGIS verify hot path — Cloudflare Worker (Phase 3).
//
// Status: SCAFFOLD ONLY. Do not deploy until Phase 3 is unlocked.
//
// The Phase 3 contract:
//   1. Parse + sanity-check the inbound JWT (header.payload.sig shape).
//   2. Try KV: trust:{agentId} → cached agent record (60s TTL).
//   3. On KV hit, verify Ed25519 signature, run scope/spend evaluation
//      using `verify.algorithm.ts` shared with apps/api.
//   4. On KV miss OR any unexpected condition (revoked, expired policy
//      we don't have cached, etc.), call the origin `/v1/verify` and
//      forward the response.
//
// The Worker NEVER writes to the database. It reads KV and falls back to
// the origin. This preserves the property that policy revocation
// propagates to the edge in <60s by KV TTL — and immediately by the origin
// fallback when KV is stale and the agent is revoked.

import type { VerifyRequest, VerifyResponse } from '@aegis/types';

interface Env {
  TRUST_KV: KVNamespace;
  AEGIS_ORIGIN_URL: string;
  AEGIS_VERIFY_TIMEOUT_MS: string;
  AEGIS_FALLBACK_API_KEY: string;
  RATE_LIMITER: DurableObjectNamespace;
}

const NOT_IMPLEMENTED: VerifyResponse = {
  valid: false,
  agentId: null,
  principalId: null,
  trustScore: 0,
  trustBand: null,
  scopesGranted: [],
  denialReason: 'AGENT_NOT_FOUND',
  verifiedAt: new Date(0).toISOString(),
  ttl: 0,
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', edge: true });
    }

    if (url.pathname !== '/v1/verify' || req.method !== 'POST') {
      return new Response('Not Found', { status: 404 });
    }

    let body: VerifyRequest;
    try {
      body = (await req.json()) as VerifyRequest;
    } catch {
      return Response.json({ error: 'INVALID_REQUEST', message: 'Body must be JSON.' }, { status: 400 });
    }

    // Phase 3 milestone 1 — pure passthrough to origin while we build out
    // the edge cache. This keeps observability simple as we test edge
    // routing in production.
    return forwardToOrigin(env, body, ctx);
  },
};

async function forwardToOrigin(env: Env, body: VerifyRequest, ctx: ExecutionContext): Promise<Response> {
  const url = `${env.AEGIS_ORIGIN_URL.replace(/\/+$/, '')}/v1/verify`;
  const timeoutMs = parseInt(env.AEGIS_VERIFY_TIMEOUT_MS, 10);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 1500);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AEGIS-Verify-Key': env.AEGIS_FALLBACK_API_KEY,
        'X-AEGIS-Edge-Forward': '1',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'X-AEGIS-Edge': 'forward' },
    });
  } catch (err) {
    ctx.waitUntil(Promise.resolve()); // suppress unused-arg warning
    // eslint-disable-next-line no-console
    console.error('cf-verify origin fallback failed:', (err as Error).message);
    return Response.json({ ...NOT_IMPLEMENTED, denialReason: 'AGENT_NOT_FOUND' as const }, { status: 503 });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Edge rate limiter — Durable Object placeholder. Real implementation in
// Phase 3 will use the token bucket algorithm with per-key counters.
export class EdgeRateLimiter {
  constructor(_state: DurableObjectState, _env: Env) {
    // OPERATOR-INPUT-NEEDED: choose token-bucket vs. sliding-window semantics
    // and whether to strictly enforce or shadow-enforce while we observe.
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async fetch(_req: Request): Promise<Response> {
    return new Response('not implemented', { status: 501 });
  }
}
