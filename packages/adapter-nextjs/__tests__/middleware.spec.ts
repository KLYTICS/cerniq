import { describe, expect, it, vi } from 'vitest';

import { aegisMiddleware, buildIdentityHeaders } from '../src/middleware';

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

function makeStubClient(verifyImpl: (token: string) => Promise<unknown>): import('@aegis/sdk').Aegis {
  return { verify: vi.fn(verifyImpl) } as unknown as import('@aegis/sdk').Aegis;
}

describe('aegisMiddleware', () => {
  it('passes through requests outside the protected prefixes', async () => {
    const mw = aegisMiddleware({
      client: makeStubClient(async () => VERIFIED_OK),
      protectedPaths: ['/api/'],
    });
    const res = await mw(new Request('https://example.test/public/home'));
    expect(res).toBeUndefined();
  });

  it('rejects protected requests missing the token header', async () => {
    const mw = aegisMiddleware({
      client: makeStubClient(async () => VERIFIED_OK),
      protectedPaths: ['/api/'],
    });
    const res = await mw(new Request('https://example.test/api/secret'));
    expect(res?.status).toBe(401);
  });

  it('passes a verified request through (returns undefined)', async () => {
    const mw = aegisMiddleware({
      client: makeStubClient(async () => VERIFIED_OK),
      protectedPaths: ['/api/'],
    });
    const res = await mw(
      new Request('https://example.test/api/secret', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res).toBeUndefined();
  });

  it('rejects with 403 when verify denies', async () => {
    const mw = aegisMiddleware({
      client: makeStubClient(async () => ({
        ...VERIFIED_OK,
        valid: false,
        denialReason: 'POLICY_EXPIRED',
      })),
      protectedPaths: ['/api/'],
    });
    const res = await mw(
      new Request('https://example.test/api/secret', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res?.status).toBe(403);
  });

  it('enforces minTrustBand', async () => {
    const mw = aegisMiddleware({
      client: makeStubClient(async () => ({ ...VERIFIED_OK, trustBand: 'WATCH' as const })),
      protectedPaths: ['/api/'],
      minTrustBand: 'VERIFIED',
    });
    const res = await mw(
      new Request('https://example.test/api/secret', { headers: { 'X-AEGIS-Token': 'tok' } }),
    );
    expect(res?.status).toBe(403);
  });

  it('default protectedPaths = undefined gates all paths', async () => {
    const mw = aegisMiddleware({
      client: makeStubClient(async () => VERIFIED_OK),
    });
    const res = await mw(new Request('https://example.test/anything'));
    expect(res?.status).toBe(401); // no token
  });
});

describe('buildIdentityHeaders', () => {
  it('returns the canonical agentId + principalId headers', () => {
    expect(buildIdentityHeaders(VERIFIED_OK)).toEqual({
      'X-AEGIS-Agent-Id': 'agt_test',
      'X-AEGIS-Principal-Id': 'prn_test',
    });
  });

  it('honors custom header names', () => {
    expect(
      buildIdentityHeaders(VERIFIED_OK, {
        agentIdHeader: 'X-Aid',
        principalIdHeader: 'X-Pid',
      }),
    ).toEqual({ 'X-Aid': 'agt_test', 'X-Pid': 'prn_test' });
  });

  it('omits headers for null id fields', () => {
    expect(
      buildIdentityHeaders({ ...VERIFIED_OK, agentId: null, principalId: null }),
    ).toEqual({});
  });
});
