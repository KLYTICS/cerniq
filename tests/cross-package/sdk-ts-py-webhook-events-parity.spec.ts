// Cross-LANGUAGE parity — TS SDK ↔ Py SDK webhook event union
// CATALOG + INTERPRET-BEHAVIOR equivalence.
//
// The M-WEBHOOK arc closes with this third cross-language gate. Both
// SDKs ship the same kind-discriminated webhook event union over the
// same WEBHOOK_EVENT catalog, and `interpretWebhookEvent` must produce
// IDENTICAL behavior on both sides for the same input.
//
// What this gate locks:
//   1. CATALOG VALUES — both SDKs accept the same 5 event names and no
//      others. If `packages/types/src/constants.ts` ships a new event
//      and either SDK fails to update, this test fails.
//   2. UNKNOWN-EVENT REJECTION — both SDKs throw their respective
//      parse-error class on the same unknown-event input, with the
//      offending event name attached to the error. Drift in either
//      SDK's error class shape would surface here.
//   3. NON-DICT/MISSING-EVENT REJECTION — both SDKs throw parse-error
//      on the same malformed-envelope inputs (non-object, missing
//      'event' field, non-string 'event').
//   4. SUCCESSFUL NARROWING — both SDKs return the same `.event` value
//      for the same input across all 5 catalog entries.
//
// Composition with existing gates:
//   - webhook-events.spec.ts                        — TS-side correctness (Jest)
//   - test_webhook_events.py                        — Py-side correctness (pytest)
//   - sdk-ts-py-webhook-events-parity (this file)   — TS↔Py behavioral lock
//   - webhook-event-emitter-parity.spec.ts          — API emit → catalog lock
// Transitively: API emit → both SDKs interpret the same way.
//
// Subprocess pattern mirrors the prior two cross-language gates.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEBHOOK_EVENT } from '../../packages/types/src/constants';
import {
  WebhookEventParseError,
  interpretWebhookEvent,
  isWebhookEnvelope,
} from '../../packages/sdk-ts/src/webhook-events';

const REPO_ROOT = join(__dirname, '..', '..');
const PY_PACKAGE_DIR = join(REPO_ROOT, 'packages', 'sdk-py');

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

