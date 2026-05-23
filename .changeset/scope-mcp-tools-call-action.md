---
'@aegis/mcp-bridge': minor
---

mcp-bridge: scope every MCP method that operates on a named target to that
target's action claim — not the generic JSON-RPC method name.

**Behavior change.** Previously, every method-level verify call used the
same action string regardless of which tool / resource / prompt was being
invoked. A policy that granted `mcp.fs.tools/call` granted **every** tool
behind that method (read, write, delete — anything the server exposed).
The bridge now scopes the action per-target:

| MCP method            | Old action                  | New action                                       |
| --------------------- | --------------------------- | ------------------------------------------------ |
| `tools/call`          | `mcp.fs.tools/call`         | `mcp.fs.<toolName>` (flat — tool names unique)   |
| `resources/read`      | `mcp.fs.resources/read`     | `mcp.fs.resources/read.<uri>`                    |
| `resources/subscribe` | `mcp.fs.resources/subscribe`| `mcp.fs.resources/subscribe.<uri>`               |
| `resources/unsubscribe`| `mcp.fs.resources/unsubscribe`| `mcp.fs.resources/unsubscribe.<uri>`         |
| `prompts/get`         | `mcp.fs.prompts/get`        | `mcp.fs.prompts/get.<name>`                      |
| `tools/list`, `resources/list`, `prompts/list` | unchanged | unchanged (no target) |

`tools/call` uses a flat namespace because tool names are unique within
an MCP server (MCP spec §3.2). The other methods carry the method name
in the action so resource URIs and prompt names cannot collide with
each other or with tool names that happen to spell the same string
(defense: a resource URI of `charge_card` will NOT match a `tools/call`
policy on `mcp.fs.charge_card`).

**Migration.** Split any wildcard policies scoped to
`mcp.<server>.tools/call`, `mcp.<server>.resources/read`, etc. into
per-target policies. The previous wildcard semantics were
unintentionally permissive — this is the intended security posture.

Additional hardening in the same change:

- The bridge strips `_aegis_token` and `_aegis_headers` from
  `req.params` before invoking the downstream handler. Auth material
  stays at the bridge boundary; handlers see only the tool's own
  arguments.
- `ctx.headers` keys are guaranteed lowercased (RFC 9110 §5.1
  case-insensitive header lookup). Mixed-case headers from transports
  like `X-AEGIS-Token` are normalized at the bridge so consumers don't
  have to repeat the dance.
- Non-string header values (e.g. numeric `Content-Length`) are dropped
  defensively rather than passed through as `string` to type-unsafe
  consumers.

Status: package remains 0.x preview per its README; treating as a minor
bump because the action-string semantics are a public contract for any
operator who wrote policies against this bridge.
