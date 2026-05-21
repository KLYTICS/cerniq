// Core MCP server. Constructs an MCP server instance whose tools are
// the AEGIS API surface. Auth is by AEGIS API key, supplied either via
// env (`AEGIS_API_KEY`) or via the host's MCP `initialize` metadata.

/* eslint-disable @typescript-eslint/no-deprecated --
 * `Server` is the low-level MCP API; the SDK now flags it deprecated in
 * favour of `McpServer`. We deliberately use the low-level API because
 * AEGIS wires the raw `CallToolRequestSchema` / `ListToolsRequestSchema`
 * handlers (see below) — `McpServer` would require restructuring as a
 * follow-up. Tracked in docs/SESSION_HANDOFF.md (Round 28-sync).
 */
import { Aegis, AegisError } from '@aegis/sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { registerAgentsTools } from './tools/agents.js';
import { registerAuditTool } from './tools/audit.js';
import { registerPoliciesTools } from './tools/policies.js';
import { TOOL_NAMES, type ToolDefinition } from './tools/registry.js';
import { registerVerifyTool } from './tools/verify.js';

export interface AegisMcpServerOptions {
  /** AEGIS API key. If omitted, the server reads `AEGIS_API_KEY` from env. */
  apiKey?: string;
  /** AEGIS base URL. Defaults to `https://api.aegis.dev`. */
  baseUrl?: string;
  /** Override server name in MCP `initialize`. */
  name?: string;
  /** Restrict which tools are exposed. Defaults to all tools. */
  allowedTools?: readonly string[];
}

/**
 * Build an MCP server that exposes AEGIS as tools. The caller is
 * responsible for connecting it to a transport (`StdioServerTransport`
 * for `npx aegis-mcp`, `StreamableHTTPServerTransport` for hosted).
 *
 * Tool naming follows ADR-0008: `aegis.<resource>.<action>`. Tool
 * annotations follow the MCP 1.0 spec — every tool declares
 * read-only / destructive / idempotent / open-world hints so hosts can
 * render appropriate confirmation prompts.
 */
export function createAegisMcpServer(opts: AegisMcpServerOptions = {}): Server {
  const apiKey = opts.apiKey ?? process.env.AEGIS_API_KEY;
  if (!apiKey) {
    throw new Error('AEGIS_API_KEY required (pass via opts.apiKey or env)');
  }
  const baseUrl = opts.baseUrl ?? process.env.AEGIS_BASE_URL ?? 'https://api.aegis.dev';
  const aegis = new Aegis({ apiKey, baseUrl });

  const server = new Server(
    { name: opts.name ?? 'aegis-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Build the tool registry. Each register fn is typed against `Aegis`
  // from `@aegis/sdk` — drift here is a compile-time error
  // (also gated by tests/cross-package/mcp-sdk-surface-parity.spec.ts).
  const tools = new Map<string, ToolDefinition>();
  registerVerifyTool(aegis, tools);
  registerAgentsTools(aegis, tools);
  registerPoliciesTools(aegis, tools);
  registerAuditTool(aegis, tools);

  const allowedTools = new Set(opts.allowedTools ?? TOOL_NAMES);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(tools.values())
      .filter((t) => allowedTools.has(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.get(req.params.name);
    if (!tool || !allowedTools.has(tool.name)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'tool_not_found',
              name: req.params.name,
              available: Array.from(allowedTools),
            }),
          },
        ],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text', text: JSON.stringify(toStructuredError(err)) }], isError: true };
    }
  });

  return server;
}

/**
 * Map SDK errors → MCP structured error payload. AEGIS catalog code,
 * SDK error class name, HTTP status, request id — everything the host
 * needs to render a useful message and (for AegisRateLimitedError) to
 * back off. Falls back to a generic shape for non-Aegis throws so the
 * client always receives the same envelope.
 *
 * Deliberately NOT JSON-RPC `error` — MCP CallTool returns `isError: true`
 * with a content array; the host parses the text payload. This is the
 * MCP-spec-shaped failure envelope.
 */
function toStructuredError(err: unknown): Record<string, unknown> {
  if (err instanceof AegisError) {
    return {
      error: 'tool_failed',
      sdkError: err.name,
      code: err.code,
      catalogCode: err.catalogCode ?? null,
      statusCode: err.statusCode,
      requestId: err.requestId ?? null,
      message: err.message,
    };
  }
  return {
    error: 'tool_failed',
    sdkError: 'Error',
    message: err instanceof Error ? err.message : String(err),
  };
}
