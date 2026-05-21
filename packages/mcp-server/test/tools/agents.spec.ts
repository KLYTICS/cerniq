import { describe, it, expect, vi } from 'vitest';
import { registerAgentsTools } from '../../src/tools/agents';
import type { RawHttp } from '../../src/tools/raw-http';
import type { ToolDefinition } from '../../src/tools/registry';

function buildAegis() {
  return {
    agents: {
      register: vi.fn(async (input) => ({ agentId: 'agt_1', ...input })),
      get: vi.fn(async (id) => ({ agentId: id })),
      revoke: vi.fn(async () => undefined),
    },
  };
}

function buildRawHttp(): { http: RawHttp; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn(async () => ({ agents: [] }));
  return { http: { json } as unknown as RawHttp, json };
}

describe('aegis.agents.* tools', () => {
  it('registers four tools', () => {
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(buildAegis() as never, buildRawHttp().http, reg);
    expect(reg.size).toBe(4);
    for (const name of ['aegis.agents.create', 'aegis.agents.get', 'aegis.agents.list', 'aegis.agents.revoke']) {
      expect(reg.has(name)).toBe(true);
    }
  });

  it('aegis.agents.create maps label + public_key + runtime to SDK register()', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, buildRawHttp().http, reg);
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
    registerAgentsTools(aegis as never, buildRawHttp().http, reg);
    await reg.get('aegis.agents.create')!.handler({ public_key: 'BBBB' });
    expect(aegis.agents.register).toHaveBeenCalledWith({ publicKey: 'BBBB', runtime: 'CUSTOM' });
    await reg.get('aegis.agents.create')!.handler({ public_key: 'CCCC', runtime: 'NOPE' });
    expect(aegis.agents.register).toHaveBeenLastCalledWith({ publicKey: 'CCCC', runtime: 'CUSTOM' });
  });

  it('aegis.agents.list delegates to raw HTTP with pagination', async () => {
    const aegis = buildAegis();
    const { http, json } = buildRawHttp();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, http, reg);
    await reg.get('aegis.agents.list')!.handler({ limit: 25, cursor: 'cur_abc' });
    expect(json).toHaveBeenCalledWith('/v1/agents', { query: { limit: '25', cursor: 'cur_abc' } });
  });

  it('aegis.agents.revoke calls SDK revoke(id) and reports reason was not persisted', async () => {
    const aegis = buildAegis();
    const reg = new Map<string, ToolDefinition>();
    registerAgentsTools(aegis as never, buildRawHttp().http, reg);
    const result = await reg
      .get('aegis.agents.revoke')!
      .handler({ agent_id: 'agt_1', reason: 'compromised' });
    expect(aegis.agents.revoke).toHaveBeenCalledWith('agt_1');
    expect(result).toMatchObject({ agentId: 'agt_1', revoked: true, reasonAccepted: false });
  });
});
