// Core MCP server. Constructs an MCP server instance whose tools are
// the OKORO API surface. Auth is by OKORO API key, supplied either via
// env (`OKORO_API_KEY`) or via the host's MCP `initialize` metadata.

import { Okoro } from '@okoro/sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { registerAgentsTools } from './tools/agents.js';
import { registerAuditTool } from './tools/audit.js';
import { registerPoliciesTools } from './tools/policies.js';
import { TOOL_NAMES, type ToolDefinition } from './tools/registry.js';
import { registerVerifyTool } from './tools/verify.js';

export interface OkoroMcpServerOptions {
  /** OKORO API key. If omitted, the server reads `OKORO_API_KEY` from env. */
  apiKey?: string;
  /** OKORO base URL. Defaults to `https://api.okoro.dev`. */
  baseUrl?: string;
  /** Override server name in MCP `initialize`. */
  name?: string;
  /** Restrict which tools are exposed. Defaults to all tools. */
  allowedTools?: readonly string[];
}

/**
 * Build an MCP server that exposes OKORO as tools. The caller is
 * responsible for connecting it to a transport (`StdioServerTransport`
 * for `npx okoro-mcp`, `SSEServerTransport` for hosted deployments).
 *
 * Tool naming follows ADR-0008: `okoro.<resource>.<action>`.
 */
export function createOkoroMcpServer(opts: OkoroMcpServerOptions = {}): Server {
  const apiKey = opts.apiKey ?? process.env.OKORO_API_KEY;
  if (!apiKey) {
    throw new Error('OKORO_API_KEY required (pass via opts.apiKey or env)');
  }
  const okoro = new Okoro({
    apiKey,
    baseUrl: opts.baseUrl ?? process.env.OKORO_BASE_URL ?? 'https://api.okoro.dev',
  });

  // TODO(mcp-sdk): migrate to `McpServer` high-level API; `Server` is deprecated
  // but the migration touches transport wiring and handler shapes — separate PR.
  const server = new Server(
    { name: opts.name ?? 'okoro-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Build the tool registry.
  const tools = new Map<string, ToolDefinition>();
  registerVerifyTool(okoro, tools);
  registerAgentsTools(okoro, tools);
  registerPoliciesTools(okoro, tools);
  registerAuditTool(okoro, tools);

  const allowedTools = new Set(opts.allowedTools ?? TOOL_NAMES);

  // eslint-disable-next-line @typescript-eslint/require-await -- MCP SDK requires an async handler.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(tools.values())
      .filter((t) => allowedTools.has(t.name))
      .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.get(req.params.name);
    if (!tool || !allowedTools.has(tool.name)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'tool_not_found', name: req.params.name }) }],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'tool_failed', message: (err as Error).message }) }],
        isError: true,
      };
    }
  });

  return server;
}
