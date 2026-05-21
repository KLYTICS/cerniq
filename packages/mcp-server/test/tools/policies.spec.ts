import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerPoliciesTools } from '../../src/tools/policies';
import type { RawHttp } from '../../src/tools/raw-http';
import type { ToolDefinition } from '../../src/tools/registry';

function buildAegis() {
  return {
    policies: {
      create: vi.fn(async (agentId, input) => ({ policyId: 'pol_1', agentId, ...input })),
      list: vi.fn(async () => []),
      revoke: vi.fn(async () => undefined),
    },
  };
}

function buildRawHttp(): { http: RawHttp; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn(async () => ({ policies: [] }));
  return { http: { json } as unknown as RawHttp, json };
}

describe('aegis.policies.* tools', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('registers four tools', () => {
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(buildAegis() as never, buildRawHttp().http, reg);
    expect(reg.size).toBe(4);
  });

  it('aegis.policies.create converts expires_in_seconds → expiresAt and calls SDK create(agentId, input)', async () => {
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'));
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, buildRawHttp().http, reg);
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
    registerPoliciesTools(aegis as never, buildRawHttp().http, reg);
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

  it('aegis.policies.list falls through to SDK when no filters are supplied', async () => {
    const aegis = buildAegis();
    const { http, json } = buildRawHttp();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, http, reg);
    await reg.get('aegis.policies.list')!.handler({ agent_id: 'agt_1' });
    expect(aegis.policies.list).toHaveBeenCalledWith('agt_1');
    expect(json).not.toHaveBeenCalled();
  });

  it('aegis.policies.list routes through raw HTTP when status/limit/cursor filters are supplied', async () => {
    const aegis = buildAegis();
    const { http, json } = buildRawHttp();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, http, reg);
    await reg.get('aegis.policies.list')!.handler({ agent_id: 'agt_1', status: 'ACTIVE', limit: 10 });
    expect(json).toHaveBeenCalledWith('/v1/agents/agt_1/policies', {
      query: { status: 'ACTIVE', limit: '10', cursor: undefined },
    });
    expect(aegis.policies.list).not.toHaveBeenCalled();
  });

  it('aegis.policies.revoke requires agent_id + policy_id and reports reason was not persisted', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerPoliciesTools(aegis as never, buildRawHttp().http, reg);
    const result = await reg
      .get('aegis.policies.revoke')!
      .handler({ agent_id: 'agt_1', policy_id: 'pol_1', reason: 'rotation' });
    expect(aegis.policies.revoke).toHaveBeenCalledWith('agt_1', 'pol_1');
    expect(result).toMatchObject({ agentId: 'agt_1', policyId: 'pol_1', revoked: true, reasonAccepted: false });
  });
});
