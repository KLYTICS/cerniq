#!/usr/bin/env node
// `npx @aegis/mcp-server` — stdio MCP server for Claude Desktop / Cursor.
//
// Configure your host's MCP config to point at this binary, e.g. for
// Claude Desktop's `claude_desktop_config.json`:
//
// {
//   "mcpServers": {
//     "aegis": {
//       "command": "npx",
//       "args": ["-y", "@aegis/mcp-server"],
//       "env": { "AEGIS_API_KEY": "aegis_live_..." }
//     }
//   }
// }

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createAegisMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createAegisMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes.
}

main().catch((err: unknown) => {
  console.error('aegis-mcp fatal:', err);
  process.exit(1);
});
