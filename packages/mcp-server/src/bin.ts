#!/usr/bin/env node
// `npx @okoro/mcp-server` — stdio MCP server for Claude Desktop / Cursor.
//
// Configure your host's MCP config to point at this binary, e.g. for
// Claude Desktop's `claude_desktop_config.json`:
//
// {
//   "mcpServers": {
//     "okoro": {
//       "command": "npx",
//       "args": ["-y", "@okoro/mcp-server"],
//       "env": { "OKORO_API_KEY": "okoro_live_..." }
//     }
//   }
// }

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createOkoroMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createOkoroMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes.
}

main().catch((err: unknown) => {
  console.error('okoro-mcp fatal:', err);
  process.exit(1);
});
