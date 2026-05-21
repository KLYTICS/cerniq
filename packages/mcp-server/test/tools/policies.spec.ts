import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerPoliciesTools } from '../../src/tools/policies';
import type { ToolDefinition } from '../../src/tools/registry';

function buildAegis(listResult: unknown[] = []) {
  return {
    policies: {
      create: vi.fn(async (agentId, input) => ({ policyId: 'pol_1', agentId, ...input })),
      list: vi.fn(async () => listResult),
      revoke: vi.fn(async () => undefined),
    },
  };
}

describe('aegis.policies.* tools', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('registers four tools, each carrying MCP 1.0 annotations', () => {
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(buildAegis() as never, reg);
    expect(reg.size).toBe(4);
    for (const name of ['aegis.policies.create', 'aegis.policies.get', 'aegis.policies.list', 'aegis.policies.revoke']) {
      expect(reg.has(name)).toBe(true);
      expect(reg.get(name)!.annotations).toBeDefined();
    }
  });

  it('annotates revoke as destructive + idempotent; list/get as read-only', () => {
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(buildAegis() as never, reg);
    expect(reg.get('aegis.policies.revoke')!.annotations.destructiveHint).toBe(true);
    expect(reg.get('aegis.policies.list')!.annotations.readOnlyHint).toBe(true);
    expect(reg.get('aegis.policies.get')!.annotations.readOnlyHint).toBe(true);
    expect(reg.get('aegis.policies.create')!.annotations.idempotentHint).toBe(false);
  });

  it('aegis.policies.create converts expires_in_seconds → expiresAt and calls SDK create(agentId, input)', async () => {
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'));
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, reg);
    const scopes = [{ category: 'commerce', actions: ['commerce.purchase'] }];
    await reg
      .get('aegis.policies.create')!
      .handler({ agent_id: 'agt_1', scopes, expires_in_seconds: 3600 });
    expect(aegis.policies.create).toHaveBeenCalledWith('agt_1', {
      scopes,
      expiresAt: new Date('2026-05-20T01:00:00Z'),
    });
  });

  it('aegis.policies.create prefers explicit expires_at over expires_in_seconds', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, reg);
    await reg.get('aegis.policies.create')!.handler({
      agent_id: 'agt_1',
      scopes: [{ category: 'commerce' }],
      expires_in_seconds: 60,
      expires_at: '2027-01-01T00:00:00Z',
    });
    expect(aegis.policies.create).toHaveBeenCalledWith(
      'agt_1',
      expect.objectContaining({ expiresAt: new Date('2027-01-01T00:00:00Z') }),
    );
  });

  it('aegis.policies.get filters client-side and returns the matching policy', async () => {
    const aegis = buildAegis([
      { policyId: 'pol_other', signedToken: 't1', expiresAt: '2027-01-01T00:00:00Z' },
      { policyId: 'pol_target', signedToken: 't2', expiresAt: '2027-01-01T00:00:00Z' },
    ]);
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, reg);
    const result = await reg
      .get('aegis.policies.get')!
      .handler({ agent_id: 'agt_1', policy_id: 'pol_target' });
    expect(aegis.policies.list).toHaveBeenCalledWith('agt_1');
    expect((result as { policyId: string }).policyId).toBe('pol_target');
  });

  it('aegis.policies.get throws policy_not_found when the id is not in the agent list', async () => {
    const aegis = buildAegis([{ policyId: 'pol_other', signedToken: 't', expiresAt: '' }]);
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, reg);
    await expect(
      reg.get('aegis.policies.get')!.handler({ agent_id: 'agt_1', policy_id: 'pol_missing' }),
    ).rejects.toThrow(/policy_not_found/);
  });

  it('aegis.policies.list calls SDK with agent_id only', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, reg);
    await reg.get('aegis.policies.list')!.handler({ agent_id: 'agt_1' });
    expect(aegis.policies.list).toHaveBeenCalledWith('agt_1');
  });

  it('aegis.policies.revoke requires agent_id + policy_id and reports reason was not persisted', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, reg);
    const result = await reg
      .get('aegis.policies.revoke')!
      .handler({ agent_id: 'agt_1', policy_id: 'pol_1', reason: 'rotation' });
    expect(aegis.policies.revoke).toHaveBeenCalledWith('agt_1', 'pol_1');
    expect(result).toMatchObject({ agentId: 'agt_1', policyId: 'pol_1', revoked: true, reasonAccepted: false });
  });
});
