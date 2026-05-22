import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { OkoroVerifier } from '../../src/verifier.js';
import { generateKeypair, signTestToken, tamperToken } from '../_helpers/sign.js';

function fakeRes(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => json,
  } as unknown as Response;
}

function makeVerifier(publicKey: Uint8Array): OkoroVerifier {
  const fetchMock = vi.fn(async () =>
    fakeRes({
      agentId: 'agt_property',
      status: 'active',
      trustScore: 700,
      trustBand: 'VERIFIED',
    }),
  );
  return new OkoroVerifier({
    baseUrl: 'https://api.example.com/v1',
    getAgentPublicKey: async () => publicKey,
    fetch: fetchMock as unknown as typeof globalThis.fetch,
  });
}

describe('verifier — property tests', () => {
  it('valid tokens with arbitrary claim values always verify', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const verifier = makeVerifier(publicKey);

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          action: fc.constantFrom(
            'commerce.purchase',
            'data.read',
            'comms.send',
            'sched.book',
          ),
          amount: fc.option(
            fc.integer({ min: 1, max: 9_999 }).map((n) => n + 0.5),
            { nil: undefined },
          ),
          currency: fc.option(fc.constantFrom('USD', 'EUR', 'GBP'), { nil: undefined }),
          merchantDomain: fc.option(
            fc.constantFrom('delta.com', 'shop.example.com', 'acme.io'),
            { nil: undefined },
          ),
          jti: fc.uuidV(4),
        }),
        async (params) => {
          // Each iteration must use a unique jti to avoid replay collisions
          // across runs that the cache would catch.
          const ctx: Parameters<typeof signTestToken>[3] = {
            action: params.action,
            jti: params.jti,
          };
          if (params.amount !== undefined) ctx.amount = params.amount;
          if (params.currency !== undefined) ctx.currency = params.currency;
          if (params.merchantDomain !== undefined)
            ctx.merchantDomain = params.merchantDomain;
          const token = await signTestToken(privateKey, 'agt_property', 'pol_x', ctx);
          const out = await verifier.verify(token);
          expect(out.valid).toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('any byte mutation of a valid token results in a denial', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const verifier = makeVerifier(publicKey);

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<0 | 1 | 2>(0, 1, 2),
        fc.uuidV(4),
        async (segment, jti) => {
          const token = await signTestToken(privateKey, 'agt_property', 'pol_x', {
            action: 'commerce.purchase',
            jti,
          });
          const tampered = tamperToken(token, segment);
          if (tampered === token) return; // no-op tamper, skip
          const out = await verifier.verify(tampered);
          expect(out.valid).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('replaying any valid token yields REPLAY_DETECTED on the second call', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const verifier = makeVerifier(publicKey);

    await fc.assert(
      fc.asyncProperty(fc.uuidV(4), async (jti) => {
        const token = await signTestToken(privateKey, 'agt_property', 'pol_x', {
          action: 'commerce.purchase',
          jti,
        });
        const a = await verifier.verify(token);
        const b = await verifier.verify(token);
        expect(a.valid).toBe(true);
        expect(b.valid).toBe(false);
        if (!b.valid) expect(b.reason).toBe('REPLAY_DETECTED');
      }),
      { numRuns: 15 },
    );
  });
});
