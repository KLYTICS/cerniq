import { MemoryVerifyCache, buildCacheKey, clampTtlMs } from './cache.js';
import type { VerifyResult } from './types.js';

const baseResult: VerifyResult = {
  valid: true,
  agentId: 'agt_1',
  principalId: 'prn_1',
  trustScore: 0.9,
  trustBand: 'VERIFIED',
  scopesGranted: ['commerce'],
  denialReason: null,
  verifiedAt: new Date(0).toISOString(),
  ttl: 30,
};

describe('buildCacheKey', () => {
  it('produces a stable hex digest', () => {
    const k = buildCacheKey('tok', { action: 'pay', amount: 10, currency: 'USD' });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(buildCacheKey('tok', { action: 'pay', amount: 10, currency: 'USD' })).toBe(k);
  });

  it('differs by context — same token, different amount = different key', () => {
    const a = buildCacheKey('tok', { amount: 10 });
    const b = buildCacheKey('tok', { amount: 11 });
    expect(a).not.toBe(b);
  });

  it('cannot collide via separator-injection', () => {
    // If we joined with `|`, these would collide. NUL separator prevents it.
    const a = buildCacheKey('tok', { action: 'a', merchantId: 'b' });
    const b = buildCacheKey('tok', { action: 'a|b', merchantId: '' });
    expect(a).not.toBe(b);
  });
});

describe('clampTtlMs', () => {
  it('returns server ttl in ms when below ceiling', () => {
    expect(clampTtlMs(10, 60_000)).toBe(10_000);
  });
  it('clamps to operator ceiling', () => {
    expect(clampTtlMs(3600, 60_000)).toBe(60_000);
  });
  it('returns 0 for non-positive or non-finite ttl', () => {
    expect(clampTtlMs(0, 60_000)).toBe(0);
    expect(clampTtlMs(-1, 60_000)).toBe(0);
    expect(clampTtlMs(Number.NaN, 60_000)).toBe(0);
  });
});

describe('MemoryVerifyCache', () => {
  it('stores and retrieves before expiry', () => {
    let now = 0;
    const cache = new MemoryVerifyCache({ now: () => now });
    cache.set('k', { result: baseResult, expiresAt: 100 });
    now = 50;
    expect(cache.get('k')?.result).toBe(baseResult);
  });

  it('evicts after expiry', () => {
    let now = 0;
    const cache = new MemoryVerifyCache({ now: () => now });
    cache.set('k', { result: baseResult, expiresAt: 100 });
    now = 100;
    expect(cache.get('k')).toBeUndefined();
    now = 200;
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('enforces maxEntries via insertion-order LRU', () => {
    const cache = new MemoryVerifyCache({ maxEntries: 2 });
    cache.set('a', { result: baseResult, expiresAt: Number.POSITIVE_INFINITY });
    cache.set('b', { result: baseResult, expiresAt: Number.POSITIVE_INFINITY });
    cache.set('c', { result: baseResult, expiresAt: Number.POSITIVE_INFINITY });
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')?.result).toBe(baseResult);
    expect(cache.get('c')?.result).toBe(baseResult);
  });

  it('LRU touch on get keeps recently-read entries alive', () => {
    const cache = new MemoryVerifyCache({ maxEntries: 2 });
    cache.set('a', { result: baseResult, expiresAt: Number.POSITIVE_INFINITY });
    cache.set('b', { result: baseResult, expiresAt: Number.POSITIVE_INFINITY });
    // Touch 'a' → it becomes most-recent; next set evicts 'b'.
    cache.get('a');
    cache.set('c', { result: baseResult, expiresAt: Number.POSITIVE_INFINITY });
    expect(cache.get('a')?.result).toBe(baseResult);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')?.result).toBe(baseResult);
  });
});
