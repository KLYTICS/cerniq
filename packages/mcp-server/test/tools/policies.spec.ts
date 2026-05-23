import { describe, it, expect, vi } from 'vitest';
import { registerPoliciesTools } from '../../src/tools/policies';
import type { ToolDefinition } from '../../src/tools/registry';

function buildCerniq() {
  return {
    policies: {
      create: vi.fn(async (args) => ({ id: 'pol_1', ...args })),
      get: vi.fn(async (id) => ({ id })),
      list: vi.fn(async () => ({ policies: [], cursor: null })),
      revoke: vi.fn(async () => ({ ok: true })),
    },
  };
}

describe('cerniq.policies.* tools', () => {
  it('registers four tools', () => {
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(buildCerniq() as never, reg);
    expect(reg.size).toBe(4);
  });

  it('cerniq.policies.create maps agent_id, scopes, expires_in_seconds', async () => {
    const cerniq = buildCerniq();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(cerniq as never, reg);
    const scopes = [{ category: 'commerce', actions: ['commerce.purchase'] }];
    await reg
      .get('cerniq.policies.create')!
      .handler({ agent_id: 'agt_1', scopes, expires_in_seconds: 3600 });
    expect(cerniq.policies.create).toHaveBeenCalledWith({
      agentId: 'agt_1',
      scopes,
      expiresInSeconds: 3600,
    });
  });

  it('cerniq.policies.list maps status enum', async () => {
    const cerniq = buildCerniq();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(cerniq as never, reg);
    await reg.get('cerniq.policies.list')!.handler({ status: 'ACTIVE', limit: 10 });
    expect(cerniq.policies.list).toHaveBeenCalledWith({
      agentId: undefined,
      status: 'ACTIVE',
      limit: 10,
      cursor: undefined,
    });
  });
});
