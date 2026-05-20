// Quickstart tests — uses an injected `fetch` stub so the test never
// touches a real AEGIS deployment. The stub recognizes 3 endpoints:
//   POST /v1/agents/register
//   GET  /v1/agents/<id>
//   POST /v1/agents/<id>/policies
// and returns canned successful responses.

import { quickstart } from './quickstart.js';
import { memoryKeyStorage } from './key-storage.js';

interface FetchCall {
  url: string;
  method: string;
}

function makeStubFetch() {
  const calls: FetchCall[] = [];
  // type-rationale: minimal Response shape that AegisHttpClient consumes.
  const stub: typeof globalThis.fetch = async (input, init): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method });

    let body: unknown;
    if (url.endsWith('/v1/agents/register') && method === 'POST') {
      body = {
        agentId: 'agt_test_1',
        publicKey: 'pub_b64u',
        principalId: 'prn_test',
        runtime: 'ANTHROPIC',
        status: 'ACTIVE',
        trustScore: 500,
        trustBand: 'VERIFIED',
        registeredAt: '2026-05-20T00:00:00.000Z',
      };
    } else if (/\/v1\/agents\/agt_test_1$/.test(url) && method === 'GET') {
      body = {
        agentId: 'agt_test_1',
        publicKey: 'pub_b64u',
        principalId: 'prn_test',
        runtime: 'ANTHROPIC',
        status: 'ACTIVE',
        trustScore: 500,
        trustBand: 'VERIFIED',
        registeredAt: '2026-05-20T00:00:00.000Z',
      };
    } else if (/\/v1\/agents\/.+\/policies$/.test(url) && method === 'POST') {
      body = {
        policyId: 'pol_test_1',
        signedToken: 'eyJsaWdodA==.payload.sig',
        expiresAt: '2026-05-21T00:00:00.000Z',
      };
    } else {
      return new Response(
        JSON.stringify({ error: 'NOT_FOUND', message: `stub: ${method} ${url}`, statusCode: 404, requestId: 'r' }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { stub, calls };
}

describe('Aegis.quickstart()', () => {
  it('generates a keypair on first run, registers, and mints a policy', async () => {
    const { stub, calls } = makeStubFetch();
    const storage = memoryKeyStorage();
    // Patch global fetch — the HttpClient uses it through the config option,
    // but to keep the stub injection minimal we pass it on the config.
    // The Aegis constructor reads `config.fetch`; quickstart passes neither.
    // We monkey-patch global fetch for the duration of the test.
    const origFetch = globalThis.fetch;
    globalThis.fetch = stub;
    try {
      const out = await quickstart({
        apiKey: 'aegis_sk_test',
        label: 'quickstart-test',
        storage,
        baseUrl: 'https://api.aegis.test',
      });
      expect(out.agent.agentId).toBe('agt_test_1');
      expect(out.policy.policyId).toBe('pol_test_1');
      expect(typeof out.sign).toBe('function');
      // Storage should now contain the keypair bound to the agentId.
      const stored = await storage.get('quickstart-test');
      expect(stored).toBeDefined();
      expect(stored?.agentId).toBe('agt_test_1');
      // Exactly one register call + one policy create.
      const registers = calls.filter((c) => c.url.endsWith('/v1/agents/register'));
      const policies = calls.filter((c) => c.url.includes('/policies') && c.method === 'POST');
      expect(registers).toHaveLength(1);
      expect(policies).toHaveLength(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('reuses a stored keypair on second run (no double-register)', async () => {
    const { stub, calls } = makeStubFetch();
    const storage = memoryKeyStorage();
    const origFetch = globalThis.fetch;
    globalThis.fetch = stub;
    try {
      await quickstart({ apiKey: 'k', label: 'reuse', storage, baseUrl: 'https://api.aegis.test' });
      calls.length = 0; // reset
      await quickstart({ apiKey: 'k', label: 'reuse', storage, baseUrl: 'https://api.aegis.test' });
      // Second call should GET the existing agent (no register).
      const registers = calls.filter((c) => c.url.endsWith('/v1/agents/register'));
      const gets = calls.filter(
        (c) => /\/v1\/agents\/agt_test_1$/.test(c.url) && c.method === 'GET',
      );
      expect(registers).toHaveLength(0);
      expect(gets).toHaveLength(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws a junior-friendly error when apiKey is missing', async () => {
    // Ensure env is clean for the test.
    const prev = process.env.AEGIS_API_KEY;
    delete process.env.AEGIS_API_KEY;
    try {
      await expect(quickstart({ storage: memoryKeyStorage() })).rejects.toThrow(
        /AEGIS_API_KEY/,
      );
    } finally {
      if (prev !== undefined) process.env.AEGIS_API_KEY = prev;
    }
  });

  it('reads apiKey from AEGIS_API_KEY env when not passed explicitly', async () => {
    const { stub } = makeStubFetch();
    const storage = memoryKeyStorage();
    const origFetch = globalThis.fetch;
    const origKey = process.env.AEGIS_API_KEY;
    globalThis.fetch = stub;
    process.env.AEGIS_API_KEY = 'aegis_sk_from_env';
    try {
      const out = await quickstart({
        label: 'env-test',
        storage,
        baseUrl: 'https://api.aegis.test',
      });
      expect(out.agent.agentId).toBe('agt_test_1');
    } finally {
      globalThis.fetch = origFetch;
      if (origKey === undefined) delete process.env.AEGIS_API_KEY;
      else process.env.AEGIS_API_KEY = origKey;
    }
  });
});
