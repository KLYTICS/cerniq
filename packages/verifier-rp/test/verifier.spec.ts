import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CerniqVerifier } from '../src/verifier.js';
import { ConfigError } from '../src/errors.js';
import { resetClock, setClock } from '../src/_internal/time.js';
import { generateKeypair, signTestToken, tamperToken } from './_helpers/sign.js';

function fakeRes(json: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'ERR',
    json: async () => json,
  } as unknown as Response;
}

interface TestKeys {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

async function makeVerifier(opts: {
  keys: TestKeys;
  status?: {
    status: 'active' | 'suspended' | 'revoked' | 'pending_verification';
    trustScore?: number;
  };
}): Promise<{ verifier: CerniqVerifier; fetchMock: ReturnType<typeof vi.fn> }> {
  const status = opts.status ?? { status: 'active' };
  const fetchMock = vi.fn(async (url: string | URL) => {
    if (String(url).includes('/agents/')) {
      return fakeRes({
        agentId: 'agt_a',
        status: status.status,
        trustScore: status.trustScore ?? 700,
        trustBand: 'VERIFIED',
      });
    }
    return fakeRes({ keys: [] });
  });
  const verifier = new CerniqVerifier({
    baseUrl: 'https://api.example.com/v1',
    getAgentPublicKey: async () => opts.keys.publicKey,
    fetch: fetchMock as unknown as typeof globalThis.fetch,
  });
  return { verifier, fetchMock };
}

describe('CerniqVerifier', () => {
  let keys: TestKeys;

  beforeEach(async () => {
    keys = await generateKeypair();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetClock();
  });

  it('throws ConfigError when getAgentPublicKey is missing', () => {
    expect(
      () =>
        new CerniqVerifier({
          baseUrl: 'x',
          getAgentPublicKey: undefined as unknown as never,
          fetch: globalThis.fetch,
        }),
    ).toThrow(ConfigError);
  });

  it('verifies a valid token', async () => {
    const { verifier } = await makeVerifier({ keys });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      amount: 100,
      currency: 'USD',
    });
    const out = await verifier.verify(token, { action: 'commerce.purchase' });
    expect(out.valid).toBe(true);
    if (out.valid) {
      expect(out.agentId).toBe('agt_a');
      expect(out.policyId).toBe('pol_a');
      expect(out.trustBand).toBe('VERIFIED');
    }
  });

  it('rejects malformed token as INVALID_SIGNATURE', async () => {
    const { verifier } = await makeVerifier({ keys });
    const out = await verifier.verify('not.a.token');
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('INVALID_SIGNATURE');
  });

  it('rejects tampered signature', async () => {
    const { verifier } = await makeVerifier({ keys });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    const tampered = tamperToken(token, 2);
    const out = await verifier.verify(tampered);
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('INVALID_SIGNATURE');
  });

