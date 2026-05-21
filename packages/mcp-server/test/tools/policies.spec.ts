import { describe, it, expect, vi } from 'vitest';
import { registerPoliciesTools } from '../../src/tools/policies';
import type { ToolDefinition } from '../../src/tools/registry';

function buildAegis() {
  return {
    policies: {
      create: vi.fn(async (agentId, input) => ({ id: 'pol_1', agentId, ...input })),
      list: vi.fn(async (agentId) => [{ policyId: 'pol_1', agentId, expiresAt: '2026-05-20T12:00:00Z' }]),
      revoke: vi.fn(async () => ({ ok: true })),
    },
  };
}

describe('aegis.policies.* tools', () => {
  it('registers three tools', () => {
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(buildAegis() as never, reg);
    expect(reg.size).toBe(3);
  });

  it('aegis.policies.create maps agent_id, scopes, expires_in_seconds', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, reg);
    const scopes = [{ category: 'commerce', actions: ['commerce.purchase'] }];
    await reg.get('aegis.policies.create')!.handler({ agent_id: 'agt_1', scopes, expires_in_seconds: 3600 });
    expect(aegis.policies.create).toHaveBeenCalledWith('agt_1', {
      scopes,
      expiresAt: expect.any(Date),
    });
  });

  it('aegis.policies.list maps agent_id', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, reg);
    await reg.get('aegis.policies.list')!.handler({ agent_id: 'agt_1' });
    expect(aegis.policies.list).toHaveBeenCalledWith('agt_1');
  });

  it('aegis.policies.revoke maps agent_id and policy_id', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, reg);
    await reg.get('aegis.policies.revoke')!.handler({ agent_id: 'agt_1', policy_id: 'pol_1' });
    expect(aegis.policies.revoke).toHaveBeenCalledWith('agt_1', 'pol_1');
  });
});
