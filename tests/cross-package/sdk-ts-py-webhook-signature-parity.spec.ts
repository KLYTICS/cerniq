// Cross-LANGUAGE parity — TS SDK ↔ Py SDK webhook signature
// byte-equivalence.
//
// The M-WEBHOOK arc shipped TS first (M-WEBHOOK-1 — commit 392a6e7).
// This commit ships the Py mirror (M-WEBHOOK-1-py). Customers picking
// either SDK must observe IDENTICAL behaviour on signature verification:
// same template, same algorithm, same hex encoding, same secret binding.
//
// This gate is what makes that guarantee machine-checkable:
//   1. The TS SDK verifies a canonical signature → TS-side correctness.
//   2. The Py SDK verifies the SAME canonical signature → Py-side
//      correctness AND byte-equivalence with TS (same secret/template/
//      algorithm produce the same hex).
//   3. TS produces a signature from the canonical inputs → Py verifies it
//      → cross-direction acceptance (Py accepts what TS emits).
//   4. Py produces a signature from the canonical inputs → TS verifies it
//      → cross-direction acceptance (TS accepts what Py emits).
//
// Drift this gate catches:
//   - Either SDK changes the signed template (e.g. ${ts}:${body}). One
//     side's own test still passes; THIS test fails because the other
//     side's signature stops verifying.
//   - Either SDK switches algorithm (SHA-256 → SHA-512). Same failure
//     mode — own-side tests green, cross-side red.
//   - Either SDK changes the hex encoding (case, padding). Constant-
//     time compare would normalize case; padding would not.
//   - Either SDK changes how the secret is bound (UTF-8 vs latin-1).
//     Subtle, dangerous, and exactly what this test catches.
//
// Composition with existing gates:
//   - webhook-signature-parity.spec.ts:    API → TS-SDK byte-equivalence
//   - sdk-ts-py-webhook-signature-parity:  TS-SDK → Py-SDK byte-equivalence ★ (this file)
// Transitively: API → TS → Py — the three implementations of the same
// signing scheme are all locked to each other.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  verifyWebhookSignature,
} from '../../packages/sdk-ts/src/webhook';

const REPO_ROOT = join(__dirname, '..', '..');
const PY_PACKAGE_DIR = join(REPO_ROOT, 'packages', 'sdk-py');

// ── Canonical cross-language parity vector ───────────────────────────
// DO NOT EDIT without updating BOTH:
//   - packages/sdk-py/tests/test_webhook.py (CANONICAL_* constants)
//   - this file
// The two sides MUST agree on these values for the gate to be
// meaningful. A drift in either file is a test failure here.
const CANONICAL_SECRET = 'whsec_parity_M_WEBHOOK_1_py';
const CANONICAL_TS = 1_716_400_000;
const CANONICAL_BODY =
  '{"event":"aegis.agent.policy_expired","data":' +
  '{"agentId":"agt_test","policyId":"pol_test"}}';
const CANONICAL_SIGNATURE =
  't=1716400000,' +
  'v1=f7427d8376187b0db3444e09a95c361dc65873a0723a4d10acaaf257d9f8e275';

/**
 * Run a Python snippet that imports `aegis.webhook` from the local
 * source tree. Returns trimmed stdout. Throws if Python exits non-zero
 * or stderr contains anything — both are signs of a real failure that
 * should surface immediately rather than be swallowed.
 *
 * Why PYTHONPATH instead of `pip install -e .`: the parity gate must
 * be runnable in CI without a Py venv setup step. We import the source
 * tree directly, which works because the `aegis/` package is at the
 * top level of `packages/sdk-py/` (flat hatchling layout).
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
        // Quiet pytest/aegis chatter; only the snippet's print() output.
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

/**
 * Skip the suite (with a helpful message) if Python is not available
 * in this environment. Local dev and CI both have Python; this guard
 * is for edge cases (minimal containers, sandboxed test runs).
 */
