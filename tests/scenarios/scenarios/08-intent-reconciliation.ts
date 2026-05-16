// Scenario 08 — Intent manifest declared / actual reconciliation.
//
// Exercises: Intent manifest (ADR-0017) + L4 (audit chain).
// Procurement claim: "Agent declares intent to send $100. Actual outcome is
// $105 (5% drift). Reconciliation flags mismatch with amount_drift detail.
// A second pair declared=$100, actual=$100.50 (0.5% drift) reconciles ok —
// within the 1% tolerance."
//
// References: peer 115e12ee's intent-manifest Phase 2 (ADR-0017).

import type { Scenario } from '../lib/harness';

const scenario: Scenario = {
  id: '08',
  name: 'Intent manifest reconciliation — declared vs actual drift',
  vertical: 'fintech',
  layers: ['intent', 'L4'],
  description:
    'Intent manifest binds declared action to subsequent actuals. Drift > 1% reconciles as mismatch; drift <= 1% reconciles ok. The reconciliation result is captured on the intent record and would trigger BATE signal in production (ADR-0017 Phase 2 surface).',
  async run(ctx, t) {
    const agent = await ctx.registerAgent('intent_test', { initialTrust: 700 });

    // Path A — significant drift (5% over)
    const intentA = await ctx.declareIntent(agent.id, { action: 'payments.transfer', amount: 100 });
    t.expect(intentA.id, 'intent A id exists').toBeTruthy();
    t.expect(intentA.signatureB64Url, 'intent A signed').toBeTruthy();
    t.expect(intentA.declared.amount!, 'intent A declared').toBe(100);

    const reconA = ctx.reconcileActuals(intentA.id, { amount: 105 });
    t.expect(reconA.ok, 'intent A: 5% drift not ok').toBe(false);
    t.expect(reconA.mismatch!, 'intent A mismatch label').toContain('amount_drift');

    // Path B — within tolerance (0.5%)
    const intentB = await ctx.declareIntent(agent.id, { action: 'payments.transfer', amount: 100 });
    const reconB = ctx.reconcileActuals(intentB.id, { amount: 100.5 });
    t.expect(reconB.ok, 'intent B: 0.5% within tolerance ok').toBe(true);
    t.expect(reconB.mismatch, 'intent B no mismatch field').toBe(undefined);

    // Path C — exact match
    const intentC = await ctx.declareIntent(agent.id, { action: 'payments.transfer', amount: 250 });
    const reconC = ctx.reconcileActuals(intentC.id, { amount: 250 });
    t.expect(reconC.ok, 'intent C: exact match ok').toBe(true);

    // Path D — reconciling an unknown intent
    const reconUnknown = ctx.reconcileActuals('int_nonexistent', { amount: 100 });
    t.expect(reconUnknown.ok, 'unknown intent denied').toBe(false);
    t.expect(reconUnknown.mismatch!, 'unknown intent reason').toBe('unknown_intent');
  },
};

export default scenario;
