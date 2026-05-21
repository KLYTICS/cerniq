import { describe, it, expect, vi } from 'vitest';
import { registerAgentsTools } from '../../src/tools/agents';
import type { ToolDefinition } from '../../src/tools/registry';

function buildAegis() {
  return {
    agents: {
      register: vi.fn(async (input) => ({ agentId: 'agt_1', ...input })),
      get: vi.fn(async (id) => ({ agentId: id })),
      list: vi.fn(async () => ({ agents: [], nextCursor: null, total: 0 })),
      revoke: vi.fn(async () => undefined),
    },
  };
}

describe('aegis.agents.* tools', () => {
  it('registers four tools, each carrying MCP 1.0 annotations', () => {
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(buildAegis() as never, reg);
    expect(reg.size).toBe(4);
    for (const name of ['aegis.agents.create', 'aegis.agents.get', 'aegis.agents.list', 'aegis.agents.revoke']) {
      expect(reg.has(name)).toBe(true);
      expect(reg.get(name)!.annotations).toBeDefined();
      expect(typeof reg.get(name)!.annotations.openWorldHint).toBe('boolean');
    }
  });

  it('annotates revoke as destructive + idempotent, list/get as read-only + idempotent, create as non-idempotent', () => {
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(buildAegis() as never, reg);
    expect(reg.get('aegis.agents.revoke')!.annotations.destructiveHint).toBe(true);
    expect(reg.get('aegis.agents.revoke')!.annotations.idempotentHint).toBe(true);
    expect(reg.get('aegis.agents.list')!.annotations.readOnlyHint).toBe(true);
    expect(reg.get('aegis.agents.list')!.annotations.idempotentHint).toBe(true);
    expect(reg.get('aegis.agents.get')!.annotations.readOnlyHint).toBe(true);
    expect(reg.get('aegis.agents.create')!.annotations.idempotentHint).toBe(false);
  });

  it('aegis.agents.create maps label + public_key + runtime to SDK register()', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, reg);
    await reg.get('aegis.agents.create')!.handler({ label: 'agent-x', public_key: 'AAAA', runtime: 'OPENAI' });
    expect(aegis.agents.register).toHaveBeenCalledWith({
      publicKey: 'AAAA',
      runtime: 'OPENAI',
      label: 'agent-x',
    });
  });

  it('aegis.agents.create defaults runtime to CUSTOM when omitted or unknown', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, reg);
    await reg.get('aegis.agents.create')!.handler({ public_key: 'BBBB' });
    expect(aegis.agents.register).toHaveBeenCalledWith({ publicKey: 'BBBB', runtime: 'CUSTOM' });
    await reg.get('aegis.agents.create')!.handler({ public_key: 'CCCC', runtime: 'NOPE' });
    expect(aegis.agents.register).toHaveBeenLastCalledWith({ publicKey: 'CCCC', runtime: 'CUSTOM' });
  });

  it('aegis.agents.list delegates to typed SDK list() with passed filters', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, reg);
    await reg
      .get('aegis.agents.list')!
      .handler({ limit: 25, cursor: 'cur_abc', status: 'ACTIVE', runtime: 'ANTHROPIC', search: 'bot' });
    expect(aegis.agents.list).toHaveBeenCalledWith({
      limit: 25,
      cursor: 'cur_abc',
      status: 'ACTIVE',
      runtime: 'ANTHROPIC',
      search: 'bot',
    });
  });

  it('aegis.agents.list omits undefined filters from the SDK call', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, reg);
    await reg.get('aegis.agents.list')!.handler({});
    expect(aegis.agents.list).toHaveBeenCalledWith({});
  });

  it('aegis.agents.revoke calls SDK revoke(id) and reports reason was not persisted', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, reg);
    const result = await reg
      .get('aegis.agents.revoke')!
      .handler({ agent_id: 'agt_1', reason: 'compromised' });
    expect(aegis.agents.revoke).toHaveBeenCalledWith('agt_1');
    expect(result).toMatchObject({ agentId: 'agt_1', revoked: true, reasonAccepted: false });
  });
});
