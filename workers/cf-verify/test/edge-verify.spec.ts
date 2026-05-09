// edgeVerify spec — full ADR-0004 denial-precedence sweep + cache-miss
// forwarding. Each `it` corresponds to one branch of the precedence
// table. The CF Worker MUST agree with origin on every branch — this
// suite is the contract that proves it.
//
// We don't run the Cloudflare runtime here; we test the pure functions
// from edge-verify.ts under Node + a vitest harness. The WebCrypto
// imports in token.ts work under Node 20+ via the global `crypto.subtle`.

import { describe, it, expect, vi } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { edgeVerify } from '../src/edge-verify';
import type { CachedAgent, CachedPolicy, KvCache } from '../src/kv-cache';
import type { VerifyRequest } from '@aegis/types';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function b64u(b: Uint8Array): string {
  return Buffer.from(b).toString('base64url');
}

interface Keys { priv: Uint8Array; pubB64u: string }
async function makeKeys(): Promise<Keys> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pubB64u: b64u(pub) };
}

async function signToken(keys: Keys, claims: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const header = b64u(enc.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })));
  const payload = b64u(enc.encode(JSON.stringify(claims)));
  const sig = await ed.signAsync(enc.encode(`${header}.${payload}`), keys.priv);
  return `${header}.${payload}.${b64u(sig)}`;
}

function makeCache(opts: {
  agent?: CachedAgent | null;
  policy?: CachedPolicy | null;
  daySpend?: number;
} = {}): KvCache {
  return {
    getAgent: vi.fn(async () => opts.agent ?? null),
    getPolicy: vi.fn(async () => opts.policy ?? null),
    getDaySpend: vi.fn(async () => opts.daySpend ?? 0),
  };
}

function activeAgent(keys: Keys, over: Partial<CachedAgent> = {}): CachedAgent {
  return {
    id: 'agt_1', publicKey: keys.pubB64u, status: 'ACTIVE', trustScore: 700,
    trustBand: 'VERIFIED', principalId: 'p_1', cachedAt: Date.now(), ...over,
  };
}

function activePolicy(over: Partial<CachedPolicy> = {}): CachedPolicy {
  return {
    id: 'pol_1', status: 'ACTIVE',
    expiresAtMs: Date.now() + 60_000,
    scopes: [{ category: 'commerce', actions: ['commerce.purchase'] }],
    cachedAt: Date.now(), ...over,
  };
}

const baseRequest: VerifyRequest = {
  token: 'placeholder',
  action: 'commerce.purchase',
} as VerifyRequest;

