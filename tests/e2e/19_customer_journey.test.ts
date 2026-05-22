/**
 * 19 · Customer journey — trial → exhaustion → upgrade → continue (Round 21 · Lane C)
 *
 * The single most consequential integration test in the suite: this is the
 * first-paying-customer commerce loop, end-to-end, against a live API.
 *
 * Narrative (one continuous principal):
 *   T1 · register agent + policy + mint a token, verify SUCCEEDS (FREE tier)
 *   T2 · drive verifies until trial exhausts (requires OKORO_E2E_TRIAL_CAP_OVERRIDE)
 *   T3 · verify denies with denialReason='TRIAL_EXHAUSTED'
 *   T4 · simulate Stripe checkout.session.completed → DEVELOPER tier
 *   T5 · GET /v1/billing/plan reflects DEVELOPER + active + trial counters
 *        nulled (TrialService.getStatus returns cap=-1 on non-FREE → API
 *        maps to null per Round 21 Phase 1)
 *   T6 · verify SUCCEEDS again — proves the conversion loop works
 *        (TrialService non-FREE short-circuits, no trial gating)
 *   T7 · simulate customer.subscription.deleted → reverts to FREE
 *   T8 · verify denies with TRIAL_EXHAUSTED — proves trial doesn't refresh
 *        on downgrade (lifetime cap is permanent per ADR-0014 / F-02)
 *
 * Soft-skip behaviour (per CLAUDE.md invariant 4 — hard-assert when
 * preconditions are met, otherwise banner + skip):
 *   - Baseline structural test (GET /v1/billing/plan shape) ALWAYS runs.
 *   - Full journey requires:
 *       OKORO_E2E_FREE_API_KEY                  — operator FREE principal
 *       OKORO_STRIPE_WEBHOOK_SECRET             — == API STRIPE_WEBHOOK_SECRET
 *       OKORO_E2E_STRIPE_DEVELOPER_PRICE_ID
 *       OKORO_E2E_STRIPE_TEST_PRINCIPAL_ID      — must match the FREE key's principal
 *       OKORO_E2E_TRIAL_CAP_OVERRIDE            — small int (1..50) the API also reads
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Okoro } from '@okoro/sdk';
import { Okoro as OkoroCtor } from '@okoro/sdk';

import { RawClient, makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, createPolicy, signTokenFor } from './_support/fixtures';
import { buildEvent, signStripeEvent } from './_support/stripe';

const FREE_KEY = process.env['OKORO_E2E_FREE_API_KEY'];
const SECRET = process.env['OKORO_STRIPE_WEBHOOK_SECRET'];
const DEVELOPER_PRICE_ID = process.env['OKORO_E2E_STRIPE_DEVELOPER_PRICE_ID'];
const TEST_PRINCIPAL_ID = process.env['OKORO_E2E_STRIPE_TEST_PRINCIPAL_ID'];
const CAP_OVERRIDE_RAW = process.env['OKORO_E2E_TRIAL_CAP_OVERRIDE'];
const CAP_OVERRIDE = CAP_OVERRIDE_RAW ? Number.parseInt(CAP_OVERRIDE_RAW, 10) : NaN;

const TEST_CUSTOMER_ID = `cus_e2e_${randomUUID().slice(0, 12)}`;
const TEST_SUB_ID = `sub_e2e_${randomUUID().slice(0, 12)}`;

interface PlanSummary {
  planTier: 'FREE' | 'DEVELOPER' | 'GROWTH' | 'ENTERPRISE';
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  trialUsedCount: number | null;
  trialCap: number | null;
  trialExhaustedAt: string | null;
}

function banner(reason: string): void {
  // eslint-disable-next-line no-console
  console.warn(`  [19_customer_journey] SKIP — ${reason}`);
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  // eslint-disable-next-line no-console
  console.warn(`  [19_customer_journey] ${label}`);
  await fn();
}

describe('19 · customer journey (trial → exhaust → upgrade → downgrade)', () => {
  const cfg = readConfig();
  const raw = new RawClient(cfg);
  let sdk: Okoro;
  const cleanup: string[] = [];

  beforeAll(() => {
    sdk = makeSdk(cfg);
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

  // ── helpers ──────────────────────────────────────────────────────────

  async function fireWebhook(type: string, obj: Record<string, unknown>): Promise<number> {
    const evt = buildEvent(type, obj);
    const sig = signStripeEvent(evt.body, SECRET as string);
    const r = await fetch(`${cfg.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': sig },
      body: evt.body,
    });
    return r.status;
  }

  async function readPlan(client: RawClient): Promise<PlanSummary> {
    const res = await client.get<PlanSummary>('/v1/billing/plan');
    expect(res.status, `GET /v1/billing/plan → ${res.status} ${res.text}`).toBe(200);
    return res.body;
  }

  // ── baseline (always runs) ───────────────────────────────────────────

  it('baseline · GET /v1/billing/plan returns a valid shape', async () => {
    const plan = await readPlan(raw);
    expect(['FREE', 'DEVELOPER', 'GROWTH', 'ENTERPRISE']).toContain(plan.planTier);
    // Shape sanity: counter fields are number-or-null (Phase 1 contract).
    expect(plan.trialUsedCount === null || typeof plan.trialUsedCount === 'number').toBe(true);
    expect(plan.trialCap === null || typeof plan.trialCap === 'number').toBe(true);
    expect(plan.trialExhaustedAt === null || typeof plan.trialExhaustedAt === 'string').toBe(true);
  });

  // ── full journey (T1..T8) ────────────────────────────────────────────

  it('full journey · trial → exhaust → upgrade → verify → downgrade → deny', async () => {
    const missing: string[] = [];
    if (!FREE_KEY) missing.push('OKORO_E2E_FREE_API_KEY');
    if (!SECRET) missing.push('OKORO_STRIPE_WEBHOOK_SECRET');
    if (!DEVELOPER_PRICE_ID) missing.push('OKORO_E2E_STRIPE_DEVELOPER_PRICE_ID');
    if (!TEST_PRINCIPAL_ID) missing.push('OKORO_E2E_STRIPE_TEST_PRINCIPAL_ID');
    if (!Number.isInteger(CAP_OVERRIDE) || CAP_OVERRIDE < 1 || CAP_OVERRIDE > 50) {
      missing.push('OKORO_E2E_TRIAL_CAP_OVERRIDE(1..50)');
    }
    if (missing.length > 0) {
      banner(`required env missing: ${missing.join(', ')}`);
      return;
    }

    const free = new OkoroCtor({ apiKey: FREE_KEY as string, baseUrl: cfg.baseUrl });
    const freeRaw = new RawClient({ baseUrl: cfg.baseUrl, apiKey: FREE_KEY as string });
    const ctx = { action: 'commerce.purchase' as const, amount: 1, currency: 'USD' as const };

    // Stripe object factories (closure over env-validated constants).
    const subscriptionObject = (status: string): Record<string, unknown> => ({
      id: TEST_SUB_ID,
      customer: TEST_CUSTOMER_ID,
      status,
      items: { data: [{ price: { id: DEVELOPER_PRICE_ID } }] },
      metadata: { principalId: TEST_PRINCIPAL_ID },
    });

    // T1 · register agent + policy + mint token, verify succeeds on FREE.
    let agent: Awaited<ReturnType<typeof createAgent>>;
    let policy: Awaited<ReturnType<typeof createPolicy>>;
    await step('T1 · provision agent + policy on FREE principal', async () => {
      agent = await createAgent(free);
      cleanup.push(agent.agentId);
      policy = await createPolicy(free, agent.agentId, [SCOPES.commerce()]);
      const t = await signTokenFor(agent, policy.policyId, ctx);
      const r = await free.verify(t, ctx);
      expect(r.valid, `T1 verify denied: ${String(r.denialReason)}`).toBe(true);
    });

    // T2 · drive verifies up to the override cap. Each must NOT short-circuit.
    await step(`T2 · drive ${CAP_OVERRIDE - 1} verifies toward cap`, async () => {
      // We already used 1 verify in T1. Drive the remaining (CAP_OVERRIDE-1).
      for (let i = 1; i < CAP_OVERRIDE; i++) {
        const t = await signTokenFor(agent, policy.policyId, ctx);
        const r = await free.verify(t, ctx);
        expect(
          r.denialReason,
          `T2 exhausted early at iter=${i} (override=${CAP_OVERRIDE}) — reset trialUsedCount before re-run`,
        ).not.toBe('TRIAL_EXHAUSTED');
      }
    });

    // T3 · cap+1 must deny with TRIAL_EXHAUSTED.
    await step('T3 · cap+1 denies with TRIAL_EXHAUSTED', async () => {
      const t = await signTokenFor(agent, policy.policyId, ctx);
      const r = await free.verify(t, ctx);
      expect(r.valid).toBe(false);
      expect(r.denialReason).toBe('TRIAL_EXHAUSTED');
    });

    // T4 · upgrade via Stripe webhook (checkout.session.completed pattern is
    // operator-specific; customer.subscription.created is the canonical flip
    // covered by 18_stripe_subscription and reused here).
    await step('T4 · simulate customer.subscription.created → DEVELOPER', async () => {
      const status = await fireWebhook('customer.subscription.created', subscriptionObject('active'));
      expect(status, 'webhook must 200').toBe(200);
    });

    // T5 · plan reflects upgrade. Trial counters null on non-FREE per
    // Phase 1 (TrialService.getStatus returns cap=-1, controller maps to null).
    await step('T5 · GET /v1/billing/plan reflects DEVELOPER+active', async () => {
      const plan = await readPlan(freeRaw);
      expect(plan.planTier).toBe('DEVELOPER');
      expect(plan.subscriptionStatus).toBe('active');
      expect(plan.stripeSubscriptionId).toBe(TEST_SUB_ID);
      expect(plan.trialUsedCount, 'non-FREE → trialUsedCount must be null').toBeNull();
      expect(plan.trialCap, 'non-FREE → trialCap must be null').toBeNull();
      // trialExhaustedAt is preserved across the upgrade (F-02 anti-abuse).
      expect(typeof plan.trialExhaustedAt).toBe('string');
    });

    // T6 · verify works again — non-FREE path doesn't gate on trial counter.
    await step('T6 · verify SUCCEEDS post-upgrade (the conversion loop)', async () => {
      const t = await signTokenFor(agent, policy.policyId, ctx);
      const r = await free.verify(t, ctx);
      expect(r.valid, `T6 still denied post-upgrade: ${String(r.denialReason)}`).toBe(true);
    });

    // T7 · downgrade via subscription.deleted.
    await step('T7 · simulate customer.subscription.deleted → FREE', async () => {
      const status = await fireWebhook('customer.subscription.deleted', {
        id: TEST_SUB_ID,
        customer: TEST_CUSTOMER_ID,
        metadata: { principalId: TEST_PRINCIPAL_ID },
      });
      expect(status).toBe(200);
      const plan = await readPlan(freeRaw);
      expect(plan.planTier).toBe('FREE');
    });

    // T8 · verify denies again — trialExhaustedAt was preserved.
    await step('T8 · post-downgrade verify denies TRIAL_EXHAUSTED (no refresh)', async () => {
      const t = await signTokenFor(agent, policy.policyId, ctx);
      const r = await free.verify(t, ctx);
      expect(r.valid).toBe(false);
      expect(
        r.denialReason,
        'trial must NOT refresh on downgrade — lifetime cap is permanent per ADR-0014/F-02',
      ).toBe('TRIAL_EXHAUSTED');
    });
  });
});
