import { describe, it, expect, vi } from 'vitest';
import { registerAgentsTools } from '../../src/tools/agents';
import type { ToolDefinition } from '../../src/tools/registry';

function buildOkoro() {
  return {
    agents: {
      create: vi.fn(async (args) => ({ id: 'agt_1', ...args })),
      get: vi.fn(async (id) => ({ id })),
      list: vi.fn(async () => ({ agents: [], cursor: null })),
      revoke: vi.fn(async () => ({ ok: true })),
    },
  };
}

describe('okoro.agents.* tools', () => {
  it('registers four tools', () => {
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(buildOkoro() as never, reg);
    expect(reg.size).toBe(4);
    for (const name of ['okoro.agents.create', 'okoro.agents.get', 'okoro.agents.list', 'okoro.agents.revoke']) {
      expect(reg.has(name)).toBe(true);
    }
  });

  it('okoro.agents.create maps name + public_key + metadata', async () => {
    const okoro = buildOkoro();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(okoro as never, reg);
    await reg.get('okoro.agents.create')!.handler({ name: 'agent-x', public_key: 'AAAA', metadata: { ver: 1 } });
    expect(okoro.agents.create).toHaveBeenCalledWith({ name: 'agent-x', publicKey: 'AAAA', metadata: { ver: 1 } });
  });

  it('okoro.agents.list passes pagination', async () => {
    const okoro = buildOkoro();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(okoro as never, reg);
    await reg.get('okoro.agents.list')!.handler({ limit: 25, cursor: 'cur_abc' });
    expect(okoro.agents.list).toHaveBeenCalledWith({ limit: 25, cursor: 'cur_abc' });
  });

  it('okoro.agents.revoke maps reason', async () => {
    const okoro = buildOkoro();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(okoro as never, reg);
    await reg.get('okoro.agents.revoke')!.handler({ agent_id: 'agt_1', reason: 'compromised' });
    expect(okoro.agents.revoke).toHaveBeenCalledWith('agt_1', { reason: 'compromised' });
  });
});
