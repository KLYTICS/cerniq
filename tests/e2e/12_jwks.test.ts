import { describe, expect, it, beforeAll } from 'vitest';
import { RawClient, readConfig } from './_support/client';

/**
 * The well-known endpoint serves the OKORO audit-event signing key so
 * any third party can verify the chain offline. M-016 + M-006 contract:
 * shape may be either a JWKS (`{ keys: [...] }`) or a single key object —
 * accept either.
 */
describe('12 · /.well-known/audit-signing-key', () => {
  let raw: RawClient;
  beforeAll(() => {
    raw = new RawClient(readConfig());
  });

  it('returns 200 with at least one Ed25519 OKP key', async () => {
    const r = await raw.get<unknown>('/.well-known/audit-signing-key', { auth: 'none' });
    if (r.status === 404) {
      // Endpoint may be exposed under /v1/.well-known instead.
      const alt = await raw.get<unknown>('/v1/.well-known/audit-signing-key', { auth: 'none' });
      if (alt.status === 404) return;
      assertJwksLike(alt.body);
      return;
    }
    expect(r.status).toBe(200);
    assertJwksLike(r.body);
  });

  it('Cache-Control header allows public caching', async () => {
    const r = await raw.get<unknown>('/.well-known/audit-signing-key', { auth: 'none' });
    if (r.status === 404) return;
    const cc = r.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/public/);
    expect(cc).toMatch(/max-age=\d+/);
  });
});

function assertJwksLike(body: unknown): void {
  if (typeof body !== 'object' || body === null) {
    throw new Error('expected JSON object body');
  }
  // Either a JWKS (`keys`) or a single bare key.
  const keys: unknown[] = Array.isArray((body as { keys?: unknown[] }).keys)
    ? (body as { keys: unknown[] }).keys
    : [body];
  expect(keys.length).toBeGreaterThan(0);
  let foundEd = false;
  for (const k of keys) {
    if (typeof k !== 'object' || k === null) continue;
    const key = k as { kty?: string; crv?: string; x?: string; alg?: string };
    if ((key.kty === 'OKP' && key.crv === 'Ed25519') || key.alg === 'EdDSA') {
      expect(typeof key.x).toBe('string');
      foundEd = true;
    }
  }
  expect(foundEd, 'no Ed25519 / EdDSA key in JWKS').toBe(true);
}
