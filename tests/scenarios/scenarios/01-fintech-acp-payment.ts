// Scenario 01 — Fintech ACP payment, happy path.
//
// Exercises: L1 (agent identity) + L2 (policy scope + amount cap) + L4 (audit chain).
// Procurement claim: "Agent signs an ACP-compatible payment intent at $99
// under a $1000-bound policy; AEGIS verifies VALID with trustScore >= 600;
// audit chain appends one signed row that verifies offline."

import type { Scenario } from '../lib/harness';

const scenario: Scenario = {
  id: '01',
  name: 'Fintech ACP payment — happy path',
  vertical: 'fintech',
  layers: ['L1', 'L2', 'L4'],
  description:
    'Agent signs ACP-compatible payment intent at $99 under a $1000-bound policy; AEGIS verifies VALID with trustScore >= 600; audit chain appends one signed row that verifies offline against the AEGIS audit-signing public key.',
  async run(ctx, t) {
    const tenantId = 'fintech_acme';
    const agent = await ctx.registerAgent(tenantId, { initialTrust: 750 });
    t.expect(agent.tenantId, 'agent.tenantId').toBe(tenantId);
    t.expect(agent.revoked, 'agent.revoked').toBe(false);

    const policy = ctx.attachPolicy(agent.id, {
      actions: ['orders.create'],
      amountMax: 1000,
    });
    t.expect(policy.actions, 'policy.actions').toContain('orders.create');
    t.expect(policy.amountMax, 'policy.amountMax').toBe(1000);

    // Agent signs the payment intent (private key never leaves the harness's
    // agent record — mirrors CLAUDE.md invariant #1: private keys never enter AEGIS).
    const token = await ctx.signAction(agent.id, 'orders.create', 99);
    t.expect(typeof token, 'token type').toBe('string');
    t.expect(token.length, 'token length > 0').toBeGreaterThan(0);

    const result = await ctx.verify(token, { tenantId, action: 'orders.create', amount: 99 });
    t.expect(result.valid, 'verify.valid').toBe(true);
    t.expect(result.reason, 'verify.reason').toBe(undefined);
    t.expect(result.trustScore!, 'verify.trustScore').toBeGreaterThanOrEqual(600);
    t.expect(result.trustBand!, 'verify.trustBand').toBeOneOf(['VERIFIED', 'PLATINUM']);

    const chain = ctx.exportAuditChain();
    t.expect(chain.length, 'audit chain length').toBe(1);
    t.expect(chain[0]!.action, 'audit row 0 action').toBe('orders.create');
    t.expect(chain[0]!.amount, 'audit row 0 amount').toBe(99);
    t.expect(chain[0]!.result, 'audit row 0 result').toBe('VALID');

    const offline = await ctx.verifyAuditChainOffline();
    t.expect(offline.valid, 'offline chain valid').toBe(true);
  },
};

export default scenario;
