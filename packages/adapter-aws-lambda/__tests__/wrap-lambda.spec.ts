import { describe, expect, it, vi } from 'vitest';

import { wrapLambda, type LambdaEvent } from '../src/index';

const VERIFIED_OK = {
  valid: true,
  agentId: 'agt_lambda',
  principalId: 'prn_lambda',
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

const apiGatewayV2Event = (token?: string): LambdaEvent => ({
  headers: token ? { 'x-aegis-token': token } : {},
  body: null,
  requestContext: { http: { path: '/api/x', method: 'POST' } },
});

const apiGatewayV1Event = (token?: string): LambdaEvent => ({
  headers: token ? { 'X-AEGIS-Token': token } : {},
  body: null,
  path: '/api/x',
  httpMethod: 'POST',
});

const albMultiValueEvent = (token?: string): LambdaEvent => ({
  multiValueHeaders: token ? { 'x-aegis-token': [token] } : {},
  body: null,
});

describe('wrapLambda', () => {
  it('rejects with 401 when token is missing', async () => {
    const handler = wrapLambda({
      handler: async () => ({ statusCode: 200, body: 'ok' }),
      client: stubClient(async () => VERIFIED_OK),
    });
    const res = await handler(apiGatewayV2Event());
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error: string; next?: string };
    expect(body.error).toBe('auth_required');
    expect(body.next).toBeTruthy();
  });

  it('handles API Gateway v2 (lowercase header)', async () => {
    const seen: string[] = [];
    const handler = wrapLambda({
      handler: async (_e, ctx) => {
        seen.push(ctx.aegis.agentId);
        return { statusCode: 200, body: 'ok' };
      },
      client: stubClient(async () => VERIFIED_OK),
    });
    const res = await handler(apiGatewayV2Event('tok'));
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual(['agt_lambda']);
  });

  it('handles API Gateway v1 (uppercase header)', async () => {
    const handler = wrapLambda({
      handler: async () => ({ statusCode: 200, body: 'ok' }),
      client: stubClient(async () => VERIFIED_OK),
    });
    const res = await handler(apiGatewayV1Event('tok'));
    expect(res.statusCode).toBe(200);
  });

  it('handles ALB multi-value headers', async () => {
    const handler = wrapLambda({
      handler: async () => ({ statusCode: 200, body: 'ok' }),
      client: stubClient(async () => VERIFIED_OK),
    });
    const res = await handler(albMultiValueEvent('tok'));
    expect(res.statusCode).toBe(200);
  });

  it('rejects when verify denies', async () => {
    const handler = wrapLambda({
      handler: async () => ({ statusCode: 200, body: 'ok' }),
      client: stubClient(async () => ({
        ...VERIFIED_OK,
        valid: false,
        denialReason: 'AGENT_REVOKED',
      })),
    });
    const res = await handler(apiGatewayV2Event('tok'));
    expect(res.statusCode).toBe(403);
  });

  it('enforces minTrustBand', async () => {
    const handler = wrapLambda({
      handler: async () => ({ statusCode: 200, body: 'ok' }),
      client: stubClient(async () => ({ ...VERIFIED_OK, trustBand: 'WATCH' as const })),
      minTrustBand: 'VERIFIED',
    });
    const res = await handler(apiGatewayV2Event('tok'));
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toBe('trust_score_too_low');
  });

  it('returns 502 when verify throws', async () => {
    const handler = wrapLambda({
      handler: async () => ({ statusCode: 200, body: 'ok' }),
      client: stubClient(async () => {
        throw new Error('upstream down');
      }),
    });
    const res = await handler(apiGatewayV2Event('tok'));
    expect(res.statusCode).toBe(502);
  });
});
