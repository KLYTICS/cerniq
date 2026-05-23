# `@cerniq/mcp-server` — CERNIQ as an MCP server

Exposes CERNIQ's verify, agents, policies, and audit APIs as
[Model Context Protocol](https://spec.modelcontextprotocol.io/) tools.
Configure once in your MCP host (Claude Desktop, Cursor, Cline,
Continue, …) and your LLM session can manage CERNIQ directly.

Companion to `@cerniq/mcp-bridge` — that wraps _other_ MCP servers to
require CERNIQ verification; this one _is_ an MCP server.

## Install & configure

```bash
npm install -g @cerniq/mcp-server
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cerniq": {
      "command": "npx",
      "args": ["-y", "@cerniq/mcp-server"],
      "env": {
        "CERNIQ_API_KEY": "cerniq_live_xxxxx",
        "CERNIQ_BASE_URL": "https://api.cerniq.dev"
      }
    }
  }
}
```

Restart Claude Desktop. Open a chat and ask: _"List my CERNIQ agents"_.

### Cursor / Cline

Same config, in their respective MCP config files.

## Tools exposed

| Tool                     | Maps to                         |
| ------------------------ | ------------------------------- |
| `cerniq.verify`          | `POST /v1/verify`               |
| `cerniq.agents.create`   | `POST /v1/agents`               |
| `cerniq.agents.get`      | `GET /v1/agents/{id}`           |
| `cerniq.agents.list`     | `GET /v1/agents`                |
| `cerniq.agents.revoke`   | `POST /v1/agents/{id}:revoke`   |
| `cerniq.policies.create` | `POST /v1/policies`             |
| `cerniq.policies.get`    | `GET /v1/policies/{id}`         |
| `cerniq.policies.list`   | `GET /v1/policies`              |
| `cerniq.policies.revoke` | `POST /v1/policies/{id}:revoke` |
| `cerniq.audit.search`    | `GET /v1/audit-events`          |

Tool name stability is committed in ADR-0008.

## Restricting which tools are exposed

```ts
import { createCerniqMcpServer } from '@cerniq/mcp-server';

const server = createCerniqMcpServer({
  allowedTools: ['cerniq.verify', 'cerniq.audit.search'],
});
```

Useful for read-only operator dashboards.

## Security notes

- The API key in `CERNIQ_API_KEY` carries the principal's authority. Use
  a scoped key — CERNIQ supports per-key role limits.
- This package never sees agent **private** keys (ADR-0002).
- DPoP (ADR-0010) is not yet enforced in v0.1; planned for v0.2 once the
  server-side gate flips.
- The `cerniq.audit.search` tool is read-only by API design; an attacker
  with this key cannot tamper with the audit chain (ADR-0011).

## Reference

- ADR-0008: `docs/decisions/0008-mcp-as-control-plane.md`
- API spec: `docs/spec/CERNIQ_API_SPEC.yaml`
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
