import { describe, expect, it, vi } from 'vitest';

import { withAegis, withAegisPages } from '../src/index';

// Minimal mock for the Aegis client surface the adapter uses.
function makeStubClient(verifyImpl: (token: string) => Promise<unknown>): import('@aegis/sdk').Aegis {
  return { verify: vi.fn(verifyImpl) } as unknown as import('@aegis/sdk').Aegis;
}

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

describe('withAegis (App Router)', () => {
  it('rejects with 401 when token header is missing', async () => {
    const handler = withAegis(async () => new Response('ok'), {
      client: makeStubClient(async () => VERIFIED_OK),
    });
    const res = await handler(new Request('https://example.test/api/x'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; next?: string };
    expect(body.error).toBe('auth_required');
    expect(body.next).toBeTruthy();
  });

  it('passes through to the handler when verify succeeds', async () => {
    const seen: Array<{ agentId: string; principalId: string }> = [];
    const handler = withAegis(
      async (_req, ctx) => {
        seen.push({ agentId: ctx.agentId, principalId: ctx.principalId });
        return new Response(JSON.stringify({ ok: true }));
      },
      { client: makeStubClient(async () => VERIFIED_OK) },
    );
    const res = await handler(
      new Request('https://example.test/api/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ agentId: 'agt_test', principalId: 'prn_test' }]);
  });

  it('rejects with 403 when verify returns invalid', async () => {
    const denial = { ...VERIFIED_OK, valid: false, denialReason: 'INVALID_SIGNATURE' };
    const handler = withAegis(async () => new Response('ok'), {
      client: makeStubClient(async () => denial),
    });
    const res = await handler(
      new Request('https://example.test/api/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('forbidden');
    expect(body.message).toContain('INVALID_SIGNATURE');
  });

  it('rejects when actual trust band is below minimum', async () => {
    const watch = { ...VERIFIED_OK, trustBand: 'WATCH' as const };
    const handler = withAegis(async () => new Response('ok'), {
      client: makeStubClient(async () => watch),
      minTrustBand: 'VERIFIED',
    });
    const res = await handler(
      new Request('https://example.test/api/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('trust_score_too_low');
  });

  it('admits PLATINUM when minimum is VERIFIED', async () => {
    const platinum = { ...VERIFIED_OK, trustBand: 'PLATINUM' as const };
    const handler = withAegis(async () => new Response('ok'), {
      client: makeStubClient(async () => platinum),
      minTrustBand: 'VERIFIED',
    });
    const res = await handler(
      new Request('https://example.test/api/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res.status).toBe(200);
  });

  it('uses a custom token header when configured', async () => {
    const handler = withAegis(async () => new Response('ok'), {
      client: makeStubClient(async () => VERIFIED_OK),
      tokenHeader: 'X-My-Token',
    });
    const res = await handler(
      new Request('https://example.test/api/x', { headers: { 'X-My-Token': 'tok' } }),
    );
    expect(res.status).toBe(200);
  });

  it('passes deriveContext output into verify()', async () => {
    const verifyMock = vi.fn(async () => VERIFIED_OK);
    const handler = withAegis(async () => new Response('ok'), {
      client: { verify: verifyMock } as unknown as import('@aegis/sdk').Aegis,
      deriveContext: () => ({ action: 'commerce.purchase', amount: 50, currency: 'USD' }),
    });
    await handler(
      new Request('https://example.test/api/buy', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(verifyMock).toHaveBeenCalledWith('tok', {
      action: 'commerce.purchase',
      amount: 50,
      currency: 'USD',
    });
  });

  it('returns 502 with a service_unavailable code when verify throws', async () => {
    const handler = withAegis(async () => new Response('ok'), {
      client: makeStubClient(async () => {
        throw new Error('network down');
      }),
    });
    const res = await handler(
      new Request('https://example.test/api/x', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('service_unavailable');
  });

  it('fires onDenial with the denial reason', async () => {
    const denials: string[] = [];
    const handler = withAegis(async () => new Response('ok'), {
      client: makeStubClient(async () => VERIFIED_OK),
      onDenial: ({ reason }) => denials.push(reason),
    });
    await handler(new Request('https://example.test/api/x'));
    expect(denials).toEqual(['missing_token']);
  });
});

describe('withAegisPages (Pages Router)', () => {
  function makeRes() {
    const calls: { status?: number; headers: Record<string, string>; body?: unknown } = {
      headers: {},
    };
    const res = {
      status(code: number) {
        calls.status = code;
        return res;
      },
      setHeader(name: string, value: string) {
        calls.headers[name] = value;
      },
      json(body: unknown) {
        calls.body = body;
      },
      end() {
        // no-op
      },
    };
    return { res, calls };
  }

  it('routes to handler on success', async () => {
    const reached = vi.fn(async () => undefined);
    const wrapped = withAegisPages(reached, {
      client: makeStubClient(async () => VERIFIED_OK),
    });
    const { res } = makeRes();
    await wrapped({ headers: { 'x-aegis-token': 'tok' } }, res);
    expect(reached).toHaveBeenCalled();
  });

  it('rejects with 401 when token is missing', async () => {
    const reached = vi.fn(async () => undefined);
    const wrapped = withAegisPages(reached, {
      client: makeStubClient(async () => VERIFIED_OK),
    });
    const { res, calls } = makeRes();
    await wrapped({ headers: {} }, res);
    expect(calls.status).toBe(401);
    expect(reached).not.toHaveBeenCalled();
  });
});
