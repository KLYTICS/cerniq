// `@aegis/mcp-server` — AEGIS exposed as an MCP server.
//
// Per ADR-0008, this package complements `@aegis/mcp-bridge` (which wraps
// other people's MCP servers with AEGIS verification). Where mcp-bridge
// is the *gate*, mcp-server is the *console*: a Claude Desktop / Cursor
// user adds `aegis-mcp` to their host config and gets `aegis.verify`,
// `aegis.agents.create`, `aegis.policies.list`, `aegis.audit.search`
// as MCP tools they can invoke from inside their LLM session.
//
// This file is the public package entry. `bin.ts` is the CLI launcher
// for `npx @aegis/mcp-server`.

export { createAegisMcpServer, type AegisMcpServerOptions } from './server.js';
export { TOOL_NAMES } from './tools/registry.js';
export type { ToolName } from './tools/registry.js';
