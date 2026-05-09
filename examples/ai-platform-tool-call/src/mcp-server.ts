// MCP server that wraps a downstream API behind an AEGIS verify gate.
//
// The MCP tool `your_svc.action` accepts standard tool args plus an
// `aegis_token` field. On every invocation:
//   1. Extract aegis_token from tool args.
//   2. aegis.verify(token, action_kind, payload).
//   3. On allow: forward to the downstream API.
//   4. On deny: return MCP tool error with the denialReason.
//
// This pairs with peer's @aegis/mcp-server (packages/mcp-server/),
// which exposes AEGIS itself as a set of MCP tools — symmetric: an
// agent that uses AEGIS through MCP gets verified through AEGIS via MCP.
//
// Read examples/ai-platform-tool-call/README.md for the production
// checklist (tool-scope mapping, token binding, audit cross-link).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Aegis } from '@aegis/sdk';
import { randomUUID } from 'node:crypto';

const aegis = new Aegis({
  baseUrl: process.env.AEGIS_API_BASE ?? 'https://api.aegislabs.io',
  verifyKey: requireEnv('AEGIS_VERIFY_KEY'),
});

const downstream = requireEnv('DOWNSTREAM_API_BASE');

const server = new Server(
  { name: 'aegis-gated-toolset', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// One tool today: read_invoice. Adapt the inputSchema to your downstream
// API's actual surface; the verify-then-forward pattern stays the same.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_invoice',
      description: 'Read one invoice from the downstream API. Requires an AEGIS token in args.',
      inputSchema: {
        type: 'object',
        properties: {
          invoice_id: { type: 'string' },
          aegis_token: { type: 'string', description: 'JWT signed by the agent' },
        },
        required: ['invoice_id', 'aegis_token'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs } = req.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const token = String(args.aegis_token ?? '');
  if (!token) {
    return toolError('missing aegis_token in tool arguments');
  }

  const verdict = await aegis.verify({
    token,
    action: { kind: `tool.${name}`, payload: args },
    requestedAmount: '0',
    minTrustScore: Number(process.env.MIN_TRUST_SCORE ?? '600'),
    jti: randomUUID(),
    now: new Date().toISOString(),
  });

  if (!verdict.valid) {
    return toolError(
      `denied: ${verdict.denialReason}. AEGIS audit event ${verdict.auditEventId}`
    );
  }

  // Forward to the downstream API. Cross-link the AEGIS audit id so
  // the downstream's request log can be joined back to the AEGIS chain.
  const resp = await fetch(`${downstream}/invoices/${encodeURIComponent(String(args.invoice_id))}`, {
    headers: {
      'X-AEGIS-Audit-Event-Id': verdict.auditEventId,
      'X-AEGIS-Agent-Id': verdict.agentId,
    },
  });
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
process.stderr.write('aegis-gated MCP server ready on stdio\n');

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
