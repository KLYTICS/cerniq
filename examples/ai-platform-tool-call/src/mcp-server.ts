// MCP server that wraps a downstream API behind an CERNIQ verify gate.
//
// The MCP tool `your_svc.action` accepts standard tool args plus an
// `cerniq_token` field. On every invocation:
//   1. Extract cerniq_token from tool args.
//   2. cerniq.verify(token, action_kind, payload).
//   3. On allow: forward to the downstream API.
//   4. On deny: return MCP tool error with the denialReason.
//
// This pairs with peer's @cerniq/mcp-server (packages/mcp-server/),
// which exposes CERNIQ itself as a set of MCP tools — symmetric: an
// agent that uses CERNIQ through MCP gets verified through CERNIQ via MCP.
//
// Read examples/ai-platform-tool-call/README.md for the production
// checklist (tool-scope mapping, token binding, audit cross-link).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Cerniq } from '@cerniq/sdk';
import { randomUUID } from 'node:crypto';

const cerniq = new Cerniq({
  baseUrl: process.env.CERNIQ_API_BASE ?? 'https://api.cerniq.io',
  verifyKey: requireEnv('CERNIQ_VERIFY_KEY'),
});

const downstream = requireEnv('DOWNSTREAM_API_BASE');

const server = new Server(
  { name: 'cerniq-gated-toolset', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// One tool today: read_invoice. Adapt the inputSchema to your downstream
// API's actual surface; the verify-then-forward pattern stays the same.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_invoice',
      description: 'Read one invoice from the downstream API. Requires an CERNIQ token in args.',
      inputSchema: {
        type: 'object',
        properties: {
          invoice_id: { type: 'string' },
          cerniq_token: { type: 'string', description: 'JWT signed by the agent' },
        },
        required: ['invoice_id', 'cerniq_token'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs } = req.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const token = String(args.cerniq_token ?? '');
  if (!token) {
    return toolError('missing cerniq_token in tool arguments');
  }

  const verdict = await cerniq.verify({
    token,
    action: { kind: `tool.${name}`, payload: args },
    requestedAmount: '0',
    minTrustScore: Number(process.env.MIN_TRUST_SCORE ?? '600'),
    jti: randomUUID(),
    now: new Date().toISOString(),
  });

  if (!verdict.valid) {
    return toolError(`denied: ${verdict.denialReason}. CERNIQ audit event ${verdict.auditEventId}`);
  }

  // Forward to the downstream API. Cross-link the CERNIQ audit id so
  // the downstream's request log can be joined back to the CERNIQ chain.
  const resp = await fetch(
    `${downstream}/invoices/${encodeURIComponent(String(args.invoice_id))}`,
    {
      headers: {
        'X-CERNIQ-Audit-Event-Id': verdict.auditEventId,
        'X-CERNIQ-Agent-Id': verdict.agentId,
      },
    },
  );
  const body = await resp.text();
  return {
    content: [
      {
        type: 'text',
        text: body,
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('cerniq-gated MCP server ready on stdio\n');

// helpers ---------------------------------------------------------

function toolError(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`ai-platform-tool-call: ${name} is required`);
  }
  return v;
}
