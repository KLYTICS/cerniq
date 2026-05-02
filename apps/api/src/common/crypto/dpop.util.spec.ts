import './crypto.bootstrap';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { encodeBase64Url } from './ed25519.util';
import { verifyDpopProof, jwkThumbprint, type ReplayCache, type DpopJwk } from './dpop.util';

class StubReplayCache implements ReplayCache {
  private readonly seen = new Set<string>();
  async has(jti: string): Promise<boolean> { return this.seen.has(jti); }
  async add(jti: string, _ttl: number): Promise<void> { this.seen.add(jti); }
}

async function makeKey(): Promise<{ priv: Uint8Array; pub: Uint8Array; jwk: DpopJwk }> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pub, jwk: { kty: 'OKP', crv: 'Ed25519', x: encodeBase64Url(pub) } };
}

async function signProof(args: {
  priv: Uint8Array;
  jwk: DpopJwk;
  htm: string;
  htu: string;
  iat: number;
  jti?: string;
  accessToken: string;
}): Promise<string> {
  const enc = new TextEncoder();
  const header = { typ: 'dpop+jwt', alg: 'EdDSA', jwk: args.jwk };
  const ath = encodeBase64Url(createHash('sha256').update(args.accessToken).digest());
  const payload = { htm: args.htm, htu: args.htu, iat: args.iat, jti: args.jti ?? ulid(), ath };
  const headerB64 = encodeBase64Url(enc.encode(JSON.stringify(header)));
  const payloadB64 = encodeBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await ed.signAsync(enc.encode(`${headerB64}.${payloadB64}`), args.priv);
  return `${headerB64}.${payloadB64}.${encodeBase64Url(sig)}`;
}

describe('verifyDpopProof', () => {
  const TOKEN = 'aegis_test_token_abcdef';
  const URL = 'https://aegis.example.com/v1/verify';

  it('accepts a valid proof', async () => {
    const k = await makeKey();
    const proof = await signProof({ priv: k.priv, jwk: k.jwk, htm: 'POST', htu: URL, iat: Math.floor(Date.now() / 1000), accessToken: TOKEN });
    const cache = new StubReplayCache();
    const r = await verifyDpopProof(proof, { method: 'POST', url: URL, accessToken: TOKEN, replayCache: cache });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.jkt).toBe(await jwkThumbprint(k.jwk));
  });

  it('rejects malformed proofs', async () => {
    const cache = new StubReplayCache();
    const r = await verifyDpopProof('not.a.jwt.at.all', { method: 'POST', url: URL, accessToken: TOKEN, replayCache: cache });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('DPoP_MALFORMED');
  });

  it('rejects htm mismatch', async () => {
    const k = await makeKey();
    const proof = await signProof({ priv: k.priv, jwk: k.jwk, htm: 'GET', htu: URL, iat: Math.floor(Date.now() / 1000), accessToken: TOKEN });
    const r = await verifyDpopProof(proof, { method: 'POST', url: URL, accessToken: TOKEN, replayCache: new StubReplayCache() });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('DPoP_HTM_MISMATCH');
  });

  it('rejects htu mismatch (different path)', async () => {
    const k = await makeKey();
    const proof = await signProof({ priv: k.priv, jwk: k.jwk, htm: 'POST', htu: 'https://aegis.example.com/v1/agents', iat: Math.floor(Date.now() / 1000), accessToken: TOKEN });
    const r = await verifyDpopProof(proof, { method: 'POST', url: URL, accessToken: TOKEN, replayCache: new StubReplayCache() });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('DPoP_HTU_MISMATCH');
  });

  it('accepts htu with case-insensitive host + ignored fragment', async () => {
    const k = await makeKey();
    const proof = await signProof({ priv: k.priv, jwk: k.jwk, htm: 'POST', htu: 'https://AEGIS.EXAMPLE.COM/v1/verify#frag', iat: Math.floor(Date.now() / 1000), accessToken: TOKEN });
    const r = await verifyDpopProof(proof, { method: 'POST', url: URL, accessToken: TOKEN, replayCache: new StubReplayCache() });
    expect(r.valid).toBe(true);
  });

  it('rejects clock skew beyond 30s', async () => {
    const k = await makeKey();
    const proof = await signProof({ priv: k.priv, jwk: k.jwk, htm: 'POST', htu: URL, iat: Math.floor(Date.now() / 1000) - 600, accessToken: TOKEN });
    const r = await verifyDpopProof(proof, { method: 'POST', url: URL, accessToken: TOKEN, replayCache: new StubReplayCache() });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('DPoP_CLOCK_SKEW');
  });

  it('rejects ath mismatch (token swap attack)', async () => {
    const k = await makeKey();
    const proof = await signProof({ priv: k.priv, jwk: k.jwk, htm: 'POST', htu: URL, iat: Math.floor(Date.now() / 1000), accessToken: 'OTHER_TOKEN' });
    const r = await verifyDpopProof(proof, { method: 'POST', url: URL, accessToken: TOKEN, replayCache: new StubReplayCache() });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('DPoP_ATH_MISMATCH');
  });

  it('rejects replayed jti', async () => {
    const k = await makeKey();
    const cache = new StubReplayCache();
    const jti = ulid();
    const iat = Math.floor(Date.now() / 1000);
    const proof = await signProof({ priv: k.priv, jwk: k.jwk, htm: 'POST', htu: URL, iat, jti, accessToken: TOKEN });
    const r1 = await verifyDpopProof(proof, { method: 'POST', url: URL, accessToken: TOKEN, replayCache: cache });
    expect(r1.valid).toBe(true);
    const r2 = await verifyDpopProof(proof, { method: 'POST', url: URL, accessToken: TOKEN, replayCache: cache });
    expect(r2.valid).toBe(false);
    if (!r2.valid) expect(r2.reason).toBe('DPoP_REPLAY');
  });

  it('rejects jkt mismatch when cnf.jkt is supplied', async () => {
    const k1 = await makeKey();
    const k2 = await makeKey();
    const proof = await signProof({ priv: k1.priv, jwk: k1.jwk, htm: 'POST', htu: URL, iat: Math.floor(Date.now() / 1000), accessToken: TOKEN });
    const wrongJkt = await jwkThumbprint(k2.jwk);
    const r = await verifyDpopProof(proof, { method: 'POST', url: URL, accessToken: TOKEN, replayCache: new StubReplayCache(), expectedJkt: wrongJkt });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('DPoP_JKT_MISMATCH');
  });

  it('rejects tampered signature', async () => {
    const k = await makeKey();
    const proof = await signProof({ priv: k.priv, jwk: k.jwk, htm: 'POST', htu: URL, iat: Math.floor(Date.now() / 1000), accessToken: TOKEN });
    const [h, p, s] = proof.split('.');
    const tampered = `${h}.${p}.${s.slice(0, -2)}AA`;
    const r = await verifyDpopProof(tampered, { method: 'POST', url: URL, accessToken: TOKEN, replayCache: new StubReplayCache() });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('DPoP_SIGNATURE');
  });
});

describe('jwkThumbprint', () => {
  it('matches the RFC 7638 canonical-form sha256', async () => {
    // Test vector built by hand: known ed25519 public key, hand-canonicalized.
    const jwk: DpopJwk = { kty: 'OKP', crv: 'Ed25519', x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
    const expected = encodeBase64Url(createHash('sha256').update('{"crv":"Ed25519","kty":"OKP","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}', 'utf8').digest());
    expect(await jwkThumbprint(jwk)).toBe(expected);
  });
});
