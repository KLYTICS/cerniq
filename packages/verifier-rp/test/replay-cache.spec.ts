import { afterEach, describe, expect, it } from 'vitest';

import { MemoryReplayCache } from '../src/replay-cache.js';
import { resetClock, setClock } from '../src/_internal/time.js';

afterEach(() => resetClock());

describe('MemoryReplayCache', () => {
  it('records and detects a jti', () => {
    const cache = new MemoryReplayCache();
    expect(cache.has('jti1')).toBe(false);
    cache.set('jti1', 60);
    expect(cache.has('jti1')).toBe(true);
  });

  it('expires entries after their TTL', () => {
    let t = 1_000_000;
    setClock(() => t);
    const cache = new MemoryReplayCache();
    cache.set('jti1', 30); // 30 s
    expect(cache.has('jti1')).toBe(true);
    t += 30_001;
    expect(cache.has('jti1')).toBe(false);
  });

  it('evicts oldest entries past maxSize', () => {
    const cache = new MemoryReplayCache({ maxSize: 3 });
    cache.set('a', 60);
    cache.set('b', 60);
    cache.set('c', 60);
    cache.set('d', 60); // should evict 'a'
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('LRU touch on has() promotes entries', () => {
    const cache = new MemoryReplayCache({ maxSize: 3 });
    cache.set('a', 60);
    cache.set('b', 60);
    cache.set('c', 60);
    // touch 'a' so 'b' becomes oldest
    expect(cache.has('a')).toBe(true);
    cache.set('d', 60);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
  });

  it('delete removes an entry', () => {
    const cache = new MemoryReplayCache();
    cache.set('jti1', 60);
    cache.delete('jti1');
    expect(cache.has('jti1')).toBe(false);
  });

  it('clamps negative TTL to 0', () => {
    const cache = new MemoryReplayCache();
    cache.set('jti1', -10);
    // Already expired — has() should return false.
    expect(cache.has('jti1')).toBe(false);
  });

  it('size reflects number of live entries', () => {
    const cache = new MemoryReplayCache();
    cache.set('a', 60);
    cache.set('b', 60);
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
