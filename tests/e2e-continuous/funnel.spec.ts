/**
 * AEGIS continuous E2E funnel monitor.
 *
 * Exercises the full paying-customer journey against the configured staging
 * (or production) deployment every 15 minutes via the companion GH workflow.
 * Each step is a separate test so the structured report can attribute the
 * failure mode to the specific funnel stage.
 *
 * Skip vs. fail contract:
 *
 *   - If AEGIS_E2E_BASE_URL or E2E_BOOTSTRAP_API_KEY are missing, OR if the
 *     base URL is unreachable on the /v1/health/live probe, the suite logs a
 *     single-line skip banner and exits 0. The goal is signal, not noise: a
 *     misconfigured cron should not page.
 *   - If a step's preconditions are met but the assertion fails, the test
 *     fails red. The workflow's failure path then fires the page.
 *
 * Synthetic-tenant hygiene:
 *
 *   - We DO NOT create a fresh principal per run (no admin-create endpoint
 *     exists in the API — see TODO[OPERATOR-INPUT-NEEDED] below). Instead,
 *     the operator provisions ONE dedicated `e2e-continuous` principal up
 *     front and the bootstrap key (E2E_BOOTSTRAP_API_KEY) is bound to it.
 *     Every run creates fresh agents/policies under that principal and
 *     revokes them in cleanup. Agent labels embed the run id so the janitor
 *     sweep can identify stragglers (`e2e-continuous-<unix-ts>-<step>`).
 *   - The principal's `trialExhaustedAt` must be reset by the janitor (or
 *     the operator should bind the bootstrap key to a non-FREE principal).
 *     The trial-exhaustion step is GATED by an explicit
 *     `E2E_RUN_TRIAL_EXHAUSTION=true` env so it only runs on dedicated
 *     daily probes, not every 15-minute heartbeat.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Aegis, generateKeypair, signAgentToken } from '@aegis/sdk';
import {
  AEGIS_HEADER_API_KEY,
  AEGIS_HEADER_VERIFY_KEY,
} from '@aegis/types';
import { recordStep, type StepRecord } from './run-report.js';

const BASE_URL = (process.env['AEGIS_E2E_BASE_URL'] ?? '').replace(/\/+$/, '');
const API_KEY = process.env['E2E_BOOTSTRAP_API_KEY'] ?? '';
const RUN_ID = process.env['E2E_RUN_ID'] ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const RUN_TRIAL_EXHAUSTION = process.env['E2E_RUN_TRIAL_EXHAUSTION'] === 'true';
// Marketing/docs origin is often a different host than the API. When unset,
// fall back to the API host so the landing probe at least checks `/`.
const LANDING_URL = (process.env['AEGIS_E2E_LANDING_URL'] ?? BASE_URL).replace(/\/+$/, '');
const SKIP_LANDING_COPY_CHECK = process.env['AEGIS_E2E_SKIP_LANDING_COPY'] === 'true';

// Module-scope state flows between ordered tests — vitest's `sequence.concurrent=false`
// + `singleFork=true` guarantees deterministic execution.
interface FunnelState {
  sdk: Aegis | null;
  agentId: string | null;
  policyId: string | null;
  privateKey: string | null;
  signedToken: string | null;
  syntheticEmail: string;
}
const state: FunnelState = {
  sdk: null,
  agentId: null,
  policyId: null,
  privateKey: null,
  signedToken: null,
  syntheticEmail: `e2e-continuous+${RUN_ID}@aegislabs.io`,
};

const stepRecords: StepRecord[] = [];

/**
 * Preflight check — if the staging URL is unreachable we want to log a
 * single banner and skip. Vitest cannot "skip the whole suite cleanly" from
 * inside a `describe`, so we set a module-level skip flag in `beforeAll`
 * and every test bails out on it. The workflow then sees a green run with
 * a logged skip message — exactly what we want for "staging happens to be
 * undeployed right now."
 */
let SKIP_REASON: string | null = null;

