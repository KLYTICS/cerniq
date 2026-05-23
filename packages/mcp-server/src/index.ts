// `@cerniq/mcp-server` — CERNIQ exposed as an MCP server.
//
// Per ADR-0008, this package complements `@cerniq/mcp-bridge` (which wraps
// other people's MCP servers with CERNIQ verification). Where mcp-bridge
// is the *gate*, mcp-server is the *console*: a Claude Desktop / Cursor
// user adds `cerniq-mcp` to their host config and gets `cerniq.verify`,
// `cerniq.agents.create`, `cerniq.policies.list`, `cerniq.audit.search`
// as MCP tools they can invoke from inside their LLM session.
//
// This file is the public package entry. `bin.ts` is the CLI launcher
// for `npx @cerniq/mcp-server`.

export { createCerniqMcpServer, type CerniqMcpServerOptions } from './server.js';
export { TOOL_NAMES } from './tools/registry.js';
export type { ToolName } from './tools/registry.js';
