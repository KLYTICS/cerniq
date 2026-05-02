import { afterEach, describe, expect, it, vi } from 'vitest';

import { b64uEncode } from '../src/_internal/b64u.js';
import { JwksClient } from '../src/jwks.js';
import { resetClock, setClock } from '../src/_internal/time.js';
import { generateKeypair } from './_helpers/sign.js';

function fakeRes(json: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'ERR',
    json: async () => json,
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetClock();
});

describe('JwksClient', () => {
  it('fetches and caches a key by kid', async () => {
    const { publicKey } = await generateKeypair();
    const fetchImpl = vi.fn(async () =>
      fakeRes({
        keys: [
          { kty: 'OKP', crv: 'Ed25519', x: b64uEncode(publicKey), kid: 'k1', use: 'sig' },
        ],
      }),
    );
    const client = new JwksClient({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 60,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    const key = await client.getKey('k1');
    expect(key).not.toBeNull();
    expect(key).toHaveLength(32);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Second call hits cache, no extra fetch.
    await client.getKey('k1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null on unknown kid after refresh', async () => {
    const { publicKey } = await generateKeypair();
    const fetchImpl = vi.fn(async () =>
      fakeRes({
        keys: [
          { kty: 'OKP', crv: 'Ed25519', x: b64uEncode(publicKey), kid: 'k1' },
        ],
      }),
    );
    const client = new JwksClient({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 60,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    const key = await client.getKey('k_nonexistent');
    expect(key).toBeNull();
  });

  it('throws JwksFetchError on non-200', async () => {
    const fetchImpl = vi.fn(async () => fakeRes({}, false, 500));
    const client = new JwksClient({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 60,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    await expect(client.getKey('any')).rejects.toThrow(/JWKS fetch failed/);
  });

  it('throws JwksParseError on malformed document', async () => {
    const fetchImpl = vi.fn(async () => fakeRes({ not: 'a jwks' }));
    const client = new JwksClient({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 60,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    await expect(client.getKey('any')).rejects.toThrow(/malformed/);
  });

  it('serves stale during background refresh (SWR)', async () => {
    let t = 1_000_000;
    setClock(() => t);
    const { publicKey } = await generateKeypair();
    const fetchImpl = vi.fn(async () =>
      fakeRes({
        keys: [{ kty: 'OKP', crv: 'Ed25519', x: b64uEncode(publicKey), kid: 'k1' }],
      }),
    );
    const client = new JwksClient({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 1,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    await client.getKey('k1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Advance past TTL — now stale.
    t += 2000;
    const key = await client.getKey('k1');
    expect(key).not.toBeNull();
    // Wait for the background refresh to settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('handles kid rotation', async () => {
    const a = await generateKeypair();
    const b = await generateKeypair();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return fakeRes({
          keys: [{ kty: 'OKP', crv: 'Ed25519', x: b64uEncode(a.publicKey), kid: 'k1' }],
        });
      }
      return fakeRes({
        keys: [
          { kty: 'OKP', crv: 'Ed25519', x: b64uEncode(a.publicKey), kid: 'k1' },
          { kty: 'OKP', crv: 'Ed25519', x: b64uEncode(b.publicKey), kid: 'k2' },
        ],
      });
    });
    const client = new JwksClient({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 60,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    const k1 = await client.getKey('k1');
    expect(k1).not.toBeNull();
    // k2 not in cache → triggers refresh.
    const k2 = await client.getKey('k2');
    expect(k2).not.toBeNull();
  });

  it('builds JWKS URL relative to host root', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe('https://api.example.com/.well-known/jwks.json');
      return fakeRes({ keys: [] });
    });
    const client = new JwksClient({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 60,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    await client.prefetch();
    expect(fetchImpl).toHaveBeenCalled();
  });
});
