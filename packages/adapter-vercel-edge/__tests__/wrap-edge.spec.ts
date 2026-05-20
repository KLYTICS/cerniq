import { describe, expect, it, vi } from 'vitest';

import { wrapEdgeFunction } from '../src/index';

const VERIFIED_OK = {
  valid: true,
  agentId: 'agt_v',
  principalId: 'prn_v',
  trustScore: 700,
  trustBand: 'VERIFIED' as const,
  scopesGranted: [],
  denialReason: null,
  verifiedAt: '2026-05-20T00:00:00.000Z',
  ttl: 30,
};

function stubClient(impl: (token: string) => Promise<unknown>): import('@aegis/sdk').Aegis {
  return { verify: vi.fn(impl) } as unknown as import('@aegis/sdk').Aegis;
}

describe('wrapEdgeFunction', () => {
  it('rejects with 401 when token is missing', async () => {
    const handler = wrapEdgeFunction({
      handler: async () => new Response('ok'),
      client: stubClient(async () => VERIFIED_OK),
    });
    const res = await handler(new Request('https://v.test/api/x'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; next?: string };
    expect(body.error).toBe('auth_required');
    expect(body.next).toBeTruthy();
  });

  it('routes verified requests to the handler', async () => {
    const seen: string[] = [];
    const handler = wrapEdgeFunction({
      handler: async (_req, ctx) => {
        seen.push(ctx.agentId);
        return Response.json({ ok: true });
      },
      client: stubClient(async () => VERIFIED_OK),
    });
    const res = await handler(
      new Request('https://v.test/api/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual(['agt_v']);
  });

  it('rejects with 403 when verify returns invalid', async () => {
    const handler = wrapEdgeFunction({
      handler: async () => new Response('ok'),
      client: stubClient(async () => ({
        ...VERIFIED_OK,
        valid: false,
        denialReason: 'POLICY_EXPIRED',
      })),
    });
    const res = await handler(
      new Request('https://v.test/api/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res.status).toBe(403);
  });

  it('enforces minTrustBand', async () => {
    const handler = wrapEdgeFunction({
      handler: async () => new Response('ok'),
      client: stubClient(async () => ({ ...VERIFIED_OK, trustBand: 'WATCH' as const })),
      minTrustBand: 'VERIFIED',
    });
    const res = await handler(
      new Request('https://v.test/api/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('trust_score_too_low');
  });

  it('returns 502 when verify throws', async () => {
    const handler = wrapEdgeFunction({
      handler: async () => new Response('ok'),
      client: stubClient(async () => {
        throw new Error('upstream down');
      }),
    });
    const res = await handler(
      new Request('https://v.test/api/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res.status).toBe(502);
  });
});
