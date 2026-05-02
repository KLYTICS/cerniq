import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aegisGuard } from '../../src/adapters/express.js';
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

async function setupApp(opts?: { suspended?: boolean }): Promise<{
  app: express.Express;
  privateKey: Uint8Array;
}> {
  const { privateKey, publicKey } = await generateKeypair();
  const fetchMock = vi.fn(async () =>
    fakeRes({
      agentId: 'agt_a',
      status: opts?.suspended ? 'suspended' : 'active',
      trustScore: 700,
      trustBand: 'VERIFIED',
    }),
  );
  const verifier = new AegisVerifier({
    baseUrl: 'https://api.example.com/v1',
    getAgentPublicKey: async () => publicKey,
    fetch: fetchMock as unknown as typeof globalThis.fetch,
  });

  const app = express();
  app.get('/protected', aegisGuard({ verifier }), (req, res) => {
    // type-rationale: req.aegis is dynamically attached by the guard.
    const aegis = (req as unknown as Record<string, unknown>).aegis;
    res.json({ ok: true, aegis });
  });
  return { app, privateKey };
}

async function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      // type-rationale: AddressInfo lookup on listening server returns object form.
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

describe('express adapter', () => {
  it('passes valid token through and attaches outcome', async () => {
    const { app, privateKey } = await setupApp();
    const { url, close } = await listen(app);
    try {
      const token = await signTestToken(privateKey, 'agt_a', 'pol_a', {
        action: 'commerce.purchase',
      });
      const res = await fetch(`${url}/protected`, {
        headers: { 'X-AEGIS-Token': token },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; aegis: { agentId: string } };
      expect(body.ok).toBe(true);
      expect(body.aegis.agentId).toBe('agt_a');
    } finally {
      await close();
    }
  });

  it('returns 401 when token missing', async () => {
    const { app } = await setupApp();
    const { url, close } = await listen(app);
    try {
      const res = await fetch(`${url}/protected`);
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('returns 401 with reason on suspended agent', async () => {
    const { app, privateKey } = await setupApp({ suspended: true });
    const { url, close } = await listen(app);
    try {
      const token = await signTestToken(privateKey, 'agt_a', 'pol_a', {
        action: 'commerce.purchase',
      });
      const res = await fetch(`${url}/protected`, {
        headers: { 'X-AEGIS-Token': token },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { reason: string };
      expect(body.reason).toBe('AGENT_REVOKED');
    } finally {
      await close();
    }
  });
});
