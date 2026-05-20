import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { aegis, type AegisHonoVars } from '../src/index';

const VERIFIED_OK = {
  valid: true,
  agentId: 'agt_hono',
  principalId: 'prn_hono',
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

function buildApp(client: import('@aegis/sdk').Aegis, opts: Parameters<typeof aegis>[0] = {}) {
  const app = new Hono<{ Variables: AegisHonoVars }>();
  app.use('/api/*', aegis({ client, ...opts }));
  app.get('/api/whoami', (c) => {
    const a = c.get('aegis');
    return c.json({ agentId: a.agentId, principalId: a.principalId });
  });
  app.get('/public', (c) => c.text('public'));
  return app;
}

describe('aegis (Hono middleware)', () => {
  it('rejects with 401 when token is missing', async () => {
    const app = buildApp(stubClient(async () => VERIFIED_OK));
    const res = await app.request('/api/whoami');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; next?: string };
    expect(body.error).toBe('auth_required');
    expect(body.next).toBeTruthy();
  });

  it('routes verified requests to the handler with c.get("aegis")', async () => {
    const app = buildApp(stubClient(async () => VERIFIED_OK));
    const res = await app.request('/api/whoami', {
      headers: { 'X-AEGIS-Token': 'tok' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agentId: 'agt_hono', principalId: 'prn_hono' });
  });

  it('does not gate routes outside the matcher', async () => {
    const app = buildApp(stubClient(async () => VERIFIED_OK));
    const res = await app.request('/public');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('public');
  });

  it('rejects with 403 on denial', async () => {
    const app = buildApp(
      stubClient(async () => ({ ...VERIFIED_OK, valid: false, denialReason: 'AGENT_REVOKED' })),
    );
    const res = await app.request('/api/whoami', {
      headers: { 'X-AEGIS-Token': 'tok' },
    });
    expect(res.status).toBe(403);
  });

  it('enforces minTrustBand', async () => {
    const app = buildApp(
      stubClient(async () => ({ ...VERIFIED_OK, trustBand: 'WATCH' as const })),
      { minTrustBand: 'VERIFIED' },
    );
    const res = await app.request('/api/whoami', {
      headers: { 'X-AEGIS-Token': 'tok' },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('trust_score_too_low');
  });

  it('returns 502 when verify throws', async () => {
    const app = buildApp(
      stubClient(async () => {
        throw new Error('upstream down');
      }),
    );
    const res = await app.request('/api/whoami', {
      headers: { 'X-AEGIS-Token': 'tok' },
    });
    expect(res.status).toBe(502);
  });
});
