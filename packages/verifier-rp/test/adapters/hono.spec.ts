import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okoroHonoMiddleware } from '../../src/adapters/hono.js';
import { OkoroVerifier } from '../../src/verifier.js';
import { generateKeypair, signTestToken } from '../_helpers/sign.js';

function fakeRes(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => json,
  } as unknown as Response;
}

afterEach(() => vi.restoreAllMocks());

describe('hono adapter', () => {
  it('verifies and sets c.var', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const fetchMock = vi.fn(async () =>
      fakeRes({
        agentId: 'agt_a',
        status: 'active',
        trustScore: 700,
        trustBand: 'VERIFIED',
      }),
    );
    const verifier = new OkoroVerifier({
      baseUrl: 'https://api.example.com/v1',
      getAgentPublicKey: async () => publicKey,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    const app = new Hono();
    app.use('*', okoroHonoMiddleware({ verifier }));
    app.get('/p', (c) => {
      // type-rationale: variables map is dynamic at runtime.
      const okoro = c.get('okoro' as never) as { agentId: string };
      return c.json({ agentId: okoro.agentId });
    });

    const token = await signTestToken(privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    const res = await app.request('/p', {
      headers: { 'X-OKORO-Token': token },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agentId: string };
    expect(body.agentId).toBe('agt_a');
  });

  it('returns 401 when token missing', async () => {
    const { publicKey } = await generateKeypair();
    const fetchMock = vi.fn(async () => fakeRes({}));
    const verifier = new OkoroVerifier({
      baseUrl: 'https://api.example.com/v1',
      getAgentPublicKey: async () => publicKey,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    const app = new Hono();
    app.use('*', okoroHonoMiddleware({ verifier }));
    app.get('/p', (c) => c.json({ ok: true }));
    const res = await app.request('/p');
    expect(res.status).toBe(401);
  });
});
