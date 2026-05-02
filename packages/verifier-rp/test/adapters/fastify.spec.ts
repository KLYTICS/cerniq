import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachAegisGuard } from '../../src/adapters/fastify.js';
import { AegisVerifier } from '../../src/verifier.js';
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

describe('fastify adapter', () => {
  it('verifies and decorates request', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const fetchMock = vi.fn(async () =>
      fakeRes({
        agentId: 'agt_a',
        status: 'active',
        trustScore: 700,
        trustBand: 'VERIFIED',
      }),
    );
    const verifier = new AegisVerifier({
      baseUrl: 'https://api.example.com/v1',
      getAgentPublicKey: async () => publicKey,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    const app = Fastify({ logger: false });
    attachAegisGuard(app, { verifier });
    app.get('/p', async (req) => {
      // type-rationale: the plugin attaches aegis dynamically.
      const aegis = (req as unknown as Record<string, unknown>).aegis;
      return { aegis };
    });

    const token = await signTestToken(privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/p',
      headers: { 'x-aegis-token': token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { aegis: { agentId: string } };
    expect(body.aegis.agentId).toBe('agt_a');
    await app.close();
  });

  it('returns 401 when token missing', async () => {
    const { publicKey } = await generateKeypair();
    const fetchMock = vi.fn(async () => fakeRes({}));
    const verifier = new AegisVerifier({
      baseUrl: 'https://api.example.com/v1',
      getAgentPublicKey: async () => publicKey,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    const app = Fastify({ logger: false });
    attachAegisGuard(app, { verifier });
    app.get('/p', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/p' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
