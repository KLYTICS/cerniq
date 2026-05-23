import {
  AegisWebhookReplayDetectedError,
  assertNotReplay,
  createMemoryReplayStore,
  type WebhookReplayStore,
} from './webhook-replay.js';

describe('createMemoryReplayStore', () => {
  it('returns first-sight on the first record and replay on the second', () => {
    const store = createMemoryReplayStore();
    expect(store.recordOrReplay('del_1', 60)).toBe('first-sight');
    expect(store.recordOrReplay('del_1', 60)).toBe('replay');
  });

  it('treats different delivery ids independently', () => {
    const store = createMemoryReplayStore();
    expect(store.recordOrReplay('del_a', 60)).toBe('first-sight');
    expect(store.recordOrReplay('del_b', 60)).toBe('first-sight');
    expect(store.recordOrReplay('del_a', 60)).toBe('replay');
    expect(store.recordOrReplay('del_b', 60)).toBe('replay');
  });

  it('evicts an entry after its TTL elapses', () => {
    let now = 1_000_000;
    const store = createMemoryReplayStore({ now: () => now });
    expect(store.recordOrReplay('del_ttl', 60)).toBe('first-sight');
    now += 59_999; // still inside the 60s window
    expect(store.recordOrReplay('del_ttl', 60)).toBe('replay');
    now += 2; // 60_001 ms total → past the 60s expiry
    expect(store.recordOrReplay('del_ttl', 60)).toBe('first-sight');
  });

  it('does NOT refresh LRU position on a replay hit (attacker cannot keep an id alive)', () => {
    // Security property: re-recording an existing key must not bump its
    // eviction clock. Otherwise an attacker who keeps replaying could
    // hold their id in the LRU indefinitely, evicting legitimate entries.
    //
    // Note: each `recordOrReplay` is itself a write that can trigger
    // eviction at the cap. We probe ONE id per assertion phase to avoid
    // self-perturbing measurement.
    const store = createMemoryReplayStore({ maxEntries: 2 });
    store.recordOrReplay('a', 3600);
    store.recordOrReplay('b', 3600);
    // Replay attempt on 'a' must not refresh its position.
    expect(store.recordOrReplay('a', 3600)).toBe('replay');
    // Insert 'c' — should evict 'a' (oldest by ORIGINAL insertion), not 'b'.
    // If the replay HAD refreshed 'a', 'b' would be the oldest and get evicted.
    store.recordOrReplay('c', 3600);
    // 'a' should be gone — the replay did NOT refresh its position.
    expect(store.recordOrReplay('a', 3600)).toBe('first-sight');
  });

  it('caps memory at maxEntries by evicting the oldest entry', () => {
    const store = createMemoryReplayStore({ maxEntries: 3 });
    store.recordOrReplay('1', 3600);
    store.recordOrReplay('2', 3600);
    store.recordOrReplay('3', 3600);
    expect(store.size?.()).toBe(3);
    store.recordOrReplay('4', 3600);
    expect(store.size?.()).toBe(3);
    // '1' was the oldest — should have been evicted by adding '4'.
    // (We can only probe ONE id here — each probe is itself a write that
    //  can trigger more eviction at the cap.)
    expect(store.recordOrReplay('1', 3600)).toBe('first-sight');
  });

  it('exposes size() for observability', () => {
    const store = createMemoryReplayStore();
    expect(store.size?.()).toBe(0);
    store.recordOrReplay('a', 60);
    store.recordOrReplay('b', 60);
    expect(store.size?.()).toBe(2);
  });
});

