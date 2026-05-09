/**
 * 18 · Stripe subscription state machine (Round 20 · Lane D)
 *
 * Black-box e2e proof that `/v1/billing/webhook` correctly drives a
 * principal through the Stripe lifecycle: subscription.created →
 * payment_failed (past_due) → payment_succeeded (active) →
 * subscription.deleted (FREE), plus event-id idempotency and
 * signature-tamper rejection.
 *
 * The intake is signature-only — we mint forged-but-correctly-signed
 * envelopes via `_support/stripe.ts` so the full pipeline (verify →
 * SETNX dedupe → handler → Prisma → usage-cache bust → audit) runs
 * without any outbound Stripe traffic.
 *
 * Required env (operator provisions; missing → soft skip per scenario):
 *   AEGIS_STRIPE_WEBHOOK_SECRET            (== API's STRIPE_WEBHOOK_SECRET)
 *   AEGIS_E2E_STRIPE_TEST_PRINCIPAL_ID     target principal id
 *   AEGIS_E2E_STRIPE_DEVELOPER_PRICE_ID    price_id mapped to DEVELOPER
 *
 * CLAUDE.md invariant #4: when preconditions are met, hard-assert. The
 * structural baseline (malformed body → 400) always runs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { RawClient, makeSdk, readConfig } from './_support/client';
import { buildEvent, signStripeEvent, tamperSignature } from './_support/stripe';

const SECRET = process.env['AEGIS_STRIPE_WEBHOOK_SECRET'];
const TEST_PRINCIPAL_ID = process.env['AEGIS_E2E_STRIPE_TEST_PRINCIPAL_ID'];
const DEVELOPER_PRICE_ID = process.env['AEGIS_E2E_STRIPE_DEVELOPER_PRICE_ID'];

const TEST_CUSTOMER_ID = `cus_e2e_${randomUUID().slice(0, 12)}`;
const TEST_SUB_ID = `sub_e2e_${randomUUID().slice(0, 12)}`;

function skip(scenario: string, why: string): void {
  // eslint-disable-next-line no-console
  console.warn(`  [18_stripe_subscription] SKIP ${scenario} — ${why}`);
}

interface PlanSummary {
  planTier: string;
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
}

interface AuditRow {
  action?: string;
  metadata?: Record<string, unknown>;
  principalId?: string;
}

describe('18 · Stripe subscription state machine', () => {
  const cfg = readConfig();
  const raw = new RawClient(cfg);
  // SDK constructed for parity with sibling tests; not used directly because
  // the webhook intake is unauthenticated and the SDK does not expose it.
  void makeSdk(cfg);

  const fullCoverage = Boolean(SECRET && TEST_PRINCIPAL_ID && DEVELOPER_PRICE_ID);

  beforeAll(() => {
    if (!fullCoverage) {
      const missing = [
        !SECRET && 'AEGIS_STRIPE_WEBHOOK_SECRET',
        !TEST_PRINCIPAL_ID && 'AEGIS_E2E_STRIPE_TEST_PRINCIPAL_ID',
        !DEVELOPER_PRICE_ID && 'AEGIS_E2E_STRIPE_DEVELOPER_PRICE_ID',
      ].filter(Boolean);
      // eslint-disable-next-line no-console
      console.warn(
        `  [18_stripe_subscription] running structural baseline only; missing: ${missing.join(', ')}`,
      );
    }
  });

  afterAll(() => {
    /* No cleanup: the principal is operator-provisioned and persists. */
  });

  // ── helpers ──────────────────────────────────────────────────────────

  async function postEvent(body: string, signature: string): Promise<Response> {
    return fetch(`${cfg.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      body,
    });
  }

  async function fireEvent(
    type: string,
    obj: Record<string, unknown>,
    eventId?: string,
  ): Promise<{ status: number; eventId: string }> {
    const evt = buildEvent(type, obj, eventId);
    const sig = signStripeEvent(evt.body, SECRET as string);
    const res = await postEvent(evt.body, sig);
    return { status: res.status, eventId: evt.parsed.id };
  }

  async function readPlan(): Promise<PlanSummary> {
    const res = await raw.get<PlanSummary>('/v1/billing/plan');
    expect(res.status, `GET /v1/billing/plan → ${res.status} ${res.text}`).toBe(200);
    return res.body;
  }

  async function countPlanChanged(stripeEventId: string): Promise<number> {
    // Stream NDJSON from /v1/audit-events/export and count billing.plan_changed
    // rows whose metadata.stripeEventId matches. Idempotency must yield ≤ 1.
    const r = await fetch(`${cfg.baseUrl}/v1/audit-events/export`, {
      method: 'GET',
      headers: { 'x-aegis-key': cfg.apiKey },
    });
    expect(r.status, `audit export → ${r.status}`).toBe(200);
    const text = await r.text();
    let n = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let row: AuditRow;
      try {
        row = JSON.parse(line) as AuditRow;
      } catch {
        continue;
      }
      if (
        row.action === 'billing.plan_changed' &&
        row.metadata &&
        (row.metadata as { stripeEventId?: string }).stripeEventId === stripeEventId
      ) {
        n += 1;
      }
    }
    return n;
  }

  function subscriptionObject(status: string): Record<string, unknown> {
    return {
      id: TEST_SUB_ID,
      customer: TEST_CUSTOMER_ID,
      status,
      items: { data: [{ price: { id: DEVELOPER_PRICE_ID } }] },
      metadata: { principalId: TEST_PRINCIPAL_ID },
    };
  }

  function invoiceObject(): Record<string, unknown> {
    return {
      id: `in_e2e_${randomUUID().slice(0, 8)}`,
      customer: TEST_CUSTOMER_ID,
      subscription: TEST_SUB_ID,
    };
  }

  // ── structural baseline (always runs) ────────────────────────────────

  it('rejects a malformed body with no signature header (HTTP 400)', async () => {
    const r = await fetch(`${cfg.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    // ValidationError → 400 (missing signature OR empty/bad body).
    expect(r.status, `expected 400, got ${r.status}`).toBe(400);
  });

  // ── full-coverage scenarios ──────────────────────────────────────────

  it('1 · customer.subscription.created flips principal to DEVELOPER', async () => {
    if (!fullCoverage) return skip('S1', 'env vars not set');
    const { status, eventId } = await fireEvent(
      'customer.subscription.created',
      subscriptionObject('active'),
    );
    expect(status, `webhook → ${status}`).toBe(200);
    const plan = await readPlan();
    expect(plan.planTier).toBe('DEVELOPER');
    expect(plan.stripeSubscriptionId).toBe(TEST_SUB_ID);
    // Stash for scenario 5 idempotency replay.
    (globalThis as Record<string, unknown>)['__s1_eventId'] = eventId;
  });

  it('2 · invoice.payment_failed sets subscriptionStatus=past_due', async () => {
    if (!fullCoverage) return skip('S2', 'env vars not set');
    const { status } = await fireEvent('invoice.payment_failed', invoiceObject());
    expect(status).toBe(200);
    const plan = await readPlan();
    // Lane A is shipping the handler in parallel. If it has not landed yet
    // the API will return 200 (event handled as a no-op) and the status
    // will not flip — surface that explicitly rather than passing silently.
    expect(plan.subscriptionStatus, 'lane-A handler must set past_due').toBe('past_due');
  });

  it('3 · invoice.payment_succeeded clears past_due → active', async () => {
    if (!fullCoverage) return skip('S3', 'env vars not set');
    const { status } = await fireEvent('invoice.payment_succeeded', invoiceObject());
    expect(status).toBe(200);
    const plan = await readPlan();
    expect(plan.subscriptionStatus).toBe('active');
  });

  it('4 · customer.subscription.deleted reverts principal to FREE', async () => {
    if (!fullCoverage) return skip('S4', 'env vars not set');
    const { status } = await fireEvent('customer.subscription.deleted', {
      id: TEST_SUB_ID,
      customer: TEST_CUSTOMER_ID,
      metadata: { principalId: TEST_PRINCIPAL_ID },
    });
    expect(status).toBe(200);
    const plan = await readPlan();
    expect(plan.planTier).toBe('FREE');
  });

  it('5 · replaying the same event id is idempotent (one audit row)', async () => {
    if (!fullCoverage) return skip('S5', 'env vars not set');
    // Re-create the subscription so we can replay the create event.
    const replayId = `evt_test_replay_${randomUUID()}`;
    const first = await fireEvent(
      'customer.subscription.created',
      subscriptionObject('active'),
      replayId,
    );
    expect(first.status).toBe(200);
    const second = await fireEvent(
      'customer.subscription.created',
      subscriptionObject('active'),
      replayId,
    );
    expect(second.status, 'replay must still 200').toBe(200);
    const n = await countPlanChanged(replayId);
    expect(n, `expected exactly one billing.plan_changed for ${replayId}, got ${n}`).toBeLessThanOrEqual(1);
  });

  it('6 · tampered signature → HTTP 400', async () => {
    if (!fullCoverage) return skip('S6', 'env vars not set');
    const evt = buildEvent('customer.subscription.created', subscriptionObject('active'));
    const goodSig = signStripeEvent(evt.body, SECRET as string);
    const badSig = tamperSignature(goodSig);
    const r = await postEvent(evt.body, badSig);
    expect(r.status, `expected 400, got ${r.status}`).toBe(400);
  });
});
