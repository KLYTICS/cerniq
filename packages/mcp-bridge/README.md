# `@okoro/mcp-bridge`

OKORO verification middleware for [Model Context Protocol](https://modelcontextprotocol.io)
servers. Wraps any MCP server transport so every tool call carries a
verified OKORO agent identity.

## Why

In 2026, MCP is the universal tool-call protocol for LLMs. Every Claude,
GPT, and Gemini agent that touches an external tool goes through MCP.
None of those tool calls today carry a verified identity — relying
parties (databases, APIs, financial systems) have no way to know whether
a request is from a trusted agent, a compromised host, or a jailbroken
prompt.

`@okoro/mcp-bridge` is the smallest possible adapter: one import, one
`wrapMcpHandler()` call, and your MCP server enforces OKORO-verified
identity on every tool call.

## Install

```bash
pnpm add @okoro/mcp-bridge @okoro/sdk
```

## Quickstart

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { wrapMcpHandler } from '@okoro/mcp-bridge';
import { Okoro } from '@okoro/sdk';

const okoro = new Okoro({ verifyKey: process.env.OKORO_VERIFY_KEY! });
const server = new Server({ name: 'fs-mcp-server', version: '1.0.0' });

server.setRequestHandler(
  readFileSchema,
  wrapMcpHandler(
    {
      okoro,
      actionPrefix: 'mcp.fs.',
      minTrustBand: 'VERIFIED',
    },
    async (req, ctx) => {
      // ctx.okoroVerify carries: { agentId, principalId, trustScore, trustBand, scopesGranted }
      // — use them for fine-grained access decisions inside your handler.
      return await readFile(req.params.path);
    },
  ),
);
```

The agent caller passes its OKORO token via either:

1. `X-OKORO-Token` header (preferred for HTTP / SSE / WebSocket transports)
2. `_okoro_token` field in JSON-RPC params (fallback for stdio transport)

## Status

**0.x — preview.** The MCP SDK 1.0 transport API is still firming up; we
will track its stable release. The bridge interface is finalized; only
the transport-specific glue may evolve.

## Status policy

- The bridge **never falls open**. If verification fails for any reason
  (missing token, network error, denial), it throws `BridgeDenialError`.
  Callers can opt into custom denial handling via `config.onDenial`.
- The bridge **never caches** verification results. Each tool call
  re-verifies — at OKORO-edge p99 of <80ms (Phase 3) this is acceptable
  even for chatty tools.

## See also

- OKORO docs: <https://docs.okoroapp.com>
- MCP spec: <https://modelcontextprotocol.io>
- Strategic rationale: `docs/standards/0001-mcp-bridge-positioning.md`

## License

MIT — © KLYTICS / OKORO Labs.
