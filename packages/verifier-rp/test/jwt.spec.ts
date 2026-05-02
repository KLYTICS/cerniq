import { describe, expect, it } from 'vitest';

import { parseCompactJws, verifyEdDSA } from '../src/jwt.js';
import { generateKeypair, signTestToken, tamperToken } from './_helpers/sign.js';

describe('parseCompactJws', () => {
  it('parses a well-formed token', async () => {
    const { privateKey } = await generateKeypair();
    const token = await signTestToken(privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
      amount: 100,
      currency: 'USD',
    });
    const parsed = parseCompactJws(token);
    expect(parsed).not.toBeNull();
    expect(parsed?.header.alg).toBe('EdDSA');
    expect(parsed?.claims.sub).toBe('agt_a');
    expect(parsed?.claims.pid).toBe('pol_a');
    expect(parsed?.signature).toHaveLength(64);
  });

  it('returns null for malformed input', () => {
    expect(parseCompactJws('')).toBeNull();
    expect(parseCompactJws('not.a.jwt!')).toBeNull();
    expect(parseCompactJws('a.b')).toBeNull();
    expect(parseCompactJws('a.b.c.d')).toBeNull();
  });

  it('rejects header with non-EdDSA alg', () => {
    // Manually construct a token with alg=HS256.
    const enc = new TextEncoder();
    const b = (s: string): string =>
      Buffer.from(enc.encode(s))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const header = b(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b(
      JSON.stringify({ sub: 'a', pid: 'p', iat: 1, exp: 2, jti: 'j', act: 'x' }),
    );
    const sig = 'A'.repeat(86); // base64 of 64 bytes ≈ 86 chars
    expect(parseCompactJws(`${header}.${payload}.${sig}`)).toBeNull();
  });

  it('rejects malformed claims', () => {
    const enc = new TextEncoder();
    const b = (s: string): string =>
      Buffer.from(enc.encode(s))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const header = b(JSON.stringify({ alg: 'EdDSA' }));
    const payload = b(JSON.stringify({ sub: 'a' })); // missing required claims
    const sig = 'A'.repeat(86);
    expect(parseCompactJws(`${header}.${payload}.${sig}`)).toBeNull();
  });
});

describe('verifyEdDSA', () => {
  it('verifies a real signature', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const token = await signTestToken(privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    const parsed = parseCompactJws(token);
    expect(parsed).not.toBeNull();
    const ok = await verifyEdDSA(parsed!, publicKey);
    expect(ok).toBe(true);
  });

  it('rejects when payload tampered', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const token = await signTestToken(privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    const tampered = tamperToken(token, 1);
    const parsed = parseCompactJws(tampered);
    if (parsed === null) {
      // Tampering may make payload unparseable — that's also a valid failure.
      expect(parsed).toBeNull();
      return;
    }
    const ok = await verifyEdDSA(parsed, publicKey);
    expect(ok).toBe(false);
  });

  it('rejects with wrong public key', async () => {
    const { privateKey } = await generateKeypair();
    const { publicKey: otherPublic } = await generateKeypair();
    const token = await signTestToken(privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    const parsed = parseCompactJws(token)!;
    const ok = await verifyEdDSA(parsed, otherPublic);
    expect(ok).toBe(false);
  });

  it('returns false for invalid public key length', async () => {
    const { privateKey } = await generateKeypair();
    const token = await signTestToken(privateKey, 'agt_a', 'pol_a', {
      action: 'commerce.purchase',
    });
    const parsed = parseCompactJws(token)!;
    const bad = new Uint8Array(31);
    expect(await verifyEdDSA(parsed, bad)).toBe(false);
  });
});