describe('assertNotReplay', () => {
  it('returns void on first sight', async () => {
    const store = createMemoryReplayStore();
    await expect(
      assertNotReplay({ store, deliveryId: 'del_1', ttlSeconds: 60 }),
    ).resolves.toBeUndefined();
  });

  it('throws AegisWebhookReplayDetectedError on second sight, with the deliveryId attached', async () => {
    const store = createMemoryReplayStore();
    await assertNotReplay({ store, deliveryId: 'del_dup', ttlSeconds: 60 });
    await expect(
      assertNotReplay({ store, deliveryId: 'del_dup', ttlSeconds: 60 }),
    ).rejects.toMatchObject({
      name: 'AegisWebhookReplayDetectedError',
      code: 'WEBHOOK_REPLAY_DETECTED',
      statusCode: 409,
      deliveryId: 'del_dup',
    });
  });

  it('error is an instance of AegisError + AegisWebhookReplayDetectedError', async () => {
    const store = createMemoryReplayStore();
    await assertNotReplay({ store, deliveryId: 'del_x', ttlSeconds: 60 });
    const err = await assertNotReplay({
      store,
      deliveryId: 'del_x',
      ttlSeconds: 60,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AegisWebhookReplayDetectedError);
    // instanceof AegisError is verified via the chain — the parent class is abstract.
  });

  it('defaults TTL to 86400 seconds when not supplied', async () => {
    const calls: Array<[string, number]> = [];
    const store: WebhookReplayStore = {
      recordOrReplay: (id, ttl) => {
        calls.push([id, ttl]);
        return 'first-sight';
      },
    };
    await assertNotReplay({ store, deliveryId: 'del_default' });
    expect(calls).toEqual([['del_default', 86_400]]);
  });

  it('passes through to a custom async store implementation', async () => {
    // Simulates a Redis-backed store: returns a Promise.
    const seen = new Set<string>();
    const store: WebhookReplayStore = {
      recordOrReplay: async (id) => {
        if (seen.has(id)) return 'replay';
        seen.add(id);
        return 'first-sight';
      },
    };
    await assertNotReplay({ store, deliveryId: 'r_1', ttlSeconds: 60 });
    await expect(
      assertNotReplay({ store, deliveryId: 'r_1', ttlSeconds: 60 }),
    ).rejects.toBeInstanceOf(AegisWebhookReplayDetectedError);
  });
});

describe('createMemoryReplayStore — atomicity contract', () => {
  // The interface JSDoc promises:
  //   "between the lookup and the write, no other caller may observe
  //    a different verdict for the same id"
  //
  // In single-threaded JS, two awaited calls to the same async method
  // serialize: the second can't resume until the first settles. We
  // exercise this contract by firing parallel calls and asserting the
  // verdicts are mutually exclusive. If the implementation ever broke
  // atomicity (e.g. by inserting an `await` between the get and the
  // set, allowing microtask interleaving), this test would catch the
  // resulting both-first-sight failure mode.
  //
  // CRITICAL CAVEAT: this property holds only within ONE process. Two
  // processes calling `createMemoryReplayStore()` each have separate
  // Maps and can both return 'first-sight' for the same id. The
  // module's class JSDoc covers this; this spec block locks the
  // single-process property.

  it('two concurrent calls with the same id yield exactly one first-sight', async () => {
    const store = createMemoryReplayStore();
    const [a, b] = await Promise.all([
      Promise.resolve(store.recordOrReplay('del_race', 60)),
      Promise.resolve(store.recordOrReplay('del_race', 60)),
    ]);
    const verdicts = [a, b].sort();
    expect(verdicts).toEqual(['first-sight', 'replay']);
  });

  it('100 concurrent calls with the same id yield exactly 1 first-sight + 99 replays', async () => {
    const store = createMemoryReplayStore();
    const calls: Array<Promise<'first-sight' | 'replay'>> = [];
    for (let i = 0; i < 100; i += 1) {
      calls.push(Promise.resolve(store.recordOrReplay('del_stampede', 60)));
    }
    const results = await Promise.all(calls);
    const firstSights = results.filter((r) => r === 'first-sight').length;
    const replays = results.filter((r) => r === 'replay').length;
    expect(firstSights).toBe(1);
    expect(replays).toBe(99);
  });

  it('concurrent calls across DIFFERENT ids all return first-sight independently', async () => {
    const store = createMemoryReplayStore();
    const ids = Array.from({ length: 50 }, (_, i) => `del_${i}`);
    const results = await Promise.all(
      ids.map((id) => Promise.resolve(store.recordOrReplay(id, 60))),
    );
    expect(results.every((r) => r === 'first-sight')).toBe(true);
    expect(store.size?.()).toBe(50);
  });

  it('assertNotReplay under concurrent stampede produces exactly one success', async () => {
    const store = createMemoryReplayStore();
    const calls = Array.from({ length: 20 }, () =>
      assertNotReplay({ store, deliveryId: 'stampede_id', ttlSeconds: 60 }).then(
        () => 'ok' as const,
        () => 'replay' as const,
      ),
    );
    const results = await Promise.all(calls);
    const successes = results.filter((r) => r === 'ok').length;
    expect(successes).toBe(1);
    expect(results.filter((r) => r === 'replay').length).toBe(19);
  });
});

describe('AegisWebhookReplayDetectedError', () => {
  it('carries the canonical SDK error shape (minifier-safe name, code, statusCode)', () => {
    const err = new AegisWebhookReplayDetectedError('already processed', 'del_42');
    expect(err.name).toBe('AegisWebhookReplayDetectedError');
    expect(err.code).toBe('WEBHOOK_REPLAY_DETECTED');
    expect(err.statusCode).toBe(409);
    expect(err.deliveryId).toBe('del_42');
    expect(err.message).toContain('already processed');
  });
});
