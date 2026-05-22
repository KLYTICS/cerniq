// Example AI-platform tool server. Wraps every MCP tool call with OKORO
// verification via `@okoro/mcp-bridge` (ADR-0008).
//
// Every `tools/call` arrives with an `Authorization: Bearer <jwt>` header.
// `wrapMcpHandler` extracts the token, calls okoro.verify(), and only
// invokes the underlying handler if the verify succeeds.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { wrapMcpHandler, BridgeDenialError } from '@okoro/mcp-bridge';
import { okoro } from './okoro.js';

const server = new Server(
  { name: 'okoro-example-ai-platform', version: '0.1.0' },
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
    description: 'Export the user\'s data as a download link.',
    inputSchema: {
      type: 'object',
      properties: { format: { type: 'string', enum: ['csv', 'json'] } },
      required: ['format'],
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

const a = okoro();

// OKORO-gated handler. The `wrap` lifts (req, ctx) → handler shape and
// adds `ctx.okoroVerify` for the inner handler to use (e.g., for
// per-request audit metadata).
const handle = wrapMcpHandler<typeof CallToolRequestSchema._type, unknown>(
  {
    okoro: a,
    actionPrefix: 'tools.',
    minTrustBand: 'VERIFIED',
  },
  async (req, ctx) => {
    const { name, arguments: args } = req.params;
    console.log(`[server] tools/call name=${name}`);
    console.log(`[server] okoro verify: APPROVED agent=${ctx.okoroVerify.agentId} band=${ctx.okoroVerify.trustBand}`);

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
      console.log(`[server] okoro verify: DENIED reason=${err.reason}`);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'OKORO_DENIED', reason: err.reason }) }],
        isError: true,
      };
    }
    throw err;
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.log('[server] okoro-gated MCP tool server running on stdio');
