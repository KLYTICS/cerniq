// Scenario 05 — BATE trust decay paths.
//
// Exercises: L3 (BATE engine — trust score + anomaly count).
// Procurement claim: "Two BATE denial paths exercise the precedence chain
// correctly: an agent at trust=150 with 1 anomaly trips TRUST_SCORE_TOO_LOW;
// an agent at trust=1000 with 5 anomalies trips ANOMALY_FLAGGED. Locked
// denial precedence per CLAUDE.md §6."

import type { Scenario } from '../lib/harness';

const scenario: Scenario = {
  id: '05',
  name: 'BATE trust-decay paths (low score + high anomaly count)',
  vertical: 'cross-cutting',
  layers: ['L3', 'L4'],
  description:
    'BATE behavioral attestation: trust score < 100 trips TRUST_SCORE_TOO_LOW; anomaly count >= 5 trips ANOMALY_FLAGGED. Both denials surface in the audit chain with the trust score and band captured at-event-time.',
  async run(ctx, t) {
    const tenantId = 'bate_test';

    // Path A — TRUST_SCORE_TOO_LOW
    const agentLowTrust = await ctx.registerAgent(tenantId, { initialTrust: 150 });
    ctx.attachPolicy(agentLowTrust.id, { actions: ['orders.create'], amountMax: 100 });
    ctx.flagAnomaly(agentLowTrust.id, 1); // trust 150 - 100 = 50
    const lowTrustToken = await ctx.signAction(agentLowTrust.id, 'orders.create', 50);
    const lowTrustResult = await ctx.verify(lowTrustToken, { tenantId, action: 'orders.create', amount: 50 });
    t.expect(lowTrustResult.valid, 'low-trust denied').toBe(false);
    t.expect(lowTrustResult.reason!, 'TRUST_SCORE_TOO_LOW').toBe('TRUST_SCORE_TOO_LOW');
    t.expect(lowTrustResult.trustScore!, 'low-trust score at event').toBeLessThan(100);
    t.expect(lowTrustResult.trustBand!, 'low-trust band').toBe('FLAGGED');

    // Path B — ANOMALY_FLAGGED (high trust, but anomaly count >= 5)
    const agentManyAnomalies = await ctx.registerAgent(tenantId, { initialTrust: 1000 });
    ctx.attachPolicy(agentManyAnomalies.id, { actions: ['orders.create'], amountMax: 100 });
    ctx.flagAnomaly(agentManyAnomalies.id, 5); // trust 1000 - 500 = 500, count = 5
    const anomalyToken = await ctx.signAction(agentManyAnomalies.id, 'orders.create', 50);
    const anomalyResult = await ctx.verify(anomalyToken, { tenantId, action: 'orders.create', amount: 50 });
    t.expect(anomalyResult.valid, 'anomaly-flagged denied').toBe(false);
    t.expect(anomalyResult.reason!, 'ANOMALY_FLAGGED').toBe('ANOMALY_FLAGGED');
    t.expect(anomalyResult.trustScore!, 'anomaly-flagged score still > 100').toBeGreaterThanOrEqual(100);

    // Path C — trust + anomaly precedence: both conditions trigger but TRUST wins
    const agentBoth = await ctx.registerAgent(tenantId, { initialTrust: 600 });
    ctx.attachPolicy(agentBoth.id, { actions: ['orders.create'], amountMax: 100 });
    ctx.flagAnomaly(agentBoth.id, 6); // trust 600 - 600 = 0, count = 6
    const bothToken = await ctx.signAction(agentBoth.id, 'orders.create', 50);
    const bothResult = await ctx.verify(bothToken, { tenantId, action: 'orders.create', amount: 50 });
    t.expect(bothResult.valid, 'both-conditions denied').toBe(false);
    t.expect(bothResult.reason!, 'both-conditions: TRUST wins per precedence').toBe('TRUST_SCORE_TOO_LOW');

    // Audit chain captured all denials with trust band
    const chain = ctx.exportAuditChain();
    t.expect(chain.length, 'audit captured 3 rows').toBe(3);
    t.expect(chain.every((r) => r.result === 'DENIED'), 'all rows DENIED').toBe(true);
    t.expect(chain.every((r) => r.trustBandAtEvent !== undefined), 'all rows have trust band').toBe(true);
  },
};

export default scenario;
