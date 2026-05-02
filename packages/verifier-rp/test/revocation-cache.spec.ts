import { afterEach, describe, expect, it, vi } from 'vitest';

import { RevocationCache } from '../src/revocation-cache.js';
import { resetClock, setClock } from '../src/_internal/time.js';

afterEach(() => {
  vi.restoreAllMocks();
  resetClock();
});

function activeStatus(agentId: string) {
  return {
    agentId,
    status: 'active',
    trustScore: 700,
    trustBand: 'VERIFIED',
  };
}

function fakeRes(json: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'ERR',
    json: async () => json,
  } as unknown as Response;
}

describe('RevocationCache', () => {
  it('fetches and caches by agentId', async () => {
    const fetchImpl = vi.fn(async () => fakeRes(activeStatus('agt_a')));
    const cache = new RevocationCache({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 30,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    const s1 = await cache.getStatus('agt_a');
    expect(s1.status).toBe('active');
    await cache.getStatus('agt_a');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('expires after TTL', async () => {
    let t = 1_000_000;
    setClock(() => t);
    const fetchImpl = vi.fn(async () => fakeRes(activeStatus('agt_a')));
    const cache = new RevocationCache({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 5,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    await cache.getStatus('agt_a');
    t += 10_000;
    await cache.getStatus('agt_a');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('invalidate forces refetch', async () => {
    const fetchImpl = vi.fn(async () => fakeRes(activeStatus('agt_a')));
    const cache = new RevocationCache({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 30,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    await cache.getStatus('agt_a');
    cache.invalidate('agt_a');
    await cache.getStatus('agt_a');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent in-flight fetches', async () => {
    let resolveFn: ((v: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          resolveFn = resolve;
        }),
    );
    const cache = new RevocationCache({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 30,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    const p1 = cache.getStatus('agt_a');
    const p2 = cache.getStatus('agt_a');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFn!(fakeRes(activeStatus('agt_a')));
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toEqual(b);
  });

  it('treats 404 as revoked synthetic snapshot', async () => {
    const fetchImpl = vi.fn(async () => fakeRes({}, false, 404));
    const cache = new RevocationCache({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 30,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    const s = await cache.getStatus('agt_unknown');
    expect(s.status).toBe('revoked');
    expect(s.trustScore).toBe(0);
    expect(s.trustBand).toBe('FLAGGED');
  });

  it('throws RevocationFetchError on 5xx', async () => {
    const fetchImpl = vi.fn(async () => fakeRes({}, false, 500));
    const cache = new RevocationCache({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 30,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    await expect(cache.getStatus('agt_a')).rejects.toThrow(/HTTP 500/);
  });

  it('throws on malformed body', async () => {
    const fetchImpl = vi.fn(async () => fakeRes({ wrong: 'shape' }));
    const cache = new RevocationCache({
      baseUrl: 'https://api.example.com/v1',
      cacheTtlSeconds: 30,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    await expect(cache.getStatus('agt_a')).rejects.toThrow(/malformed/);
  });
});
