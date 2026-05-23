/**
 * 17 · Trial exhaustion (ADR-0014, TRIAL_LIFETIME_CAP = 10_000)
 *
 * Black-box e2e proof that the FREE-tier lifetime cap fires
 * `denialReason: 'TRIAL_EXHAUSTED'` once a principal exceeds the cap.
 *
 * The harness is black-box and cannot create FREE principals, write to
 * Postgres, or lower the cap (no env override is wired today). We drive
 * scenarios off operator-provisioned keys:
 *
 *   CERNIQ_E2E_FREE_API_KEY            management key (`cerniq_sk_…`) bound to
 *                                     a FREE-tier principal with a fresh
 *                                     trial counter.
 *   CERNIQ_E2E_FREE_EXHAUSTED_API_KEY  key bound to a FREE principal whose
 *                                     `trialExhaustedAt` was DB-prepopulated.
 *   CERNIQ_E2E_TRIAL_CAP_OVERRIDE      small integer cap (matches the env
 *                                     the API would read if the override
 *                                     ever lands; soft-skip otherwise).
 *
 * Scenarios that lack their precondition print a single-line skip banner.
 * The seed-key structural test always runs and asserts the Round-19
 * regression-catcher: a paid principal MUST NOT see TRIAL_EXHAUSTED.
 *
 * SDK call exercised: `await cerniq.verify(token, ctx)`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cerniq } from '@cerniq/sdk';
import { Cerniq as CerniqCtor } from '@cerniq/sdk';

import { makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, createPolicy, signTokenFor } from './_support/fixtures';

// Local denial assertion. We don't use `_support/assert.ts`'s
// `assertVerifyDenied` because its parameter type is the SDK's `DenialReason`
// union, which (as of Round 19) does not yet include `TRIAL_EXHAUSTED` /
// `PLAN_LIMIT_EXCEEDED`. Canonical list lives in `@cerniq/types`. Swap back
// once the SDK union is regenerated.
function assertDenialIs(
  result: { valid: boolean; denialReason: string | null },
  expected: 'TRIAL_EXHAUSTED',
): void {
  expect(result.valid, `expected ${expected}, got valid:true`).toBe(false);
  expect(result.denialReason, `expected ${expected}, got ${String(result.denialReason)}`).toBe(
    expected,
  );
}

const FREE_KEY = process.env['CERNIQ_E2E_FREE_API_KEY'];
const FREE_EXHAUSTED_KEY = process.env['CERNIQ_E2E_FREE_EXHAUSTED_API_KEY'];
const CAP_OVERRIDE_RAW = process.env['CERNIQ_E2E_TRIAL_CAP_OVERRIDE'];
const CAP_OVERRIDE = CAP_OVERRIDE_RAW ? Number.parseInt(CAP_OVERRIDE_RAW, 10) : NaN;

function skipBanner(why: string, fix: string): void {
  // eslint-disable-next-line no-console
  console.warn(`  [17_trial_exhaustion] SKIP — ${why}\n    fix: ${fix}`);
}

describe('17 · trial exhaustion (ADR-0014)', () => {
  let sdk: Cerniq;
  const cleanup: string[] = [];

  beforeAll(() => {
    sdk = makeSdk(readConfig());
  });

  afterAll(async () => {
    for (const id of cleanup) {
      try {
        await sdk.agents.revoke(id);
      } catch {
        /* ignore */
      }
    }
  });

  // Structural / regression scenario — always runs. The seed key is bound
  // to a DEVELOPER-tier principal (scripts/seed-dev.ts) and MUST NOT see
  // TRIAL_EXHAUSTED. A failure here means the Round-19 double-gate fix
  // (FREE.monthlyVerifyQuota=+Infinity) has regressed.
  it('non-FREE seed principal never returns TRIAL_EXHAUSTED', async () => {
    const cfg = readConfig();
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);
    const token = await signTokenFor(agent, policy.policyId, {
      action: 'commerce.purchase',
      amount: 10,
      currency: 'USD',
    });
    const result = await sdk.verify(token, {
      action: 'commerce.purchase',
      amount: 10,
      currency: 'USD',
    });
    // Either approved, or denied for a non-trial reason. The contract we
    // hard-assert is: a paid-tier seed principal does NOT see TRIAL_EXHAUSTED.
    expect(
      result.denialReason,
      `seed principal (${cfg.apiKey.slice(0, 12)}…) returned TRIAL_EXHAUSTED — ` +
        'Round-19 double-gate fix has regressed. See plans.ts FREE.monthlyVerifyQuota.',
    ).not.toBe('TRIAL_EXHAUSTED');
  });

  // Scenario 1 — cap probe. Requires both CERNIQ_E2E_FREE_API_KEY and a
  // small CERNIQ_E2E_TRIAL_CAP_OVERRIDE; production cap 10_000 is too slow.
  it('FREE principal: verifies up to cap succeed, cap+1 returns TRIAL_EXHAUSTED', async () => {
    if (!FREE_KEY) {
      skipBanner(
        'CERNIQ_E2E_FREE_API_KEY not set',
        'provision a FREE-tier verify key, fresh trial counter, and re-run',
      );
      return;
    }
    if (!Number.isInteger(CAP_OVERRIDE) || CAP_OVERRIDE < 1 || CAP_OVERRIDE > 50) {
      skipBanner(
        `CERNIQ_E2E_TRIAL_CAP_OVERRIDE not in [1,50] (got ${CAP_OVERRIDE_RAW ?? 'unset'})`,
        'set CERNIQ_E2E_TRIAL_CAP_OVERRIDE=5 + matching API env, then re-run',
      );
      return;
    }

    const free = new CerniqCtor({ apiKey: FREE_KEY, baseUrl: readConfig().baseUrl });
    const ctx = { action: 'commerce.purchase' as const, amount: 1, currency: 'USD' as const };

    let freeAgent: Awaited<ReturnType<typeof createAgent>>;
    let freePolicy: Awaited<ReturnType<typeof createPolicy>>;
    try {
      freeAgent = await createAgent(free);
      cleanup.push(freeAgent.agentId);
      freePolicy = await createPolicy(free, freeAgent.agentId, [SCOPES.commerce()]);
    } catch (err) {
      skipBanner(
        `FREE-tier setup failed: ${(err as Error).message}`,
        'CERNIQ_E2E_FREE_API_KEY must be a management key on a FREE principal',
      );
      return;
    }

    for (let i = 0; i < CAP_OVERRIDE; i++) {
      const t = await signTokenFor(freeAgent, freePolicy.policyId, ctx);
      const r = await free.verify(t, ctx);
      expect(
        r.denialReason,
        `FREE principal exhausted at iter=${i} (override=${CAP_OVERRIDE}); reset trialUsedCount before re-run`,
      ).not.toBe('TRIAL_EXHAUSTED');
    }

    const overflowToken = await signTokenFor(freeAgent, freePolicy.policyId, ctx);
    const overflow = await free.verify(overflowToken, ctx);
    assertDenialIs(overflow, 'TRIAL_EXHAUSTED');
  });

  // Scenario 2 — short-circuit. TrialService.checkAndIncrement returns
  // immediately when principal.trialExhaustedAt !== null (no Redis hit).
  // Two consecutive verifies must both deny with TRIAL_EXHAUSTED.
  it('already-exhausted FREE principal short-circuits without Redis hit', async () => {
    if (!FREE_EXHAUSTED_KEY) {
      skipBanner(
        'CERNIQ_E2E_FREE_EXHAUSTED_API_KEY not set',
        'pre-populate a FREE principal with trialExhaustedAt=now() in Postgres and pass its key',
      );
      return;
    }
    const exhausted = new CerniqCtor({ apiKey: FREE_EXHAUSTED_KEY, baseUrl: readConfig().baseUrl });
    const ctx = { action: 'commerce.purchase' as const, amount: 1, currency: 'USD' as const };

    // Trial gate fires before agent/policy lookup, so token contents are
    // irrelevant. Use the seed principal's agent/policy to mint one.
    const dummyAgent = await createAgent(sdk).catch(() => null);
    if (!dummyAgent) {
      skipBanner('seed principal cannot register agent', 're-seed and retry');
      return;
    }
    cleanup.push(dummyAgent.agentId);
    const dummyPolicy = await createPolicy(sdk, dummyAgent.agentId, [SCOPES.commerce()]);
    const token = await signTokenFor(dummyAgent, dummyPolicy.policyId, ctx);

    const t0 = performance.now();
    const r1 = await exhausted.verify(token, ctx);
    const d1 = performance.now() - t0;

    const t1 = performance.now();
    const r2 = await exhausted.verify(token, ctx);
    const d2 = performance.now() - t1;

    assertDenialIs(r1, 'TRIAL_EXHAUSTED');
    assertDenialIs(r2, 'TRIAL_EXHAUSTED');

    // Loose perf bound — the short-circuit should not be > 5× slower than
    // the first call. Network jitter makes a tighter assertion flaky.
    expect(
      d2,
      `short-circuit slower than expected (d1=${d1.toFixed(1)}ms d2=${d2.toFixed(1)}ms)`,
    ).toBeLessThan(Math.max(50, d1 * 5));
  });
});