describe('edgeVerify — ADR-0004 denial precedence sweep', () => {
  it('decides INVALID_SIGNATURE on missing token', async () => {
    const r = await edgeVerify({ ...baseRequest, token: '' } as VerifyRequest, makeCache());
    expect(r.outcome).toBe('decided');
    expect(r.response?.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('decides INVALID_SIGNATURE on malformed token', async () => {
    const r = await edgeVerify({ ...baseRequest, token: 'not.a.jwt' } as VerifyRequest, makeCache());
    expect(r.response?.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('decides INVALID_SIGNATURE on hard-expired token', async () => {
    const k = await makeKeys();
    const expired = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: 1, exp: 1 });
    const r = await edgeVerify({ ...baseRequest, token: expired } as VerifyRequest, makeCache());
    expect(r.outcome).toBe('decided');
    expect(r.response?.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('forwards on agent cache miss', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const r = await edgeVerify({ ...baseRequest, token: t } as VerifyRequest, makeCache({ agent: null, policy: activePolicy() }));
    expect(r.outcome).toBe('forward');
  });

  it('forwards on policy cache miss', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const r = await edgeVerify({ ...baseRequest, token: t } as VerifyRequest, makeCache({ agent: activeAgent(k), policy: null }));
    expect(r.outcome).toBe('forward');
  });

  it('decides AGENT_REVOKED on revoked cached agent', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const r = await edgeVerify({ ...baseRequest, token: t } as VerifyRequest, makeCache({ agent: activeAgent(k, { status: 'REVOKED' }), policy: activePolicy() }));
    expect(r.outcome).toBe('decided');
    expect(r.response?.denialReason).toBe('AGENT_REVOKED');
  });

  it('forwards on suspended agent (origin handles nuance)', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const r = await edgeVerify({ ...baseRequest, token: t } as VerifyRequest, makeCache({ agent: activeAgent(k, { status: 'SUSPENDED' }), policy: activePolicy() }));
    expect(r.outcome).toBe('forward');
  });

  it('decides POLICY_REVOKED on revoked cached policy', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const r = await edgeVerify({ ...baseRequest, token: t } as VerifyRequest, makeCache({ agent: activeAgent(k), policy: activePolicy({ status: 'REVOKED' }) }));
    expect(r.response?.denialReason).toBe('POLICY_REVOKED');
  });

  it('decides POLICY_EXPIRED on expired-by-timestamp policy', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    // Need expiresAtMs in past but past the cache staleness window so KV
    // wouldn't have already filtered it out — build a policy that the
    // cache returned but is marked active.
    const expiredPol = activePolicy({ expiresAtMs: Date.now() - 1, status: 'ACTIVE' });
    const r = await edgeVerify({ ...baseRequest, token: t } as VerifyRequest, makeCache({ agent: activeAgent(k), policy: expiredPol }));
    expect(r.response?.denialReason).toBe('POLICY_EXPIRED');
  });

  it('decides INVALID_SIGNATURE on bad signature (wrong key)', async () => {
    const k1 = await makeKeys();
    const k2 = await makeKeys();
    const t = await signToken(k1, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    // Cache says agt_1's pubkey is k2 — sig won't verify.
    const r = await edgeVerify({ ...baseRequest, token: t } as VerifyRequest, makeCache({ agent: activeAgent(k2), policy: activePolicy() }));
    expect(r.response?.denialReason).toBe('INVALID_SIGNATURE');
  });

  it('decides SCOPE_NOT_GRANTED on action outside scope', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const r = await edgeVerify({ ...baseRequest, token: t, action: 'data.export' } as VerifyRequest, makeCache({ agent: activeAgent(k), policy: activePolicy() }));
    expect(r.response?.denialReason).toBe('SCOPE_NOT_GRANTED');
  });

  it('decides SPEND_LIMIT_EXCEEDED when day-window is full', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const policy = activePolicy({
      scopes: [{ category: 'commerce', actions: ['commerce.purchase'], spendLimit: { amount: '500.00', currency: 'USD', window: 'per_day' } }],
    });
    const r = await edgeVerify(
      { ...baseRequest, token: t, amount: '600.00', currency: 'USD' } as VerifyRequest,
      makeCache({ agent: activeAgent(k), policy, daySpend: 0 }),
    );
    expect(r.response?.denialReason).toBe('SPEND_LIMIT_EXCEEDED');
  });

  it('forwards per_request spend windows to origin (durable counter)', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const policy = activePolicy({
      scopes: [{ category: 'commerce', actions: ['commerce.purchase'], spendLimit: { amount: '500.00', currency: 'USD', window: 'per_request' } }],
    });
    const r = await edgeVerify(
      { ...baseRequest, token: t, amount: '50.00', currency: 'USD' } as VerifyRequest,
      makeCache({ agent: activeAgent(k), policy }),
    );
    expect(r.outcome).toBe('forward');
  });

  it('decides TRUST_SCORE_TOO_LOW on FLAGGED-band agent', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const r = await edgeVerify({ ...baseRequest, token: t } as VerifyRequest, makeCache({
      agent: activeAgent(k, { trustBand: 'FLAGGED', trustScore: 100 }), policy: activePolicy(),
    }));
    expect(r.response?.denialReason).toBe('TRUST_SCORE_TOO_LOW');
  });

  it('decides APPROVED on the happy path', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const r = await edgeVerify({ ...baseRequest, token: t } as VerifyRequest, makeCache({ agent: activeAgent(k), policy: activePolicy() }));
    expect(r.outcome).toBe('decided');
    expect(r.response?.valid).toBe(true);
    expect(r.response?.agentId).toBe('agt_1');
    expect(r.response?.scopesGranted).toEqual(['commerce']);
  });

  it('respects merchant-domain allow-list when present', async () => {
    const k = await makeKeys();
    const t = await signToken(k, { sub: 'agt_1', pid: 'pol_1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    const policy = activePolicy({
      scopes: [{ category: 'commerce', actions: ['commerce.purchase'], merchantDomains: ['delta.com'] }],
    });
    const denied = await edgeVerify(
      { ...baseRequest, token: t, merchantDomain: 'evil.example' } as VerifyRequest,
      makeCache({ agent: activeAgent(k), policy }),
    );
    expect(denied.response?.denialReason).toBe('SCOPE_NOT_GRANTED');

    const allowed = await edgeVerify(
      { ...baseRequest, token: t, merchantDomain: 'delta.com' } as VerifyRequest,
      makeCache({ agent: activeAgent(k), policy }),
    );
    expect(allowed.response?.valid).toBe(true);
  });
});
