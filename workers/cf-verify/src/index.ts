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

import { edgeVerify } from './edge-verify';
import { makeKvCache } from './kv-cache';
import { shadowMode, compareVerifyResponses, divergenceHeader, recordDivergence, type AnalyticsEngineLike } from './shadow';

interface Env {
  TRUST_KV: KVNamespace;
  AEGIS_ORIGIN_URL: string;
  AEGIS_VERIFY_TIMEOUT_MS: string;
  AEGIS_FALLBACK_API_KEY: string;
  /** Set "true" to enable the KV-cache edge verify (Phase 3 m2). Defaults off. */
  AEGIS_EDGE_VERIFY_ENABLED?: string;
  /** Set "true" to enable shadow comparison without serving edge results. */
  AEGIS_EDGE_VERIFY_SHADOW_MODE?: string;
  RATE_LIMITER: DurableObjectNamespace;
  /** Optional Workers Analytics Engine binding for divergence telemetry. */
  CF_VERIFY_DIVERGENCE?: AnalyticsEngineLike;
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
      body = (await req.json());
    } catch {
      return Response.json({ error: 'INVALID_REQUEST', message: 'Body must be JSON.' }, { status: 400 });
    }

    // Phase 3 milestone 2 — three-mode rollout: off / shadow / live.
    const mode = shadowMode(env);

    if (mode === 'live') {
      const cache = makeKvCache(env.TRUST_KV);
      const result = await edgeVerify(body, cache);
      if (result.outcome === 'decided' && result.response) {
        return new Response(JSON.stringify(result.response), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-AEGIS-Edge': result.response.valid ? 'edge-allow' : 'edge-deny',
          },
        });
      }
      // outcome === 'forward' — fall through to origin
      return await forwardToOrigin(env, body, ctx);
    }

    if (mode === 'shadow') {
      // Run edge AND origin in parallel; serve origin; record divergence.
      const cache = makeKvCache(env.TRUST_KV);
      const [edgeResult, originResp] = await Promise.all([
        edgeVerify(body, cache).catch(() => ({ outcome: 'forward' as const })),
        forwardToOrigin(env, body, ctx),
      ]);
      // Don't try to read origin body twice — clone for parsing, return original.
      let originParsed: VerifyResponse | null = null;
      try {
        originParsed = (await originResp.clone().json());
      } catch {
        originParsed = null;
      }
      let header = 'agree';
      if (edgeResult.outcome === 'forward' || !edgeResult.response) {
        header = divergenceHeader({ edgeForwarded: true });
        recordDivergence(env.CF_VERIFY_DIVERGENCE, { edgeForwarded: true }, {
          agentId: originParsed?.agentId ?? null,
          denialReason: originParsed?.denialReason ?? null,
        });
      } else if (originParsed) {
        const report = compareVerifyResponses(edgeResult.response, originParsed);
        header = divergenceHeader(report);
        recordDivergence(env.CF_VERIFY_DIVERGENCE, report, {
          agentId: originParsed.agentId,
          denialReason: originParsed.denialReason,
        });
      }
      // Reconstruct response so we can append headers cleanly.
      const headers = new Headers(originResp.headers);
      headers.set('X-AEGIS-Edge-Divergence', header);
      headers.set('X-AEGIS-Edge', 'shadow');
      return new Response(originResp.body, { status: originResp.status, headers });
    }

    // mode === 'off'
    return await forwardToOrigin(env, body, ctx);
  },
};

async function forwardToOrigin(env: Env, body: VerifyRequest, ctx: ExecutionContext): Promise<Response> {
  const url = `${env.AEGIS_ORIGIN_URL.replace(/\/+$/, '')}/v1/verify`;
  const timeoutMs = parseInt(env.AEGIS_VERIFY_TIMEOUT_MS, 10);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, Number.isFinite(timeoutMs) ? timeoutMs : 1500);

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
     
    console.error('cf-verify origin fallback failed:', (err as Error).message);
    return Response.json({ ...NOT_IMPLEMENTED, denialReason: 'AGENT_NOT_FOUND' as const }, { status: 503 });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Edge rate limiter — Durable Object placeholder. Real implementation in
// Phase 3 will use the token bucket algorithm with per-key counters.
export class EdgeRateLimiter {
  // OPERATOR-INPUT-NEEDED: choose token-bucket vs. sliding-window semantics
  // and whether to strictly enforce or shadow-enforce while we observe.

  // eslint-disable-next-line @typescript-eslint/require-await
  async fetch(_req: Request): Promise<Response> {
    return new Response('not implemented', { status: 501 });
  }
}
