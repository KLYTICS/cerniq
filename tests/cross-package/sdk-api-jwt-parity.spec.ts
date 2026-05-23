// Cross-package parity test: an EdDSA JWT signed by `@cerniq/sdk` MUST
// verify under `apps/api`'s `JwtUtil`, and vice versa.
//
// Why this exists: the SDK and the API each implement compact-JWT
// signing independently (intentional — keeps `jose` off the verify hot
// path per ADR-0008 cost reasoning). If one drifts (claim ordering,
// header serialization, base64url quirk), all agents break silently.
// This test is the cheapest insurance.
//
// Run via the workspace test harness — vitest picks this file up at
// `pnpm -r test --filter=...tests/cross-package` (configured in
// `vitest.config.ts` at repo root after this file lands; M-025).

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { describe, expect, it, beforeAll } from 'vitest';
import {
  signAgentToken,
  generateKeypair,
  b64uDecode,
  b64uEncode,
} from '../../packages/sdk-ts/src/crypto';
import { JwtUtil } from '../../apps/api/src/common/crypto/jwt.util';
import type { AgentTokenClaims } from '../../apps/api/src/common/crypto/jwt.util';

beforeAll(() => {
  ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
});

describe('SDK ↔ API JWT parity', () => {
  const jwt = new JwtUtil();

  it('sdk-signed token verifies under api JwtUtil', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const token = await signAgentToken(privateKey, 'agt_xyz', 'pol_abc', {
      action: 'commerce.purchase',
      amount: 250,
      currency: 'USD',
      merchantDomain: 'delta.com',
      ttlSeconds: 60,
    });
    const claims = await jwt.verifyAndDecode(token, publicKey);
    expect(claims).not.toBeNull();
    if (!claims) return;
    expect(claims.sub).toBe('agt_xyz');
    expect(claims.pid).toBe('pol_abc');
    expect(claims.act).toBe('commerce.purchase');
    expect(claims.amt).toBe(250);
    expect(claims.cur).toBe('USD');
    expect(claims.dom).toBe('delta.com');
    expect(typeof claims.jti).toBe('string');
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it('api-signed token verifies via SDK round trip', async () => {
    // Use raw noble for the api side because JwtUtil.sign takes a Uint8Array
    // private key while generateKeypair returns base64url; convert once.
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const claims: AgentTokenClaims = {
      sub: 'agt_round',
      pid: 'pol_round',
      act: 'data.read',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      jti: '01HZ0000000000000000000000',
    };
    const token = await jwt.sign(claims, priv);

    // Verify via the SDK's path: decompose + verify ed25519 + parse.
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const enc = new TextEncoder();
    const ok = await ed.verifyAsync(
      b64uDecode(sigB64),
      enc.encode(`${headerB64}.${payloadB64}`),
      pub,
    );
    expect(ok).toBe(true);
    const parsed = JSON.parse(new TextDecoder().decode(b64uDecode(payloadB64)));
    expect(parsed.sub).toBe('agt_round');
  });

  it('header is exactly the same bytes on both sides', async () => {
    // Critical: if the SDK and the API serialize the header differently
    // (e.g. {alg:"EdDSA",typ:"JWT"} vs {typ:"JWT",alg:"EdDSA"}), the
    // signature input differs and verifies fail across boundary.
    const { privateKey } = await generateKeypair();
    const sdkToken = await signAgentToken(privateKey, 'a', 'p', { action: 'x', ttlSeconds: 60 });
    const apiPriv = ed.utils.randomPrivateKey();
    const apiToken = await jwt.sign({ sub: 'a', pid: 'p', iat: 1, exp: 2, jti: 'j' }, apiPriv);
    const sdkHeader = sdkToken.split('.')[0];
    const apiHeader = apiToken.split('.')[0];
    expect(sdkHeader).toBe(apiHeader);
  });

  it('base64url helpers round-trip identically', async () => {
    const sample = new Uint8Array([0, 1, 2, 0xff, 0xfe, 0xfd, 250, 100, 0]);
    const sdk = b64uEncode(sample);
    // The SDK uses '-_' base64url with no padding; node Buffer's 'base64url'
    // does the same. We assert the SDK encoder matches Node's reference.
    const node = Buffer.from(sample).toString('base64url');
    expect(sdk).toBe(node);
    expect(b64uDecode(sdk)).toEqual(sample);
  });
});
