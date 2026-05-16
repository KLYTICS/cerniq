# `@aegis/mcp-bridge`

AEGIS verification middleware for [Model Context Protocol](https://modelcontextprotocol.io)
servers. Wraps any MCP server transport so every tool call carries a
verified AEGIS agent identity.

## Why

In 2026, MCP is the universal tool-call protocol for LLMs. Every Claude,
GPT, and Gemini agent that touches an external tool goes through MCP.
None of those tool calls today carry a verified identity — relying
parties (databases, APIs, financial systems) have no way to know whether
a request is from a trusted agent, a compromised host, or a jailbroken
prompt.

`@aegis/mcp-bridge` is the smallest possible adapter: one import, one
`wrapMcpHandler()` call, and your MCP server enforces AEGIS-verified
identity on every tool call.

## Install

```bash
pnpm add @aegis/mcp-bridge @aegis/sdk
```

## Quickstart

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { wrapMcpHandler } from '@aegis/mcp-bridge';
import { Aegis } from '@aegis/sdk';

const aegis = new Aegis({ verifyKey: process.env.AEGIS_VERIFY_KEY! });
const server = new Server({ name: 'fs-mcp-server', version: '1.0.0' });

server.setRequestHandler(readFileSchema, wrapMcpHandler({
  aegis,
  actionPrefix: 'mcp.fs.',
  minTrustBand: 'VERIFIED',
}, async (req, ctx) => {
  // ctx.aegisVerify carries: { agentId, principalId, trustScore, trustBand, scopesGranted }
  // — use them for fine-grained access decisions inside your handler.
  return await readFile(req.params.path);
}));
```

The agent caller passes its AEGIS token via either:
1. `X-AEGIS-Token` header (preferred for HTTP / SSE / WebSocket transports)
2. `_aegis_token` field in JSON-RPC params (fallback for stdio transport)

The bridge scopes every targeted MCP method to the specific tool /
resource / prompt being invoked:

| MCP method            | Verified action                                  |
| --------------------- | ------------------------------------------------ |
| `tools/call`          | `${prefix}<toolName>`                            |
| `resources/read`      | `${prefix}resources/read.<uri>`                  |
| `resources/subscribe` | `${prefix}resources/subscribe.<uri>`             |
| `resources/unsubscribe`| `${prefix}resources/unsubscribe.<uri>`          |
| `prompts/get`         | `${prefix}prompts/get.<name>`                    |
| `tools/list` / `resources/list` / `prompts/list` | `${prefix}<method>` |

`tools/call` uses a flat target namespace because tool names are
unique per server (MCP spec §3.2). The other methods carry the method
in the action so resource URIs cannot collide with tool names. AEGIS
policies can therefore allow `mcp.fs.read_file` without allowing the
whole `tools/call` method, and allow `resources/read.config://app/x`
without allowing every resource on the server.

## Status

**0.x — preview.** The MCP SDK 1.0 transport API is still firming up; we
will track its stable release. The bridge interface is finalized; only
the transport-specific glue may evolve.

## Status policy

- The bridge **never falls open**. If verification fails for any reason
  (missing token, network error, denial), it throws `BridgeDenialError`.
  Callers can opt into custom denial handling via `config.onDenial`.
- The bridge **never caches** verification results. Each tool call
  re-verifies — at AEGIS-edge p99 of <80ms (Phase 3) this is acceptable
  even for chatty tools.
- The bridge strips `_aegis_token` and `_aegis_headers` before invoking
  downstream handlers, so auth material stays at the bridge boundary.

## See also

- AEGIS docs: <https://docs.aegislabs.io>
- MCP spec: <https://modelcontextprotocol.io>
- Strategic rationale: `docs/standards/0001-mcp-bridge-positioning.md`

## License

MIT — © KLYTICS / AEGIS Labs.
