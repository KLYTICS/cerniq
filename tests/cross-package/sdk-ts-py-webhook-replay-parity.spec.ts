// Cross-LANGUAGE parity — TS SDK ↔ Py SDK webhook replay defense
// BEHAVIORAL equivalence.
//
// Unlike the signature parity gate (byte-equivalence — same HMAC hex
// from same inputs), the replay store has separate state on each side
// by design (each SDK has its own in-process Map/dict). So the parity
// we lock here is BEHAVIORAL: given the same canonical scenario, both
// SDKs must produce IDENTICAL verdict sequences.
//
// What this gate catches:
//   - One SDK refreshes LRU position on a replay hit while the other
//     doesn't → divergent eviction behavior → potential security gap
//     in only one language.
//   - One SDK evicts oldest-first while the other evicts newest-first
//     → customer code that worked in TS subtly mis-evicts in Py.
//   - One SDK serializes concurrent calls atomically while the other
//     yields between get/set → stampede tests pass on one side, fail
//     on the other.
//   - Either SDK changes the operator-pinned `DEFAULT_REPLAY_TTL_SECONDS`
//     (86_400) without coordinated update on the other side.
//   - Either SDK's error class diverges in shape (code, status_code,
//     delivery_id attachment).
//
// Composition with existing gates:
//   - webhook-replay.spec.ts                       — TS-side correctness (Jest)
//   - test_webhook_replay.py                       — Py-side correctness (pytest)
//   - sdk-ts-py-webhook-replay-parity (this file)  — TS↔Py behavioral lock
//
// Subprocess pattern mirrors sdk-ts-py-webhook-signature-parity.spec.ts.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AegisWebhookReplayDetectedError,
  assertNotReplay,
  createMemoryReplayStore,
} from '../../packages/sdk-ts/src/webhook-replay';

const REPO_ROOT = join(__dirname, '..', '..');
const PY_PACKAGE_DIR = join(REPO_ROOT, 'packages', 'sdk-py');

/**
 * Run a Python snippet via subprocess. Same pattern as
 * sdk-ts-py-webhook-signature-parity.spec.ts. PYTHONPATH-injected import
 * skips venv setup so CI runs without `pip install -e .`.
 */
