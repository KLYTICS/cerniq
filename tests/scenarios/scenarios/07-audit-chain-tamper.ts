// Scenario 07 — Audit chain offline tamper detection.
//
// Exercises: L4 (audit chain) + the offline verifier in @aegis/audit-verifier.
// Procurement claim: "Three valid verifies append three signed rows. Offline
// verification returns valid. A tampered row (action field mutated) is
// detected by offline verification with brokenAt=2 and reason=invalid_signature."

import type { Scenario } from '../lib/harness';

const scenario: Scenario = {
  id: '07',
  name: 'Audit chain offline tamper detection',
  vertical: 'cross-cutting',
  layers: ['L4'],
  description:
    'Hash-chained Ed25519-signed audit rows. Three valid events produce three rows. Offline verification confirms integrity. Tampering with row 2 (mutate action field) breaks the signature; offline verification detects it with the exact broken-at sequence number and reason.',
  async run(ctx, t) {
    const tenantId = 'audit_test';
    const agent = await ctx.registerAgent(tenantId, { initialTrust: 750 });
    ctx.attachPolicy(agent.id, { actions: ['orders.create', 'orders.cancel'], amountMax: 1000 });

    // Three valid actions
    for (let i = 0; i < 3; i++) {
      const action = i === 2 ? 'orders.cancel' : 'orders.create';
      const token = await ctx.signAction(agent.id, action, 99);
      const r = await ctx.verify(token, { tenantId, action, amount: 99 });
      t.expect(r.valid, `verify ${i} valid`).toBe(true);
    }

    const chain = ctx.exportAuditChain();
    t.expect(chain.length, 'chain has 3 rows').toBe(3);

    // Offline verification — clean
    const clean = await ctx.verifyAuditChainOffline();
    t.expect(clean.valid, 'pre-tamper offline verify clean').toBe(true);

    // Tamper with row 2's action — change orders.create to orders.create_OOPS
    ctx.tamperWithRow(2, (row) => ({ ...row, action: 'orders.create_OOPS' }));

    // Offline verification now detects the tamper
    const tampered = await ctx.verifyAuditChainOffline();
    t.expect(tampered.valid, 'post-tamper detected').toBe(false);
    t.expect(tampered.brokenAt!, 'broken at seq 2').toBe(2);
    t.expect(tampered.reason!, 'reason invalid_signature').toBe('invalid_signature');
  },
};

export default scenario;
