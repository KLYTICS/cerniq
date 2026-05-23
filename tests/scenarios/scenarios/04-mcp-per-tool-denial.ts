// Scenario 04 — MCP per-tool action scoping.
//
// Exercises: L2 (per-tool policy scope) + L4 (audit).
// Procurement claim: "MCP agent has policy granting `mcp.fs.read_file` but
// not `mcp.fs.write_file`. Tool-call to read_file passes; tool-call to
// write_file is denied with SCOPE_NOT_GRANTED. Validates peer 2b178d04's
// H-2 hardening: actions are tool-scoped, not method-scoped."
//
// References: peer 2b178d04 review-findings — per-tool action scoping.

import type { Scenario } from '../lib/harness';

const scenario: Scenario = {
  id: '04',
  name: 'MCP per-tool action scoping',
  vertical: 'ai-platform',
  layers: ['L2', 'mcp'],
  description:
    'MCP bridge per-tool verification: policy grants mcp.fs.read_file but not mcp.fs.write_file. Tool-scoped policies prevent agents from escalating from "any tools/call" to "any tool" — least-privilege at the MCP layer.',
  async run(ctx, t) {
    const tenantId = 't_default';
    const agent = await ctx.registerAgent(tenantId, { initialTrust: 800 });
    ctx.attachPolicy(agent.id, {
      actions: ['mcp.fs.read_file'],
    });

    // Token signed for read_file — VALID
    const readToken = await ctx.signAction(agent.id, 'mcp.fs.read_file');
    const readResult = await ctx.verifyMcpTool(readToken, 'read_file');
    t.expect(readResult.valid, 'read_file allowed').toBe(true);
    t.expect(readResult.reason, 'read_file reason').toBe(undefined);

    // Token signed for write_file — DENIED (scope mismatch)
    const writeToken = await ctx.signAction(agent.id, 'mcp.fs.write_file');
    const writeResult = await ctx.verifyMcpTool(writeToken, 'write_file');
    t.expect(writeResult.valid, 'write_file denied').toBe(false);
    t.expect(writeResult.reason!, 'write_file SCOPE_NOT_GRANTED').toBe('SCOPE_NOT_GRANTED');

    // Audit chain captured both events with action including the tool name
    const chain = ctx.exportAuditChain();
    t.expect(chain.length, 'audit chain captured 2 rows').toBe(2);
    t.expect(chain[0]!.action, 'row 0 action').toBe('mcp.fs.read_file');
    t.expect(chain[0]!.result, 'row 0 valid').toBe('VALID');
    t.expect(chain[1]!.action, 'row 1 action').toBe('mcp.fs.write_file');
    t.expect(chain[1]!.result, 'row 1 denied').toBe('DENIED');

    const offline = await ctx.verifyAuditChainOffline();
    t.expect(offline.valid, 'offline chain valid post-denial').toBe(true);
  },
};

export default scenario;