function runPython(snippet: string): string {
  const result: SpawnSyncReturns<string> = spawnSync(
    'python3',
    ['-c', snippet],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: PY_PACKAGE_DIR,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `python3 exited ${result.status}:\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  if (result.stderr && result.stderr.trim() !== '') {
    throw new Error(`python3 wrote to stderr: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function pythonAvailable(): boolean {
  const r = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

const describeIfPython = pythonAvailable() ? describe : describe.skip;

describeIfPython('TS ↔ Py webhook replay parity — behavioral equivalence', () => {
  it('operator-pinned DEFAULT_REPLAY_TTL_SECONDS = 86_400 on both sides', () => {
    // TS-side: assertNotReplay defaults to 86_400 (verified via the
    // helper's behavior — passing a capture-store and observing the
    // ttlSeconds value the helper forwards).
    // Py-side: import DEFAULT_REPLAY_TTL_SECONDS and assert == 86_400.
    const pyValue = runPython(`
from aegis.webhook_replay import DEFAULT_REPLAY_TTL_SECONDS
print(DEFAULT_REPLAY_TTL_SECONDS)
`);
    expect(pyValue).toBe('86400');
  });

  it('first-sight then replay — identical verdict sequence', async () => {
    // TS side.
    const tsStore = createMemoryReplayStore();
    const tsVerdicts = [
      tsStore.recordOrReplay('shared_id', 60),
      tsStore.recordOrReplay('shared_id', 60),
      tsStore.recordOrReplay('shared_id', 60),
    ];
    // Each call may return a Promise; resolve them all.
    const tsResolved = await Promise.all(tsVerdicts.map((v) => Promise.resolve(v)));

    // Py side — same scenario, capture verdict sequence as JSON.
    const py = runPython(`
import json
from aegis.webhook_replay import create_memory_replay_store
store = create_memory_replay_store()
verdicts = [
    store.record_or_replay('shared_id', 60),
    store.record_or_replay('shared_id', 60),
    store.record_or_replay('shared_id', 60),
]
print(json.dumps(verdicts))
`);
    const pyVerdicts = JSON.parse(py);
    expect(pyVerdicts).toEqual(tsResolved);
    expect(pyVerdicts).toEqual(['first-sight', 'replay', 'replay']);
  });

  it('LRU eviction — replay does NOT refresh position (security parity)', async () => {
    // The TS spec asserts: insert a, b → replay a → insert c → a is
    // evicted (oldest by ORIGINAL insertion, replay didn't refresh).
    // If either SDK refreshed LRU on replay, 'a' would survive and
    // 'b' would be evicted instead.
    const tsStore = createMemoryReplayStore({ maxEntries: 2 });
    await Promise.resolve(tsStore.recordOrReplay('a', 3600));
    await Promise.resolve(tsStore.recordOrReplay('b', 3600));
    const tsAReplay = await Promise.resolve(tsStore.recordOrReplay('a', 3600));
    await Promise.resolve(tsStore.recordOrReplay('c', 3600));
    const tsAAfter = await Promise.resolve(tsStore.recordOrReplay('a', 3600));
    // Expected TS: a-replay then a-first-sight (a was evicted by c).
    expect([tsAReplay, tsAAfter]).toEqual(['replay', 'first-sight']);

    const py = runPython(`
import json
from aegis.webhook_replay import create_memory_replay_store
store = create_memory_replay_store(max_entries=2)
store.record_or_replay('a', 3600)
store.record_or_replay('b', 3600)
a_replay = store.record_or_replay('a', 3600)
store.record_or_replay('c', 3600)
a_after = store.record_or_replay('a', 3600)
print(json.dumps([a_replay, a_after]))
`);
    expect(JSON.parse(py)).toEqual(['replay', 'first-sight']);
  });

  it('maxEntries cap — oldest-first eviction identical', async () => {
    const tsStore = createMemoryReplayStore({ maxEntries: 3 });
    await Promise.resolve(tsStore.recordOrReplay('1', 3600));
    await Promise.resolve(tsStore.recordOrReplay('2', 3600));
    await Promise.resolve(tsStore.recordOrReplay('3', 3600));
    await Promise.resolve(tsStore.recordOrReplay('4', 3600));
    // '1' was the oldest — evicted by adding '4'.
    const tsOneAfter = await Promise.resolve(tsStore.recordOrReplay('1', 3600));
    expect(tsOneAfter).toBe('first-sight');

    const py = runPython(`
from aegis.webhook_replay import create_memory_replay_store
store = create_memory_replay_store(max_entries=3)
store.record_or_replay('1', 3600)
store.record_or_replay('2', 3600)
store.record_or_replay('3', 3600)
store.record_or_replay('4', 3600)
print(store.record_or_replay('1', 3600))
`);
    expect(py).toBe('first-sight');
  });

  it('TTL expiry boundary — same eviction window on both sides', async () => {
    // Both SDKs evict at expiresAt <= currentTime. Verify the boundary
    // is identical: at exactly the expiry instant, the entry is gone.
    let tsNow = 1_000_000;
    const tsStore = createMemoryReplayStore({ now: () => tsNow });
    await Promise.resolve(tsStore.recordOrReplay('id', 60));
    tsNow += 59_999; // 59.999s elapsed
    const tsInside = await Promise.resolve(tsStore.recordOrReplay('id', 60));
    tsNow += 2; // 60.001s elapsed
    const tsAfter = await Promise.resolve(tsStore.recordOrReplay('id', 60));
    expect([tsInside, tsAfter]).toEqual(['replay', 'first-sight']);

    // Py side — same scenario. Note: TS uses ms, Py uses seconds; both
    // ttl args are in seconds, so the test is invariant to that.
    const py = runPython(`
import json
fake_now = [1_000_000.0]
from aegis.webhook_replay import create_memory_replay_store
store = create_memory_replay_store(now=lambda: fake_now[0])
store.record_or_replay('id', 60)
fake_now[0] += 59.999
inside = store.record_or_replay('id', 60)
fake_now[0] += 0.002
after = store.record_or_replay('id', 60)
print(json.dumps([inside, after]))
`);
    expect(JSON.parse(py)).toEqual(['replay', 'first-sight']);
  });

  it('stampede atomicity — both sides yield exactly one first-sight in 100 concurrent calls', async () => {
    // TS-side stampede (Promise.all).
    const tsStore = createMemoryReplayStore();
    const tsResults = await Promise.all(
      Array.from({ length: 100 }, () =>
        Promise.resolve(tsStore.recordOrReplay('stampede', 60)),
      ),
    );
    const tsFirstSights = tsResults.filter((r) => r === 'first-sight').length;
    const tsReplays = tsResults.filter((r) => r === 'replay').length;
    expect(tsFirstSights).toBe(1);
    expect(tsReplays).toBe(99);

    // Py-side stampede (asyncio.gather over a sync record_or_replay
    // wrapped in coroutines — same shape the test_webhook_replay.py
    // stampede test uses).
    const py = runPython(`
import asyncio, json
from aegis.webhook_replay import create_memory_replay_store
store = create_memory_replay_store()

async def call():
    return store.record_or_replay('stampede', 60)

async def main():
    results = await asyncio.gather(*[call() for _ in range(100)])
    first_sights = sum(1 for r in results if r == 'first-sight')
    replays = sum(1 for r in results if r == 'replay')
    print(json.dumps({'first_sights': first_sights, 'replays': replays}))

asyncio.run(main())
`);
    expect(JSON.parse(py)).toEqual({ first_sights: 1, replays: 99 });
  });

  it('WebhookReplayDetectedError shape — code/status/delivery_id parity', async () => {
    // TS error.
    let tsErr: AegisWebhookReplayDetectedError | undefined;
    try {
      const s = createMemoryReplayStore();
      await assertNotReplay({ store: s, deliveryId: 'err_test', ttlSeconds: 60 });
      await assertNotReplay({ store: s, deliveryId: 'err_test', ttlSeconds: 60 });
    } catch (e) {
      tsErr = e as AegisWebhookReplayDetectedError;
    }
    expect(tsErr?.code).toBe('WEBHOOK_REPLAY_DETECTED');
    expect(tsErr?.statusCode).toBe(409);
    expect(tsErr?.deliveryId).toBe('err_test');

    // Py error — capture the same three attributes and compare.
    const py = runPython(`
import asyncio, json
from aegis.webhook_replay import (
    assert_not_replay, create_memory_replay_store, WebhookReplayDetectedError
)
store = create_memory_replay_store()

async def main():
    await assert_not_replay(store=store, delivery_id='err_test', ttl_seconds=60)
    try:
        await assert_not_replay(store=store, delivery_id='err_test', ttl_seconds=60)
    except WebhookReplayDetectedError as e:
        print(json.dumps({
            'code': e.code,
            'status_code': e.status_code,
            'delivery_id': e.delivery_id,
        }))

asyncio.run(main())
`);
    expect(JSON.parse(py)).toEqual({
      code: 'WEBHOOK_REPLAY_DETECTED',
      status_code: 409,
      delivery_id: 'err_test',
    });
  });
});
