#!/usr/bin/env node
// `npx @cerniq/mcp-server` — stdio MCP server for Claude Desktop / Cursor.
//
// Configure your host's MCP config to point at this binary, e.g. for
// Claude Desktop's `claude_desktop_config.json`:
//
// {
//   "mcpServers": {
//     "cerniq": {
//       "command": "npx",
//       "args": ["-y", "@cerniq/mcp-server"],
//       "env": { "CERNIQ_API_KEY": "cerniq_live_..." }
//     }
//   }
// }

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createCerniqMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createCerniqMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes.
}

main().catch((err: unknown) => {
  console.error('cerniq-mcp fatal:', err);
  process.exit(1);
});