  it('rejects expired tokens with POLICY_EXPIRED', async () => {
    const { verifier } = await makeVerifier({ keys });
    const past = Math.floor(Date.now() / 1000) - 600;
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      iat: past,
      ttlSeconds: 60,
    });
    const out = await verifier.verify(token);
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('POLICY_EXPIRED');
  });

  it('rejects future-dated tokens as INVALID_SIGNATURE', async () => {
    const { verifier } = await makeVerifier({ keys });
    const future = Math.floor(Date.now() / 1000) + 600;
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      iat: future,
      ttlSeconds: 60,
    });
    const out = await verifier.verify(token);
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('INVALID_SIGNATURE');
  });

  it('rejects revoked agent with AGENT_REVOKED', async () => {
    const { verifier } = await makeVerifier({ keys, status: { status: 'revoked' } });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    const out = await verifier.verify(token);
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('AGENT_REVOKED');
  });

  it('rejects suspended agent with AGENT_REVOKED', async () => {
    const { verifier } = await makeVerifier({ keys, status: { status: 'suspended' } });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    const out = await verifier.verify(token);
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('AGENT_REVOKED');
  });

  it('detects replay on second verify', async () => {
    const { verifier } = await makeVerifier({ keys });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      jti: 'replay-jti-1',
    });
    const first = await verifier.verify(token);
    expect(first.valid).toBe(true);
    const second = await verifier.verify(token);
    expect(second.valid).toBe(false);
    if (!second.valid) expect(second.reason).toBe('REPLAY_DETECTED');
  });

  it('rejects scope mismatch', async () => {
    const { verifier } = await makeVerifier({ keys });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      scopes: ['commerce'],
    });
    const out = await verifier.verify(token, {}, { requiredScope: 'data-write' });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('SCOPE_NOT_GRANTED');
  });

  it('rejects amount over token amount', async () => {
    const { verifier } = await makeVerifier({ keys });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      amount: 50,
      currency: 'USD',
    });
    const out = await verifier.verify(token, { amount: 100, currency: 'USD' });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('SPEND_LIMIT_EXCEEDED');
  });

  it('rejects domain not in allowedDomains', async () => {
    const { verifier } = await makeVerifier({ keys });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      allowedDomains: ['delta.com', '*.example.com'],
    });
    const out = await verifier.verify(token, { merchantDomain: 'evil.com' });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('SCOPE_NOT_GRANTED');
  });

  it('accepts wildcard subdomain match', async () => {
    const { verifier } = await makeVerifier({ keys });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      allowedDomains: ['*.example.com'],
    });
    const out = await verifier.verify(token, { merchantDomain: 'shop.example.com' });
    expect(out.valid).toBe(true);
  });

  it('rejects when trustScore < minTrustScore', async () => {
    const { verifier } = await makeVerifier({
      keys,
      status: { status: 'active', trustScore: 200 },
    });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    const out = await verifier.verify(token, { minTrustScore: 500 });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('TRUST_SCORE_TOO_LOW');
  });

  it('invalidateAgent forces revocation refetch', async () => {
    const { verifier, fetchMock } = await makeVerifier({ keys });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    await verifier.verify(token);
    const tokenB = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    await verifier.verify(tokenB);
    const before = fetchMock.mock.calls.length;
    verifier.invalidateAgent('agt_a');
    const tokenC = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    await verifier.verify(tokenC);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('uses kid + JWKS for issuer-signed tokens', async () => {
    const { verifier } = await makeVerifier({ keys });
    // Seed JWKS with our key under kid=k1.
    const { b64uEncode } = await import('../src/_internal/b64u.js');
    verifier._seedJwks([{ kty: 'OKP', crv: 'Ed25519', x: b64uEncode(keys.publicKey), kid: 'k1' }]);
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      kid: 'k1',
    });
    const out = await verifier.verify(token);
    expect(out.valid).toBe(true);
  });

  it('returns INVALID_SIGNATURE on unknown kid', async () => {
    const { verifier } = await makeVerifier({ keys });
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      kid: 'nope',
    });
    const out = await verifier.verify(token);
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('INVALID_SIGNATURE');
  });

  it('rejects clock-skew tokens within ±5s tolerance', async () => {
    const { verifier } = await makeVerifier({ keys });
    // iat is 4s in the future — within default 5s skew, should pass.
    const future = Math.floor(Date.now() / 1000) + 4;
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      iat: future,
      ttlSeconds: 60,
    });
    const out = await verifier.verify(token);
    expect(out.valid).toBe(true);
  });

  it('clock pinned: just-expired token within skew is accepted', async () => {
    const { verifier } = await makeVerifier({ keys });
    // exp = now-2 → expired by 2s, within 5s skew. Accepted.
    const baseNow = 1_700_000_000;
    setClock(() => baseNow * 1000);
    const token = await signTestToken(keys.privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      iat: baseNow - 60,
      ttlSeconds: 58,
    });
    const out = await verifier.verify(token);
    expect(out.valid).toBe(true);
  });
});
