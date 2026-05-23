import { describe, it, expect, vi } from 'vitest';
import { registerAgentsTools } from '../../src/tools/agents';
import type { ToolDefinition } from '../../src/tools/registry';

function buildAegis() {
  return {
    agents: {
      register: vi.fn(async (args) => ({ agentId: 'agt_1', ...args })),
      get: vi.fn(async (id) => ({ agentId: id })),
      list: vi.fn(async () => ({ agents: [], cursor: null })),
      revoke: vi.fn(async () => ({ ok: true })),
    },
  };
}

describe('aegis.agents.* tools', () => {
  it('registers four tools', () => {
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(buildAegis() as never, reg);
    expect(reg.size).toBe(4);
    for (const name of ['aegis.agents.create', 'aegis.agents.get', 'aegis.agents.list', 'aegis.agents.revoke']) {
      expect(reg.has(name)).toBe(true);
    }
  });

  it('aegis.agents.create maps name + public_key + metadata', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, reg);
    await reg.get('aegis.agents.create')!.handler({ name: 'agent-x', public_key: 'AAAA', metadata: { ver: 1 } });
    expect(aegis.agents.register).toHaveBeenCalledWith({ label: 'agent-x', publicKey: 'AAAA', runtime: 'CUSTOM' });
  });

  it('aegis.agents.list passes pagination', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, reg);
    await reg.get('aegis.agents.list')!.handler({ limit: 25, cursor: 'cur_abc' });
    expect(aegis.agents.list).toHaveBeenCalledWith({ limit: 25, cursor: 'cur_abc' });
  });

  it('aegis.agents.revoke maps reason', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, reg);
    await reg.get('aegis.agents.revoke')!.handler({ agent_id: 'agt_1', reason: 'compromised' });
    expect(aegis.agents.revoke).toHaveBeenCalledWith('agt_1');
  });
});