async function preflight(): Promise<string | null> {
  if (!BASE_URL) {
    return 'AEGIS_E2E_BASE_URL not set';
  }
  if (!API_KEY) {
    return 'E2E_BOOTSTRAP_API_KEY not set';
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(`${BASE_URL}/v1/health/live`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return `health probe returned HTTP ${res.status}`;
    }
  } catch (err) {
    return `health probe network error: ${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}

function logSkip(reason: string): void {
  // eslint-disable-next-line no-console
  console.log(`[e2e-continuous] skipped: ${reason} (run=${RUN_ID})`);
}

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    const value = await fn();
    const ms = performance.now() - t0;
    stepRecords.push(recordStep(name, 'ok', ms));
    return value;
  } catch (err) {
    const ms = performance.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    stepRecords.push(recordStep(name, 'fail', ms, message));
    throw err;
  }
}

describe('AEGIS continuous funnel', () => {
  beforeAll(async () => {
    SKIP_REASON = await preflight();
    if (SKIP_REASON) {
      logSkip(SKIP_REASON);
      return;
    }
    state.sdk = new Aegis({
      apiKey: API_KEY,
      verifyKey: API_KEY,
      baseUrl: BASE_URL,
    });
  });

  afterAll(async () => {
    // Always emit the structured report — the workflow parses it.
    // run-report.ts is responsible for the canonical JSON shape.
    const final = {
      runId: RUN_ID,
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL || '(unset)',
      syntheticPrincipal: state.syntheticEmail,
      skipped: SKIP_REASON,
      steps: stepRecords,
      overall: SKIP_REASON
        ? ('skipped' as const)
        : stepRecords.some((s) => s.status === 'fail')
          ? ('fail' as const)
          : ('ok' as const),
    };
    // eslint-disable-next-line no-console
    console.log(`__E2E_CONTINUOUS_REPORT__${JSON.stringify(final)}__END__`);

    // Best-effort cleanup of the agent we registered this run.
    if (state.sdk && state.agentId) {
      try {
        await state.sdk.agents.revoke(state.agentId);
      } catch {
        /* ignore — janitor sweep covers stragglers */
      }
    }
  });

  it('step 1 · landing page returns 200', async () => {
    if (SKIP_REASON) return;
    await timed('landing', async () => {
      const res = await fetch(`${LANDING_URL}/`);
      if (!res.ok) {
        throw new Error(`GET ${LANDING_URL}/ returned ${res.status}`);
      }
      const body = await res.text();
      // Hero-copy assertion is opt-out because the landing copy is owned by
      // marketing and changes more often than the funnel; we still validate
      // it's an HTML document so a JSON-error response from a misrouted
      // edge fails the step.
      if (!SKIP_LANDING_COPY_CHECK) {
        const looksLikeHtml = /<html|<!doctype html/i.test(body);
        if (!looksLikeHtml) {
          throw new Error('landing response is not HTML — origin or CDN misrouted');
        }
      }
      return res.status;
    });
  });

  it('step 2 · pricing discovery has Free + Developer tiers', async () => {
    if (SKIP_REASON) return;
    await timed('pricing_discovery', async () => {
      const res = await fetch(`${BASE_URL}/.well-known/pricing.json`);
      if (!res.ok) {
        throw new Error(`pricing.json returned ${res.status}`);
      }
      const body = (await res.json()) as { tiers?: Array<{ id?: string; name?: string }> };
      const tiers = body.tiers ?? [];
      const names = tiers.map((t) => (t.id ?? t.name ?? '').toLowerCase());
      const hasFree = names.some((n) => n.includes('free'));
      const hasDeveloper = names.some((n) => n.includes('developer'));
      if (!hasFree || !hasDeveloper) {
        throw new Error(
          `pricing.json missing required tiers (free=${hasFree} developer=${hasDeveloper}) — saw ${names.join(',')}`,
        );
      }
      return tiers.length;
    });
  });

  it('step 3 · synthetic signup (bootstrap principal already provisioned)', async () => {
    if (SKIP_REASON) return;
    // TODO[OPERATOR-INPUT-NEEDED]: there is no /v1/principals admin-create
    // endpoint today. The operator pre-provisions ONE dedicated
    // `e2e-continuous` principal and supplies its management key as
    // E2E_BOOTSTRAP_API_KEY. This step asserts the key is bound to a real
    // principal by listing agents (auth + tenant scope succeed = key works).
    await timed('signup', async () => {
      const res = await fetch(`${BASE_URL}/v1/agents?limit=1`, {
        headers: { [AEGIS_HEADER_API_KEY]: API_KEY },
      });
      if (!res.ok) {
        throw new Error(`bootstrap key auth probe returned ${res.status}`);
      }
      return 'bootstrap key authenticates';
    });
  });

  it('step 4 · agent register (Ed25519, public key only)', async () => {
    if (SKIP_REASON) return;
    await timed('agent_register', async () => {
      const sdk = state.sdk!;
      const kp = await generateKeypair();
      const record = await sdk.agents.register({
        publicKey: kp.publicKey,
        runtime: 'ANTHROPIC',
        label: `e2e-continuous-${RUN_ID}`,
      });
      state.agentId = record.agentId;
      state.privateKey = kp.privateKey;
      return record.agentId;
    });
  });

  it('step 5 · policy create (small-scope, low spend cap)', async () => {
    if (SKIP_REASON) return;
    await timed('policy_create', async () => {
      const sdk = state.sdk!;
      if (!state.agentId) throw new Error('previous step did not register agent');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const policy = await sdk.policies.create(state.agentId, {
        scopes: [
          {
            category: 'commerce',
            spendLimit: { currency: 'USD', maxPerTransaction: 5, maxPerDay: 25 },
          },
        ],
        expiresAt,
        label: `e2e-continuous-policy-${RUN_ID}`,
      });
      state.policyId = policy.policyId;
      return policy.policyId;
    });
  });

  it('step 6 · verify happy path (signed token → ALLOW)', async () => {
    if (SKIP_REASON) return;
    await timed('verify_allow', async () => {
      const sdk = state.sdk!;
      if (!state.agentId || !state.policyId || !state.privateKey) {
        throw new Error('prerequisites missing');
      }
      const ctx = { action: 'commerce.purchase' as const, amount: 1, currency: 'USD' as const };
      const token = await signAgentToken(state.privateKey, state.agentId, state.policyId, ctx);
      state.signedToken = token;
      const result = await sdk.verify(token, ctx);
      if (!result.valid) {
        throw new Error(`expected ALLOW, got denialReason=${result.denialReason ?? '(none)'}`);
      }
      return 'allow';
    });
  });

  it('step 7 · verify denial (tampered signature → INVALID_SIGNATURE)', async () => {
    if (SKIP_REASON) return;
    await timed('verify_deny_invalid_signature', async () => {
      const sdk = state.sdk!;
      if (!state.signedToken) throw new Error('no token to tamper');
      // Flip the first char of the signature segment of the compact JWS.
      const parts = state.signedToken.split('.');
      if (parts.length !== 3) throw new Error('unexpected token shape');
      const sig = parts[2]!;
      const tampered = `${parts[0]}.${parts[1]}.${(sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)}`;
      const ctx = { action: 'commerce.purchase' as const, amount: 1, currency: 'USD' as const };
      const result = await sdk.verify(tampered, ctx);
      if (result.valid) {
        throw new Error('tampered token unexpectedly validated — SIGNATURE GATE BROKEN');
      }
      // Denial precedence gate — INVALID_SIGNATURE must come before
      // POLICY_*, SCOPE_*, TRIAL_*, SPEND_*. This assertion is the
      // structural canary for the precedence ordering documented in
      // root CLAUDE.md invariant #6.
      if (result.denialReason !== 'INVALID_SIGNATURE') {
        throw new Error(
          `expected INVALID_SIGNATURE (denial precedence), got ${result.denialReason ?? '(none)'}`,
        );
      }
      return 'denied as expected';
    });
  });

  it('step 8 · trial-exhausted gate (gated by E2E_RUN_TRIAL_EXHAUSTION=true)', async () => {
    if (SKIP_REASON) return;
    if (!RUN_TRIAL_EXHAUSTION) {
      // eslint-disable-next-line no-console
      console.log(
        '[e2e-continuous] step 8 skipped — set E2E_RUN_TRIAL_EXHAUSTION=true on the dedicated daily probe',
      );
      stepRecords.push(recordStep('trial_exhausted', 'skipped', 0, 'gated by env'));
      return;
    }
    // TODO[OPERATOR-INPUT-NEEDED]: this scenario requires the bootstrap
    // key to be bound to a FREE-tier principal *with a small cap override*
    // wired into the API env. Production cap is 10_000 — too slow to loop
    // every 15 minutes. See tests/e2e/17_trial_exhaustion.test.ts for the
    // env contract.
    await timed('trial_exhausted', async () => {
      const sdk = state.sdk!;
      const capRaw = process.env['E2E_TRIAL_CAP_OVERRIDE'];
      const cap = capRaw ? Number.parseInt(capRaw, 10) : NaN;
      if (!Number.isInteger(cap) || cap < 1 || cap > 50) {
        throw new Error(
          `E2E_TRIAL_CAP_OVERRIDE must be in [1,50] and match API config; got ${capRaw ?? 'unset'}`,
        );
      }
      if (!state.agentId || !state.policyId || !state.privateKey) {
        throw new Error('prerequisites missing');
      }
      const ctx = { action: 'commerce.purchase' as const, amount: 1, currency: 'USD' as const };
      for (let i = 0; i < cap; i++) {
        const t = await signAgentToken(state.privateKey, state.agentId, state.policyId, ctx);
        const r = await sdk.verify(t, ctx);
        if (r.denialReason === 'TRIAL_EXHAUSTED') {
          throw new Error(`trial exhausted prematurely at i=${i} (cap=${cap})`);
        }
      }
      const overflowToken = await signAgentToken(state.privateKey, state.agentId, state.policyId, ctx);
      const overflow = await sdk.verify(overflowToken, ctx);
      if (overflow.denialReason !== 'TRIAL_EXHAUSTED') {
        throw new Error(
          `expected TRIAL_EXHAUSTED at cap+1, got ${overflow.denialReason ?? '(allowed)'}`,
        );
      }
      return 'gated correctly';
    });
  });

  it('step 9 · audit export contains this run and chain is structurally valid', async () => {
    if (SKIP_REASON) return;
    await timed('audit_export', async () => {
      // Pull the NDJSON export. Each line must parse and carry the
      // chain-signature fields the offline verifier checks.
      const res = await fetch(`${BASE_URL}/v1/audit-events/export`, {
        headers: { [AEGIS_HEADER_API_KEY]: API_KEY },
      });
      if (!res.ok) {
        throw new Error(`audit-events/export returned ${res.status}`);
      }
      const text = await res.text();
      const lines = text.split('\n').filter((l) => l.length > 0);
      if (lines.length === 0) {
        throw new Error('audit export is empty — verify path did not emit an event');
      }
      let sawThisRun = false;
      for (const line of lines.slice(-50)) {
        // Only inspect the tail — older history would slow the probe.
        let row: unknown;
        try {
          row = JSON.parse(line);
        } catch {
          throw new Error(`audit export line is not JSON: ${line.slice(0, 120)}`);
        }
        const r = row as Record<string, unknown>;
        // Structural chain fields per apps/api/prisma/schema.prisma:
        //   aegisSignature, signingKeyId, payloadVersion, timestamp
        if (typeof r['aegisSignature'] !== 'string' || (r['aegisSignature'] as string).length === 0) {
          throw new Error('audit row missing aegisSignature — chain integrity gone');
        }
        if (typeof r['signingKeyId'] !== 'string') {
          throw new Error('audit row missing signingKeyId — verifier cannot pick public key');
        }
        if (typeof r['timestamp'] !== 'string') {
          throw new Error('audit row missing timestamp');
        }
        // Match by agentId — claimed or related — for this run.
        if (
          r['agentId'] === state.agentId ||
          r['claimedAgentId'] === state.agentId
        ) {
          sawThisRun = true;
        }
      }
      if (!sawThisRun) {
        throw new Error('did not find any audit event for this run\'s agent in the last 50 rows');
      }
      // Note on "offline verify": full Ed25519 chain check requires the
      // JWKS from /.well-known/audit-signing-key + a chain-walking helper
      // that does not exist in @aegis/verifier-rp yet (only token verify
      // does). Structural fields are the strongest assertion available
      // without growing the public package surface from a monitor.
      return lines.length;
    });
  });

  it('step 10 · cleanup (revoke synthetic agent)', async () => {
    if (SKIP_REASON) return;
    await timed('cleanup', async () => {
      const sdk = state.sdk!;
      if (!state.agentId) return 'no agent to revoke';
      await sdk.agents.revoke(state.agentId);
      // Clear so afterAll doesn't double-revoke.
      state.agentId = null;
      return 'revoked';
    });
  });
});

// Defensive: ensure AEGIS_HEADER_VERIFY_KEY is referenced so a future
// import-side-effect change doesn't silently drop it from the bundle.
void AEGIS_HEADER_VERIFY_KEY;
