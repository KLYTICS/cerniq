# ADR-0008 — MCP is the control plane for CERNIQ-verified tool calls

**Status**: accepted
**Date**: 2026-05-02
**Deciders**: sid=enterprise-backbone-arch (operator: erwin)
**Supersedes**: none

## Context

In 2026 the Model Context Protocol (MCP) is the universal tool-call
shape for LLM agents. Claude Code, Cursor, Claude Desktop, Cline, OpenAI
Responses-API "tool" calls, Gemini function-calling adapters — they all
either speak MCP natively or have MCP shims. Anthropic's MCP spec is at
2025-06-18 (current as of this ADR), with a stable JSON-RPC 2.0 transport
surface and three transport bindings: `stdio`, Server-Sent Events, and
Streamable HTTP.

What MCP does NOT carry today: a verified agent identity. An MCP server
sees `{"method":"tools/call","params":{"name":"transfer_funds",...}}`
and has no native way to know whether the caller is a sanctioned agent,
a jail-broken agent, a stolen-credentials replay, or a developer
poking the endpoint with `curl`.

CERNIQ already issues short-lived Ed25519-signed agent tokens with policy
claims. `packages/mcp-bridge` wraps an MCP server's request handler and
verifies those tokens before tools execute (skeleton landed in Phase 0).
What's missing is the inverse direction: CERNIQ itself exposed _as_ an
MCP server, so any agent host (Claude Desktop, Cursor, etc.) can call
`cerniq.verify`, `cerniq.agents.create`, `cerniq.policies.list` directly
through the same MCP transport its other tools use.

This ADR commits to MCP as the canonical control-plane shape — every
CERNIQ API surface gets an MCP method binding alongside the REST/HTTP
binding, and every MCP server in the wild is a candidate CERNIQ relying
party.

## Decision

1. **Bidirectional MCP integration.** CERNIQ ships two MCP packages:
   - `@cerniq/mcp-bridge` (existing, this ADR confirms scope) — wraps an
     upstream MCP server's handler so every tool call is gated by an
     CERNIQ verify decision. Verification surface: `verify(token, action)`.
   - `@cerniq/mcp-server` (NEW, this ADR introduces) — exposes the CERNIQ
     management API (identity, policy, verify, audit-read) as MCP tools.
     Distribution: `npx @cerniq/mcp-server`. Configures from
     `~/.cerniq/credentials.json` or env. Speaks `stdio` and `streamable-http`.
2. **MCP method namespace.** All CERNIQ tools live under the `cerniq.*`
   namespace. Stable names below — versioned with the API minor, never
   renamed without an ADR:
   - `cerniq.verify` — 1:1 with `POST /v1/verify`
   - `cerniq.agents.create | get | list | revoke | report`
   - `cerniq.policies.create | get | list | revoke`
   - `cerniq.audit.search` (read-only, principal-scoped)
   - `cerniq.well_known.audit_signing_key` (no auth)
3. **Trust direction inversion.** When CERNIQ is _the MCP server_, the
   caller is a host (e.g. Claude Desktop). Authentication is by API key
   in the MCP `initialize` exchange (`clientInfo.metadata.cerniqApiKey`),
   per-request audited. When CERNIQ is _behind an MCP bridge_ (other
   server), the caller is an agent. Authentication is by CERNIQ token.
   These are different code paths and we will not conflate them.
4. **MCP servers are first-class principals.** Add `RelyingPartyKind =
MCP_SERVER | HTTP_API | OTHER` (Prisma enum) so MCP-server-as-RP can
   be discovered, rated, and reasoned about separately. MCP servers
   self-register via `POST /v1/relying-parties/mcp` with a manifest
   pointing to their `tools/list` discovery endpoint.

## Consequences

### Positive

- One `wrap()` line in any MCP server inherits CERNIQ identity, policy,
  audit. Distribution wedge; every popular MCP becomes a customer.
- Claude Desktop / Cursor users provision an `cerniq-mcp` server in their
  config and get scriptable agent management without leaving the host.
- MCP transport reuse: TLS, content-types, error shapes, batching are
  the host's problem. CERNIQ only owns the verification logic.
- Audit chain enriched with `mcpServerId` + `mcpMethod` per event —
  lets relying parties slice their own CERNIQ audit log per-tool.

### Negative

- We're betting on MCP wire-format stability. If the spec re-cuts the
  JSON-RPC envelope (low probability — JSON-RPC has been stable since
  2010), we eat a transport adapter rewrite.
- Two CERNIQ surfaces (REST + MCP) means double the spec maintenance.
  Mitigation: MCP server is generated from the OpenAPI spec at
  `docs/spec/CERNIQ_API_SPEC.yaml`; one source of truth.
- DPoP replay prevention (ADR-0010) requires the MCP transport to
  surface request headers cleanly. Stdio doesn't have headers — DPoP
  proofs ride in `params._cerniq_dpop` instead. Code path duplication.

### Neutral

- `@cerniq/mcp-bridge` README updated to point at this ADR.
- Verifier-rp package gets an MCP-aware example.
- Dashboard adds an MCP-server-discovery view (deferred to M-028).

## Alternatives considered

### Alt A: Custom CERNIQ protocol over WebSocket

Inventing our own framing was rejected because every host would need a
custom integration. MCP is already in their stack; we ride along.

### Alt B: REST-only, no MCP server, only mcp-bridge

This was the Phase-0 default. Rejected because it forces every CERNIQ
user to also drop in an HTTP client SDK, which is friction MCP-native
hosts (Claude Desktop) shouldn't have. Bridge alone is half the value.

### Alt C: GraphQL gateway

Looked at briefly. GraphQL is excellent at fan-out reads but adds a
schema-stitching surface CERNIQ doesn't need. The verify call is one
RPC; over-engineering it.

## How to reverse this decision

If MCP loses momentum (low likelihood given Anthropic + OpenAI + Google
all shipping MCP integrations as of early 2026), we deprecate
`@cerniq/mcp-server` with a 12-month sunset. `@cerniq/mcp-bridge` stays
either way — it's framework-agnostic verification middleware.
The REST API is the source of truth and is unaffected.

Files that would change: delete `packages/mcp-server/`,
`apps/api/src/modules/mcp/**`, drop `RelyingPartyKind` enum, remove
`mcpServerId` audit columns. Three customer-comms windows: deprecation
notice → freeze → removal.

## References

- MCP spec (2025-06-18): https://spec.modelcontextprotocol.io/
- Existing scaffold: `packages/mcp-bridge/src/index.ts`
- ADR-0003 (portable verify path) — verify algorithm stays framework-free,
  callable from MCP server adapter without re-implementation.
- ADR-0004 (denial precedence) — preserved across REST and MCP surfaces.
- WORK_BOARD M-021 (mcp-server impl), M-022 (mcp module CRUD), M-028
  (dashboard MCP discovery).
