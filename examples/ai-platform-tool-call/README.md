# `ai-platform-tool-call` — MCP agent → CERNIQ verify → downstream API

The AI-platform vertical: an LLM agent calls a tool via MCP (Model
Context Protocol), the CERNIQ verify step runs _between_ the MCP server
and the downstream API the tool wraps. This is the natural early-
adopter wedge for CERNIQ — every tool-using AI agent has the same
problem (who is this agent, scoped to what, can it do this right now)
and MCP is the fastest-growing protocol surface where CERNIQ slots in.

## Why this pattern

Today an MCP tool that wraps a sensitive API has three weak spots:

1. **The agent is named by string.** The MCP server trusts whatever
   `client_name` the LLM client sent. No cryptographic identity.
2. **There is no scope.** A tool either works or it doesn't — you
   can't say "this agent can read invoices but not refund them" unless
   you encode it in tool definitions per agent, which is unmaintainable.
3. **There is no audit chain.** Each tool call is a log line, not a
   tamper-evident record signed by a neutral third party.

CERNIQ slots between the MCP server and the downstream API. The MCP
server stays focused on tool semantics; CERNIQ handles identity, policy,
and audit as a substrate. This pairs with `packages/mcp-server/`
(landed by peer 2026-05-02), which exposes CERNIQ itself as a set of
MCP tools — agents that use CERNIQ through MCP also get verified
through CERNIQ via MCP. Symmetric.

## The flow

```
  LLM client          MCP server (this example)         CERNIQ API           Your API
  (Claude            (wraps your downstream API)
   Desktop, etc.)
  ──────────         ─────────────────────────         ──────────         ──────────
  tool_call    →     1. receive tool invocation
                     2. extract CERNIQ_TOKEN from
                        tool args (provided by the
                        client, signed by agent kp)
                     3. cerniq.verify(token, ctx)  →    deny / allow
                                                                   ↓
                     4. on allow: forward to                      →     downstream
                        downstream API                                   action
                     5. on deny: surface             ←
                        denialReason as tool error
   ←  tool_result
```

The MCP server here is a thin tool-wrapper; the CERNIQ verify step is
identical to the fintech / SaaS examples. What differs is the tool
shape — see `mcp-server.ts` for the MCP-specific argument extraction.

## Run

### As a standalone Node MCP server

```sh
cd examples/ai-platform-tool-call
pnpm install
CERNIQ_API_BASE=https://api.cerniq.io \
CERNIQ_VERIFY_KEY=cerniq_vk_... \
DOWNSTREAM_API_BASE=https://api.your-svc.example.com \
pnpm tsx src/mcp-server.ts
```

### Wire into Claude Desktop

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
{
  "mcpServers": {
    "your-svc-via-cerniq": {
      "command": "pnpm",
      "args": ["tsx", "/path/to/cerniq/examples/ai-platform-tool-call/src/mcp-server.ts"],
      "env": {
        "CERNIQ_API_BASE": "https://api.cerniq.io",
        "CERNIQ_VERIFY_KEY": "cerniq_vk_...",
        "DOWNSTREAM_API_BASE": "https://api.your-svc.example.com",
      },
    },
  },
}
```

The `mcp.json` snippet in this directory is the canonical version and
ships with the `cerniq init --industry ai-platform-tool-call` template.

## Walking the failure modes

The CERNIQ denial reasons surface as tool errors — `tool_use` returns
`isError: true` with a structured message. LLM clients that respect
the MCP error contract will surface that to the model, which then
explains the refusal to the user. See
`docs/CERNIQ_AS_BACKBONE.md` § 5 for the user-facing translation table.

## Production checklist

- [ ] Pair with `@cerniq/mcp-server` (peer's `packages/mcp-server/`,
      landed 2026-05-02) so the MCP control plane itself is verified.
- [ ] Token-binding: the MCP server should require the CERNIQ token to
      be present on _every_ tool call, not just the first. LLM clients
      that cache MCP sessions will silently keep an old token alive
      otherwise.
- [ ] Scope per tool: each MCP tool maps to one CERNIQ scope. A
      `read_invoices` tool maps to `scope=read:invoices`; a
      `issue_refund` tool maps to `scope=refund:invoices`. Don't
      collapse multiple sensitive tools under one scope.
- [ ] Audit cross-link: include the CERNIQ `auditEventId` in the
      downstream API's request log so a regulator can trace tool call
      → MCP server → CERNIQ audit → downstream call in one query.

## Reference

- `packages/mcp-server/` (peer-owned, 2026-05-02) — CERNIQ itself as MCP tools
- `docs/decisions/0008-mcp-as-control-plane.md` (ADR-0008) — the broader plan
- `docs/CERNIQ_AS_BACKBONE.md` § 2.3 — recommended consumption pattern
- WORK_BOARD M-040f (the ticket this example completes)
