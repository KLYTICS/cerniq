# `@aegis/mcp-server` — AEGIS as an MCP server

Exposes AEGIS's verify, agents, policies, and audit APIs as
[Model Context Protocol](https://spec.modelcontextprotocol.io/) tools.
Configure once in your MCP host (Claude Desktop, Cursor, Cline,
Continue, …) and your LLM session can manage AEGIS directly.

Companion to `@aegis/mcp-bridge` — that wraps *other* MCP servers to
require AEGIS verification; this one *is* an MCP server.

## Install & configure

```bash
npm install -g @aegis/mcp-server
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aegis": {
      "command": "npx",
      "args": ["-y", "@aegis/mcp-server"],
      "env": {
        "AEGIS_API_KEY": "aegis_live_xxxxx",
        "AEGIS_BASE_URL": "https://api.aegis.dev"
      }
    }
  }
}
```

Restart Claude Desktop. Open a chat and ask: *"List my AEGIS agents"*.

### Cursor / Cline

Same config, in their respective MCP config files.

## Tools exposed

| Tool | Maps to |
|---|---|
| `aegis.verify` | `POST /v1/verify` |
| `aegis.agents.create` | `POST /v1/agents` |
| `aegis.agents.get` | `GET /v1/agents/{id}` |
| `aegis.agents.list` | `GET /v1/agents` |
| `aegis.agents.revoke` | `POST /v1/agents/{id}:revoke` |
| `aegis.policies.create` | `POST /v1/policies` |
| `aegis.policies.get` | `GET /v1/policies/{id}` |
| `aegis.policies.list` | `GET /v1/policies` |
| `aegis.policies.revoke` | `POST /v1/policies/{id}:revoke` |
| `aegis.audit.search` | `GET /v1/audit-events` |

Tool name stability is committed in ADR-0008.

## Restricting which tools are exposed

```ts
import { createAegisMcpServer } from '@aegis/mcp-server';

const server = createAegisMcpServer({
  allowedTools: ['aegis.verify', 'aegis.audit.search'],
});
```

Useful for read-only operator dashboards.

## Security notes

- The API key in `AEGIS_API_KEY` carries the principal's authority. Use
  a scoped key — AEGIS supports per-key role limits.
- This package never sees agent **private** keys (ADR-0002).
- DPoP (ADR-0010) is not yet enforced in v0.1; planned for v0.2 once the
  server-side gate flips.
- The `aegis.audit.search` tool is read-only by API design; an attacker
  with this key cannot tamper with the audit chain (ADR-0011).

## Reference

- ADR-0008: `docs/decisions/0008-mcp-as-control-plane.md`
- API spec: `docs/spec/AEGIS_API_SPEC.yaml`
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
