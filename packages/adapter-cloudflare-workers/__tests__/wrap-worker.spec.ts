import { describe, expect, it, vi } from 'vitest';

import { wrapWorker, type CloudflareEnv } from '../src/index';

const VERIFIED_OK = {
  valid: true,
  agentId: 'agt_test',
  principalId: 'prn_test',
  trustScore: 700,
  trustBand: 'VERIFIED' as const,
  scopesGranted: ['commerce'],
  denialReason: null,
  verifiedAt: '2026-05-20T00:00:00.000Z',
  ttl: 30,
};

function stubClient(impl: (token: string) => Promise<unknown>): import('@aegis/sdk').Aegis {
  return { verify: vi.fn(impl) } as unknown as import('@aegis/sdk').Aegis;
}

const ENV: CloudflareEnv = { AEGIS_API_KEY: 'aegis_sk_test' };

describe('wrapWorker', () => {
  it('rejects with 401 when token header is missing', async () => {
    const worker = wrapWorker({
      handler: async () => new Response('ok'),
      client: stubClient(async () => VERIFIED_OK),
    });
    const res = await worker.fetch(new Request('https://w.test/x'), ENV);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('auth_required');
  });

  it('routes verified requests to the handler', async () => {
    const seen: string[] = [];
    const worker = wrapWorker({
      handler: async (_req, ctx) => {
        seen.push(ctx.agentId);
        return Response.json({ ok: true });
      },
      client: stubClient(async () => VERIFIED_OK),
    });
    const res = await worker.fetch(
      new Request('https://w.test/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual(['agt_test']);
  });

  it('rejects when trust band is below the minimum', async () => {
    const worker = wrapWorker({
      handler: async () => new Response('ok'),
      client: stubClient(async () => ({ ...VERIFIED_OK, trustBand: 'WATCH' as const })),
      minTrustBand: 'VERIFIED',
    });
    const res = await worker.fetch(
      new Request('https://w.test/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
      ENV,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('trust_score_too_low');
  });

  it('passes non-protected paths through with no verification', async () => {
    const reached = vi.fn(async () => new Response('ok'));
    const worker = wrapWorker({
      protectedPaths: ['/api/'],
      handler: reached,
      client: stubClient(async () => VERIFIED_OK),
    });
    const res = await worker.fetch(new Request('https://w.test/public'), ENV);
    expect(res.status).toBe(200);
    expect(reached).toHaveBeenCalled();
  });

  it('rejects with 403 when verify denies', async () => {
    const worker = wrapWorker({
      handler: async () => new Response('ok'),
      client: stubClient(async () => ({
        ...VERIFIED_OK,
        valid: false,
        denialReason: 'INVALID_SIGNATURE',
      })),
    });
    const res = await worker.fetch(
      new Request('https://w.test/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
      ENV,
    );
    expect(res.status).toBe(403);
  });

  it('returns 502 when verify throws', async () => {
    const worker = wrapWorker({
      handler: async () => new Response('ok'),
      client: stubClient(async () => {
        throw new Error('upstream down');
      }),
    });
    const res = await worker.fetch(
      new Request('https://w.test/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
      ENV,
    );
    expect(res.status).toBe(502);
  });
});
