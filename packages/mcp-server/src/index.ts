// `@okoro/mcp-server` — OKORO exposed as an MCP server.
//
// Per ADR-0008, this package complements `@okoro/mcp-bridge` (which wraps
// other people's MCP servers with OKORO verification). Where mcp-bridge
// is the *gate*, mcp-server is the *console*: a Claude Desktop / Cursor
// user adds `okoro-mcp` to their host config and gets `okoro.verify`,
// `okoro.agents.create`, `okoro.policies.list`, `okoro.audit.search`
// as MCP tools they can invoke from inside their LLM session.
//
// This file is the public package entry. `bin.ts` is the CLI launcher
// for `npx @okoro/mcp-server`.

export { createOkoroMcpServer, type OkoroMcpServerOptions } from './server.js';
export { TOOL_NAMES } from './tools/registry.js';
export type { ToolName } from './tools/registry.js';