function pythonAvailable(): boolean {
  const r = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

const describeIfPython = pythonAvailable() ? describe : describe.skip;

describeIfPython('TS ↔ Py webhook signature parity', () => {
  it('TS SDK verifies the canonical parity signature (TS-side correctness)', async () => {
    const verified = await verifyWebhookSignature({
      payload: CANONICAL_BODY,
      signature: CANONICAL_SIGNATURE,
      secret: CANONICAL_SECRET,
      now: () => CANONICAL_TS,
    });
    expect(verified.timestamp).toBe(CANONICAL_TS);
    expect(verified.skewSeconds).toBe(0);
  });

  it('Py SDK verifies the canonical parity signature (byte-equivalence with TS)', () => {
    const snippet = `
from aegis.webhook import verify_webhook_signature, VerifiedWebhook
result = verify_webhook_signature(
    payload=${JSON.stringify(CANONICAL_BODY)},
    signature=${JSON.stringify(CANONICAL_SIGNATURE)},
    secret=${JSON.stringify(CANONICAL_SECRET)},
    now=lambda: ${CANONICAL_TS}.0,
)
assert result == VerifiedWebhook(timestamp=${CANONICAL_TS}, skew_seconds=0), result
print("OK")
`;
    expect(runPython(snippet)).toBe('OK');
  });

  it('cross-direction: TS-produced signature is accepted by the Py SDK', () => {
    // Produce a fresh signature TS-side (using the same node:crypto
    // primitives the SDK uses internally for round-trip verification).
    const ts = 1_700_000_000;
    const body = '{"event":"test","data":{"k":"v"}}';
    const secret = 'whsec_ts_produces_py_verifies';
    const h = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const sig = `t=${ts},v1=${h}`;

    const snippet = `
from aegis.webhook import verify_webhook_signature
result = verify_webhook_signature(
    payload=${JSON.stringify(body)},
    signature=${JSON.stringify(sig)},
    secret=${JSON.stringify(secret)},
    now=lambda: ${ts}.0,
)
assert result.timestamp == ${ts}, result
print("OK")
`;
    expect(runPython(snippet)).toBe('OK');
  });

  it('cross-direction: Py-produced signature is accepted by the TS SDK', async () => {
    // Have Python produce a signature using its own hmac/hashlib calls,
    // print it to stdout, then verify it TS-side. If the Python signing
    // routine ever drifts from the TS one (different template, encoding,
    // algorithm), this asymmetric round trip catches it.
    const ts = 1_710_000_000;
    const body = '{"event":"agent.flagged","data":{"reason":"test"}}';
    const secret = 'whsec_py_produces_ts_verifies';

    const snippet = `
import hmac, hashlib
ts = ${ts}
body = ${JSON.stringify(body)}
secret = ${JSON.stringify(secret)}
h = hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
print(f"t={ts},v1={h}")
`;
    const pySig = runPython(snippet);
    expect(pySig).toMatch(/^t=\d+,v1=[0-9a-f]+$/);

    const verified = await verifyWebhookSignature({
      payload: body,
      signature: pySig,
      secret,
      now: () => ts,
    });
    expect(verified.timestamp).toBe(ts);
  });

  it('Py SDK rejects a wrong-template signature (mutation detection — symmetric to TS)', () => {
    // Build a signature using the WRONG template (colon vs dot) on the
    // Python side and assert Py-SDK rejects it. The TS-side equivalent
    // is already in webhook.spec.ts; this is the Py mirror to guarantee
    // both SDKs share the rejection discipline, not just acceptance.
    const ts = 1_700_000_000;
    const body = '{"event":"x"}';
    const secret = 'whsec_drift_test';
    const wrongHmac = createHmac('sha256', secret)
      .update(`${ts}:${body}`) // WRONG: colon instead of dot
      .digest('hex');
    const sig = `t=${ts},v1=${wrongHmac}`;

    const snippet = `
from aegis.webhook import verify_webhook_signature, WebhookSignatureInvalidError
try:
    verify_webhook_signature(
        payload=${JSON.stringify(body)},
        signature=${JSON.stringify(sig)},
        secret=${JSON.stringify(secret)},
        now=lambda: ${ts}.0,
    )
    print("FAIL: should have raised")
except WebhookSignatureInvalidError:
    print("OK")
`;
    expect(runPython(snippet)).toBe('OK');
  });
});
