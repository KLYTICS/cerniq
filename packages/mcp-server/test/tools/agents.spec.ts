import { describe, it, expect, vi } from 'vitest';
import { registerAgentsTools } from '../../src/tools/agents';
import type { ToolDefinition } from '../../src/tools/registry';

function buildCerniq() {
  return {
    agents: {
      create: vi.fn(async (args) => ({ id: 'agt_1', ...args })),
      get: vi.fn(async (id) => ({ id })),
      list: vi.fn(async () => ({ agents: [], cursor: null })),
      revoke: vi.fn(async () => ({ ok: true })),
    },
  };
}

describe('cerniq.agents.* tools', () => {
  it('registers four tools', () => {
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(buildCerniq() as never, reg);
    expect(reg.size).toBe(4);
    for (const name of [
      'cerniq.agents.create',
      'cerniq.agents.get',
      'cerniq.agents.list',
      'cerniq.agents.revoke',
    ]) {
      expect(reg.has(name)).toBe(true);
    }
  });

  it('cerniq.agents.create maps name + public_key + metadata', async () => {
    const cerniq = buildCerniq();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(cerniq as never, reg);
    await reg
      .get('cerniq.agents.create')!
      .handler({ name: 'agent-x', public_key: 'AAAA', metadata: { ver: 1 } });
    expect(cerniq.agents.create).toHaveBeenCalledWith({
      name: 'agent-x',
      publicKey: 'AAAA',
      metadata: { ver: 1 },
    });
  });

  it('cerniq.agents.list passes pagination', async () => {
    const cerniq = buildCerniq();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(cerniq as never, reg);
    await reg.get('cerniq.agents.list')!.handler({ limit: 25, cursor: 'cur_abc' });
    expect(cerniq.agents.list).toHaveBeenCalledWith({ limit: 25, cursor: 'cur_abc' });
  });

  it('cerniq.agents.revoke maps reason', async () => {
    const cerniq = buildCerniq();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(cerniq as never, reg);
    await reg.get('cerniq.agents.revoke')!.handler({ agent_id: 'agt_1', reason: 'compromised' });
    expect(cerniq.agents.revoke).toHaveBeenCalledWith('agt_1', { reason: 'compromised' });
  });
});