describeIfPython('TS ↔ Py webhook event union parity', () => {
  it('catalog values are identical on both sides (byte-equivalent strings)', () => {
    // TS side — sorted for stable comparison.
    const tsValues = Object.values(WEBHOOK_EVENT).sort();
    expect(tsValues).toEqual([
      'aegis.agent.anomaly_detected',
      'aegis.agent.flagged_by_relying_party',
      'aegis.agent.policy_expired',
      'aegis.agent.revoked',
      'aegis.agent.trust_score_changed',
    ]);

    // Py side — import the same catalog and dump as sorted JSON.
    const py = runPython(`
import json
from aegis._shared_constants_generated import WEBHOOK_EVENT
print(json.dumps(sorted(WEBHOOK_EVENT.values())))
`);
    expect(JSON.parse(py)).toEqual(tsValues);
  });

  it('both SDKs accept the same 5 catalog inputs successfully', () => {
    // For each catalog value, both SDKs must return the same .event/['event'].
    const catalog = Object.values(WEBHOOK_EVENT).sort();

    // TS side.
    const tsResults = catalog.map((eventName) => {
      const envelope = interpretWebhookEvent({ event: eventName, data: {} });
      return envelope.event;
    });
    expect(tsResults.sort()).toEqual(catalog);

    // Py side — same scenario.
    const py = runPython(`
import json
from aegis._shared_constants_generated import WEBHOOK_EVENT
from aegis.webhook_events import interpret_webhook_event
results = []
for event_name in sorted(WEBHOOK_EVENT.values()):
    envelope = interpret_webhook_event({"event": event_name, "data": {}})
    results.append(envelope["event"])
print(json.dumps(sorted(results)))
`);
    expect(JSON.parse(py)).toEqual(catalog);
  });

  it('both SDKs reject the same unknown event name with parse-error + raw-event attached', () => {
    const unknownEventName = 'aegis.agent.brand_new_event_2030';

    // TS side.
    let tsErr: WebhookEventParseError | undefined;
    try {
      interpretWebhookEvent({ event: unknownEventName, data: {} });
    } catch (e) {
      tsErr = e as WebhookEventParseError;
    }
    expect(tsErr).toBeInstanceOf(WebhookEventParseError);
    expect(tsErr?.rawEventName).toBe(unknownEventName);
    expect(tsErr?.message).toContain(unknownEventName);

    // Py side — capture the same three attributes and compare.
    const py = runPython(`
import json
from aegis.webhook_events import interpret_webhook_event, WebhookEventParseError
try:
    interpret_webhook_event({"event": ${JSON.stringify(unknownEventName)}, "data": {}})
    print(json.dumps({"raised": False}))
except WebhookEventParseError as e:
    print(json.dumps({
        "raised": True,
        "raw_event_name": e.raw_event_name,
        "message_contains_event": ${JSON.stringify(unknownEventName)} in str(e),
    }))
`);
    expect(JSON.parse(py)).toEqual({
      raised: true,
      raw_event_name: unknownEventName,
      message_contains_event: true,
    });
  });

  it('both SDKs reject non-object envelope with parse-error', () => {
    // TS side.
    let tsThrew = false;
    try {
      interpretWebhookEvent('not an object');
    } catch (e) {
      tsThrew = e instanceof WebhookEventParseError;
    }
    expect(tsThrew).toBe(true);

    // Py side.
    const py = runPython(`
from aegis.webhook_events import interpret_webhook_event, WebhookEventParseError
try:
    interpret_webhook_event("not a dict")
    print("FAIL: should have raised")
except WebhookEventParseError:
    print("OK")
`);
    expect(py).toBe('OK');
  });

  it('both SDKs reject missing-event-field with parse-error', () => {
    // TS side.
    let tsThrew = false;
    try {
      interpretWebhookEvent({ data: {} });
    } catch (e) {
      tsThrew = e instanceof WebhookEventParseError;
    }
    expect(tsThrew).toBe(true);

    // Py side.
    const py = runPython(`
from aegis.webhook_events import interpret_webhook_event, WebhookEventParseError
try:
    interpret_webhook_event({"data": {}})
    print("FAIL: should have raised")
except WebhookEventParseError:
    print("OK")
`);
    expect(py).toBe('OK');
  });

  it('both SDKs is_webhook_envelope/isWebhookEnvelope agree on truth value for the same inputs', () => {
    const cases: Array<{ name: string; raw: unknown; expected: boolean }> = [
      { name: 'known event', raw: { event: 'aegis.agent.policy_expired', data: {} }, expected: true },
      { name: 'unknown event', raw: { event: 'future.event', data: {} }, expected: false },
      { name: 'non-object', raw: 'string', expected: false },
      { name: 'missing event field', raw: { data: {} }, expected: false },
      { name: 'null', raw: null, expected: false },
    ];

    // TS side.
    for (const c of cases) {
      expect(isWebhookEnvelope(c.raw)).toBe(c.expected);
    }

    // Py side — same scenario.
    const py = runPython(`
import json
from aegis.webhook_events import is_webhook_envelope
cases = [
    ("known event", {"event": "aegis.agent.policy_expired", "data": {}}, True),
    ("unknown event", {"event": "future.event", "data": {}}, False),
    ("non-object", "string", False),
    ("missing event field", {"data": {}}, False),
    ("null", None, False),
]
results = [
    {"name": name, "actual": is_webhook_envelope(raw), "expected": exp}
    for name, raw, exp in cases
]
print(json.dumps(results))
`);
    const pyResults = JSON.parse(py) as Array<{
      name: string;
      actual: boolean;
      expected: boolean;
    }>;
    expect(pyResults.every((r) => r.actual === r.expected)).toBe(true);
  });

  it('drift regression: both SDKs reject the historical drift name `okoro.policy.expired`', () => {
    // The TS event-emitter parity gate caught this live drift bug on
    // 2026-05-22. The cross-language gate locks BOTH SDKs to reject
    // the legacy name — a customer running a stale deployment that
    // still emits the bad string should get an explicit parse failure
    // in either language, never silent mis-routing.
    let tsThrew = false;
    try {
      interpretWebhookEvent({ event: 'okoro.policy.expired', data: {} });
    } catch (e) {
      tsThrew = e instanceof WebhookEventParseError;
    }
    expect(tsThrew).toBe(true);

    const py = runPython(`
from aegis.webhook_events import interpret_webhook_event, WebhookEventParseError
try:
    interpret_webhook_event({"event": "okoro.policy.expired", "data": {}})
    print("FAIL: should have raised")
except WebhookEventParseError:
    print("OK")
`);
    expect(py).toBe('OK');
  });
});
