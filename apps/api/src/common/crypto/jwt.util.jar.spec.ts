// jwt.util.jar.spec.ts — RFC 9101 (JAR — JWT Authorization Request)
//                       opt-in validation tests.
//
// Locks the JAR binding. Promotion test for moving RFC-9101 from
// `standards_aligned` to `standards_implemented`. If this passes in
// CI, the discovery doc may legitimately advertise JAR support.
//
// Authority: docs/spec/05_FAPI_2_0_PROFILE.md §2 — RFC-9101 binding.

import './crypto.bootstrap.js';
import * as ed from '@noble/ed25519';
import { JwtUtil, type AgentTokenClaims } from './jwt.util';
import { encodeBase64Url } from './ed25519.util';

async function newKeypair(): Promise<{ priv: Uint8Array; pubB64: string }> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pubB64: encodeBase64Url(pub) };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function baseClaims(overrides: Partial<AgentTokenClaims> = {}): AgentTokenClaims {
  const now = nowSeconds();
  return {
    sub: 'agent_test',
    pid: 'policy_test',
    iat: now,
    exp: now + 60,
    jti: '01HXXXXXXXXXXXXXXXXXXXXXX',
    ...overrides,
  };
}

describe('JwtUtil — JAR (RFC 9101) opt-in claim validation', () => {
  let util: JwtUtil;

  beforeEach(() => {
    util = new JwtUtil();
  });

  describe('backward compatibility — pre-JAR baseline preserved', () => {
    it('accepts a non-JAR token (no aud/iss/iat-age check) when options omitted', async () => {
      const { priv, pubB64 } = await newKeypair();
      // No iss, no aud — typical pre-JAR AEGIS token shape.
      const token = await util.sign(baseClaims(), priv);
      const result = await util.verifyAndDecode(token, pubB64);
      expect(result).not.toBeNull();
      expect(result?.sub).toBe('agent_test');
    });

    it('accepts a token with iss + aud present but no options (claims pass through)', async () => {
      const { priv, pubB64 } = await newKeypair();
      const token = await util.sign(
        baseClaims({ iss: 'agent_test', aud: 'https://api.aegis.klytics.io' }),
        priv,
      );
      const result = await util.verifyAndDecode(token, pubB64);
      expect(result).not.toBeNull();
      expect(result?.iss).toBe('agent_test');
      expect(result?.aud).toBe('https://api.aegis.klytics.io');
    });
  });

  describe('requiredAudience — RFC 9101 aud claim binding', () => {
    it('accepts a JAR token whose aud matches requiredAudience exactly', async () => {
      const { priv, pubB64 } = await newKeypair();
      const aud = 'https://api.aegis.klytics.io';
      const token = await util.sign(baseClaims({ aud }), priv);
      const result = await util.verifyAndDecode(token, pubB64, {
        requiredAudience: aud,
      });
      expect(result).not.toBeNull();
      expect(result?.aud).toBe(aud);
    });

    it('rejects a JAR token whose aud does not match requiredAudience', async () => {
      const { priv, pubB64 } = await newKeypair();
      const token = await util.sign(
        baseClaims({ aud: 'https://api.aegis.klytics.io' }),
        priv,
      );
      const result = await util.verifyAndDecode(token, pubB64, {
        requiredAudience: 'https://other-server.example.com',
      });
      expect(result).toBeNull();
    });

    it('rejects a token MISSING aud when requiredAudience is set (JAR-strict)', async () => {
      // Defense against pre-JAR tokens being replayed at a JAR-enforcing
      // server — the agent never signed an audience commitment.
      const { priv, pubB64 } = await newKeypair();
      const token = await util.sign(baseClaims(), priv); // no aud
      const result = await util.verifyAndDecode(token, pubB64, {
        requiredAudience: 'https://api.aegis.klytics.io',
      });
      expect(result).toBeNull();
    });
  });

  describe('requiredIssuer — RFC 9101 iss claim binding', () => {
    it('accepts a token whose iss matches requiredIssuer', async () => {
      const { priv, pubB64 } = await newKeypair();
      const token = await util.sign(
        baseClaims({ iss: 'agent_test', sub: 'agent_test' }),
        priv,
      );
      const result = await util.verifyAndDecode(token, pubB64, {
        requiredIssuer: 'agent_test',
      });
      expect(result).not.toBeNull();
    });

    it('rejects a token whose iss does not match', async () => {
      const { priv, pubB64 } = await newKeypair();
      const token = await util.sign(
        baseClaims({ iss: 'agent_wrong', sub: 'agent_test' }),
        priv,
      );
      const result = await util.verifyAndDecode(token, pubB64, {
        requiredIssuer: 'agent_test',
      });
      expect(result).toBeNull();
    });

    it('rejects a token MISSING iss when requiredIssuer is set', async () => {
      const { priv, pubB64 } = await newKeypair();
      const token = await util.sign(baseClaims(), priv); // no iss
      const result = await util.verifyAndDecode(token, pubB64, {
        requiredIssuer: 'agent_test',
      });
      expect(result).toBeNull();
    });
  });

  describe('maxAgeSeconds — RFC 9101 iat freshness binding', () => {
    it('accepts a fresh token (iat = now)', async () => {
      const { priv, pubB64 } = await newKeypair();
      const token = await util.sign(baseClaims(), priv);
      const result = await util.verifyAndDecode(token, pubB64, {
        maxAgeSeconds: 60,
      });
      expect(result).not.toBeNull();
    });

    it('accepts a token within the max-age window', async () => {
      const { priv, pubB64 } = await newKeypair();
      const now = nowSeconds();
      const token = await util.sign(
        baseClaims({ iat: now - 30, exp: now + 60 }),
        priv,
      );
      const result = await util.verifyAndDecode(token, pubB64, {
        maxAgeSeconds: 60,
      });
      expect(result).not.toBeNull();
    });

    it('rejects a stale token (iat past max-age) even if exp is in the future', async () => {
      const { priv, pubB64 } = await newKeypair();
      const now = nowSeconds();
      // exp in the future (token still valid by classic rule) but iat
      // is 5 minutes ago — JAR-strict rejects to limit replay window.
      const token = await util.sign(
        baseClaims({ iat: now - 300, exp: now + 600 }),
        priv,
      );
      const result = await util.verifyAndDecode(token, pubB64, {
        maxAgeSeconds: 60,
      });
      expect(result).toBeNull();
    });

    it('rejects a token with missing or non-numeric iat when maxAgeSeconds is set', async () => {
      const { priv, pubB64 } = await newKeypair();
      const token = await util.sign(
        baseClaims({ iat: 0 as unknown as number }),
        priv,
      );
      const result = await util.verifyAndDecode(token, pubB64, {
        maxAgeSeconds: 60,
      });
      expect(result).toBeNull();
    });
  });

  describe('authorization_details claim — RFC 9396 RAR inline in JAR', () => {
    it('decodes authorization_details claim from a JAR token', async () => {
      const { priv, pubB64 } = await newKeypair();
      const aud = 'https://api.aegis.klytics.io';
      const claims = baseClaims({
        aud,
        authorization_details: [
          {
            type: 'trading_order',
            actions: ['buy'],
            limits: { per_order_usd: 50000 },
          },
        ],
      });
      const token = await util.sign(claims, priv);
      const result = await util.verifyAndDecode(token, pubB64, {
        requiredAudience: aud,
      });
      expect(result).not.toBeNull();
      expect(result?.authorization_details).toHaveLength(1);
      expect(result?.authorization_details?.[0]?.type).toBe('trading_order');
    });

    it('tampering with authorization_details fails verification (JAR signs it)', async () => {
      // Defense against MITM swapping RAR claims. The agent signed the
      // authorization_details inside the JWT — flipping any field breaks
      // the Ed25519 signature.
      const { priv, pubB64 } = await newKeypair();
      const token = await util.sign(
        baseClaims({
          authorization_details: [
            { type: 'trading_order', actions: ['buy'], limits: { per_order_usd: 50000 } },
          ],
        }),
        priv,
      );
      // Manually tamper: replace payload bytes with a different limits.
      const [headerB64, _origPayloadB64, sigB64] = token.split('.');
      const tamperedPayload = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(_origPayloadB64!, 'base64url').toString('utf-8')),
          authorization_details: [
            { type: 'trading_order', actions: ['buy'], limits: { per_order_usd: 500000 } },
          ],
        }),
      )
        .toString('base64url')
        .replace(/=+$/, '');
      const tamperedToken = `${headerB64}.${tamperedPayload}.${sigB64}`;
      const result = await util.verifyAndDecode(tamperedToken, pubB64);
      expect(result).toBeNull();
    });
  });

  describe('combined JAR-strict mode — all three opt-ins together', () => {
    it('happy path: fresh JAR with aud, iss, iat all matching', async () => {
      const { priv, pubB64 } = await newKeypair();
      const now = nowSeconds();
      const aud = 'https://api.aegis.klytics.io';
      const iss = 'agent_test';
      const token = await util.sign(
        baseClaims({ sub: iss, iss, aud, iat: now, exp: now + 60 }),
        priv,
      );
      const result = await util.verifyAndDecode(token, pubB64, {
        requiredAudience: aud,
        requiredIssuer: iss,
        maxAgeSeconds: 60,
      });
      expect(result).not.toBeNull();
      expect(result?.iss).toBe(iss);
      expect(result?.aud).toBe(aud);
    });

    it('any one of the three failing rejects the whole token', async () => {
      const { priv, pubB64 } = await newKeypair();
      const now = nowSeconds();
      const aud = 'https://api.aegis.klytics.io';
      const iss = 'agent_test';
      // Fail on aud only.
      const tokenBadAud = await util.sign(
        baseClaims({ sub: iss, iss, aud: 'https://wrong.example.com', iat: now }),
        priv,
      );
      expect(
        await util.verifyAndDecode(tokenBadAud, pubB64, {
          requiredAudience: aud,
          requiredIssuer: iss,
          maxAgeSeconds: 60,
        }),
      ).toBeNull();

      // Fail on iss only.
      const tokenBadIss = await util.sign(
        baseClaims({ sub: iss, iss: 'agent_wrong', aud, iat: now }),
        priv,
      );
      expect(
        await util.verifyAndDecode(tokenBadIss, pubB64, {
          requiredAudience: aud,
          requiredIssuer: iss,
          maxAgeSeconds: 60,
        }),
      ).toBeNull();

      // Fail on iat (stale) only.
      const tokenStale = await util.sign(
        baseClaims({ sub: iss, iss, aud, iat: now - 300, exp: now + 60 }),
        priv,
      );
      expect(
        await util.verifyAndDecode(tokenStale, pubB64, {
          requiredAudience: aud,
          requiredIssuer: iss,
          maxAgeSeconds: 60,
        }),
      ).toBeNull();
    });
  });

  describe('signature still wins over claim validation', () => {
    it('a wrong-key signature fails BEFORE claim validation (order of checks)', async () => {
      const { priv } = await newKeypair();
      const otherKey = await newKeypair();
      // Sign with priv but verify against otherKey.pubB64 — signature fails.
      // The JAR options are valid; they shouldn't matter because sig check
      // runs first and returns null.
      const token = await util.sign(
        baseClaims({ aud: 'https://api.aegis.klytics.io' }),
        priv,
      );
      const result = await util.verifyAndDecode(token, otherKey.pubB64, {
        requiredAudience: 'https://api.aegis.klytics.io',
      });
      expect(result).toBeNull();
    });
  });
});
