// Example AI-platform tool server. Wraps every MCP tool call with CERNIQ
// verification via `@cerniq/mcp-bridge` (ADR-0008).
//
// Every `tools/call` arrives with an `Authorization: Bearer <jwt>` header.
// `wrapMcpHandler` extracts the token, calls cerniq.verify(), and only
// invokes the underlying handler if the verify succeeds.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { wrapMcpHandler, BridgeDenialError } from '@cerniq/mcp-bridge';
import { cerniq } from './cerniq.js';

const server = new Server(
  { name: 'cerniq-example-ai-platform', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// Tool catalog — what the platform exposes to AI hosts.
const TOOLS = [
  {
    name: 'commerce.purchase',
    description: 'Make a purchase on behalf of the user.',
    inputSchema: {
      type: 'object',
      properties: {
        merchant_domain: { type: 'string' },
        amount: { type: 'number' },
        currency: { type: 'string' },
      },
      required: ['merchant_domain', 'amount', 'currency'],
    },
  },
  {
    name: 'data.export',
    description: "Export the user's data as a download link.",
    inputSchema: {
      type: 'object',
      properties: { format: { type: 'string', enum: ['csv', 'json'] } },
      required: ['format'],
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

const a = cerniq();

// CERNIQ-gated handler. The `wrap` lifts (req, ctx) → handler shape and
// adds `ctx.cerniqVerify` for the inner handler to use (e.g., for
// per-request audit metadata).
const handle = wrapMcpHandler<typeof CallToolRequestSchema._type, unknown>(
  {
    cerniq: a,
    actionPrefix: 'tools.',
    minTrustBand: 'VERIFIED',
  },
  async (req, ctx) => {
    const { name, arguments: args } = req.params;
    console.log(`[server] tools/call name=${name}`);
    console.log(
      `[server] cerniq verify: APPROVED agent=${ctx.cerniqVerify.agentId} band=${ctx.cerniqVerify.trustBand}`,
    );

    if (name === 'commerce.purchase') {
      // Real implementation would call a payment processor here.
      return { ok: true, transaction_id: `txn_${Date.now()}` };
    }
    if (name === 'data.export') {
      return { ok: true, download_url: `https://files.example.com/${Date.now()}.json` };
    }
    return { error: 'tool_not_found' };
  },
);

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const result = await handle(req);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    if (err instanceof BridgeDenialError) {
      console.log(`[server] cerniq verify: DENIED reason=${err.reason}`);
      return {
        content: [
          { type: 'text', text: JSON.stringify({ error: 'CERNIQ_DENIED', reason: err.reason }) },
        ],
        isError: true,
      };
    }
    throw err;
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.log('[server] cerniq-gated MCP tool server running on stdio');
