import { describe, it, expect, vi } from 'vitest';
import { registerPoliciesTools } from '../../src/tools/policies';
import type { ToolDefinition } from '../../src/tools/registry';

function buildOkoro() {
  return {
    policies: {
      create: vi.fn(async (args) => ({ id: 'pol_1', ...args })),
      get: vi.fn(async (id) => ({ id })),
      list: vi.fn(async () => ({ policies: [], cursor: null })),
      revoke: vi.fn(async () => ({ ok: true })),
    },
  };
}

describe('okoro.policies.* tools', () => {
  it('registers four tools', () => {
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(buildOkoro() as never, reg);
    expect(reg.size).toBe(4);
  });

  it('okoro.policies.create maps agent_id, scopes, expires_in_seconds', async () => {
    const okoro = buildOkoro();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(okoro as never, reg);
    const scopes = [{ category: 'commerce', actions: ['commerce.purchase'] }];
    await reg.get('okoro.policies.create')!.handler({ agent_id: 'agt_1', scopes, expires_in_seconds: 3600 });
    expect(okoro.policies.create).toHaveBeenCalledWith({ agentId: 'agt_1', scopes, expiresInSeconds: 3600 });
  });

  it('okoro.policies.list maps status enum', async () => {
    const okoro = buildOkoro();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(okoro as never, reg);
    await reg.get('okoro.policies.list')!.handler({ status: 'ACTIVE', limit: 10 });
    expect(okoro.policies.list).toHaveBeenCalledWith({
      agentId: undefined,
      status: 'ACTIVE',
      limit: 10,
      cursor: undefined,
    });
  });
});
