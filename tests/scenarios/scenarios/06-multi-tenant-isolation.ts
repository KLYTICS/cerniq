// Scenario 06 — Multi-tenant isolation (CLAUDE.md invariant #5).
//
// Exercises: L1 + L2 + tenant boundary.
// Procurement claim: "An agent registered in tenant A cannot be verified
// against tenant B's verify endpoint. Even with a valid signature, the
// cross-tenant verify returns AGENT_NOT_FOUND. This is invariant #5 in
// running code: multi-tenant isolation by principalId."

import type { Scenario } from '../lib/harness';

const scenario: Scenario = {
  id: '06',
  name: 'Multi-tenant isolation — agent invisible across tenants',
  vertical: 'saas',
  layers: ['L1', 'L2'],
  description:
    'CLAUDE.md invariant #5 in running code. Agent registered in tenant A. Same token, when presented to tenant B verify, returns AGENT_NOT_FOUND (not INVALID_SIGNATURE — the agent is simply invisible across the tenant boundary).',
  async run(ctx, t) {
    // Agent registered in tenant A
    const agentA = await ctx.registerAgent('tenant_a', { initialTrust: 800 });
    ctx.attachPolicy(agentA.id, { actions: ['orders.create'], amountMax: 1000 });

    // Tenant A's agent signs a valid token
    const token = await ctx.signAction(agentA.id, 'orders.create', 99);

    // Presenting against tenant A → VALID
    const resultA = await ctx.verify(token, { tenantId: 'tenant_a', action: 'orders.create', amount: 99 });
    t.expect(resultA.valid, 'tenant A verify ok').toBe(true);

    // Presenting against tenant B → AGENT_NOT_FOUND (not INVALID_SIGNATURE)
    const resultB = await ctx.verify(token, { tenantId: 'tenant_b', action: 'orders.create', amount: 99 });
    t.expect(resultB.valid, 'tenant B verify denied').toBe(false);
    t.expect(resultB.reason!, 'cross-tenant: AGENT_NOT_FOUND').toBe('AGENT_NOT_FOUND');

    // Audit chain has both events — under their respective tenants
    const chain = ctx.exportAuditChain();
    t.expect(chain.length, 'chain captured 2 rows').toBe(2);
    t.expect(chain[0]!.tenantId, 'row 0 tenant A').toBe('tenant_a');
    t.expect(chain[0]!.result, 'row 0 VALID').toBe('VALID');
    t.expect(chain[1]!.tenantId, 'row 1 tenant B').toBe('tenant_b');
    t.expect(chain[1]!.result, 'row 1 DENIED').toBe('DENIED');

    // Both rows are signed and chain-linked even across tenant boundaries
    const offline = await ctx.verifyAuditChainOffline();
    t.expect(offline.valid, 'offline chain valid across tenants').toBe(true);
  },
};

export default scenario;
