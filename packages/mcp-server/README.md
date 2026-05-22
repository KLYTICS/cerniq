# `@okoro/mcp-server` — OKORO as an MCP server

Exposes OKORO's verify, agents, policies, and audit APIs as
[Model Context Protocol](https://spec.modelcontextprotocol.io/) tools.
Configure once in your MCP host (Claude Desktop, Cursor, Cline,
Continue, …) and your LLM session can manage OKORO directly.

Companion to `@okoro/mcp-bridge` — that wraps *other* MCP servers to
require OKORO verification; this one *is* an MCP server.

## Install & configure

```bash
npm install -g @okoro/mcp-server
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "okoro": {
      "command": "npx",
      "args": ["-y", "@okoro/mcp-server"],
      "env": {
        "OKORO_API_KEY": "okoro_live_xxxxx",
        "OKORO_BASE_URL": "https://api.okoro.dev"
      }
    }
  }
}
```

Restart Claude Desktop. Open a chat and ask: *"List my OKORO agents"*.

### Cursor / Cline

Same config, in their respective MCP config files.

## Tools exposed

| Tool | Maps to |
|---|---|
| `okoro.verify` | `POST /v1/verify` |
| `okoro.agents.create` | `POST /v1/agents` |
| `okoro.agents.get` | `GET /v1/agents/{id}` |
| `okoro.agents.list` | `GET /v1/agents` |
| `okoro.agents.revoke` | `POST /v1/agents/{id}:revoke` |
| `okoro.policies.create` | `POST /v1/policies` |
| `okoro.policies.get` | `GET /v1/policies/{id}` |
| `okoro.policies.list` | `GET /v1/policies` |
| `okoro.policies.revoke` | `POST /v1/policies/{id}:revoke` |
| `okoro.audit.search` | `GET /v1/audit-events` |

Tool name stability is committed in ADR-0008.

## Restricting which tools are exposed

```ts
import { createOkoroMcpServer } from '@okoro/mcp-server';

const server = createOkoroMcpServer({
  allowedTools: ['okoro.verify', 'okoro.audit.search'],
});
```

Useful for read-only operator dashboards.

## Security notes

- The API key in `OKORO_API_KEY` carries the principal's authority. Use
  a scoped key — OKORO supports per-key role limits.
- This package never sees agent **private** keys (ADR-0002).
- DPoP (ADR-0010) is not yet enforced in v0.1; planned for v0.2 once the
  server-side gate flips.
- The `okoro.audit.search` tool is read-only by API design; an attacker
  with this key cannot tamper with the audit chain (ADR-0011).

## Reference

- ADR-0008: `docs/decisions/0008-mcp-as-control-plane.md`
- API spec: `docs/spec/OKORO_API_SPEC.yaml`
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
