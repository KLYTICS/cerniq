---
title: MCP tool-schema drift audit
audience: Round 26 implementer picking up the F-MCP work
owner: operator (Erwin)
status: SEED — Round 25
last-reviewed: 2026-05-20
---

# MCP tool-schema drift audit (F-MCP-001..010)

This is a **seed**, not a finished audit. It captures the investigation
plan that Round 26 should execute: walk the three sides of the MCP
contract, find every drift between them, file each as a numbered
finding, and drive the parity test green.

## Why this matters

`@aegis/mcp-server` exposes AEGIS as MCP tools to Claude Desktop, Cursor,
Cline, and other MCP hosts. When tool args drift from the SDK or API
shapes, the LLM caller sees a tool that silently fails or returns the
wrong shape — exactly the cryptic-error class that destroys junior
developer trust. The parity gate at
`tests/cross-package/mcp-tool-schema-parity.spec.ts` is meant to catch
this; the gate doesn't exist yet, and the existing drift is unmeasured.

## The three contract sides

The MCP tool surface is the boundary between three independent type
sources. Drift between any pair is a finding.

| Side | Location | Owner |
|---|---|---|
| **A. API DTOs** | [apps/api/src/modules/](apps/api/src/modules/) (per-module `*.dto.ts`) | API maintainers |
| **B. SDK types** | [packages/sdk-ts/src/types.ts](packages/sdk-ts/src/types.ts) + `@aegis/types` Zod schemas | SDK maintainer |
| **C. MCP tools** | [packages/mcp-server/src/tools/](packages/mcp-server/src/tools/) | MCP package maintainer |

The MCP tool schemas should be the **derivative** of A and B, never
hand-authored. Hand-authoring is the root cause of every drift class
below.

## Investigation method

For each of the 10 tools exposed by `@aegis/mcp-server` (see
[packages/mcp-server/README.md](../packages/mcp-server/README.md)):

1. **List the tool's arg keys** as declared in `tools/<tool>.ts`.
2. **Find the matching SDK method** in `packages/sdk-ts/src/{agent,policy,verify,audit}.ts`.
3. **Find the matching API DTO** in the relevant `apps/api/src/modules/*/`.
4. **Diff the three**:
   - **Missing keys**: tool omits a field the SDK/API supports → file F-MCP-NNN.
   - **Renamed keys**: e.g. `agentId` (SDK) vs `agent_id` (tool) → file F-MCP-NNN.
   - **Type mismatch**: e.g. tool says `string` where SDK requires `'OPENAI' | 'ANTHROPIC' | ...` → file F-MCP-NNN.
   - **Response shape**: tool returns differently-shaped object than the SDK does → file F-MCP-NNN.
5. **Categorize the finding** (see below) and record the fix delta.

## Tool inventory

The 10 MCP tools to audit (from the README):

| Tool | API endpoint | SDK method | Notes |
|---|---|---|---|
| `aegis.verify` | `POST /v1/verify` | `aegis.verify()` | Hot path — drift here is most user-visible |
| `aegis.agents.create` | `POST /v1/agents/register` | `aegis.agents.register()` | Note name mismatch already (create vs register) |
| `aegis.agents.get` | `GET /v1/agents/{id}` | `aegis.agents.get()` | |
| `aegis.agents.list` | `GET /v1/agents` | (SDK lacks bulk list — possible drift) | |
| `aegis.agents.revoke` | `POST /v1/agents/{id}:revoke` | `aegis.agents.revoke()` | Verb-style endpoint vs RESTful |
| `aegis.policies.create` | `POST /v1/agents/{agentId}/policies` | `aegis.policies.create()` | |
| `aegis.policies.get` | `GET /v1/policies/{id}` | (SDK lacks get-by-policy-id — drift) | |
| `aegis.policies.list` | `GET /v1/policies` | `aegis.policies.list(agentId)` | SDK is per-agent; tool may be tenant-wide |
| `aegis.policies.revoke` | `POST /v1/policies/{id}:revoke` | `aegis.policies.revoke()` | |
| `aegis.audit.search` | `GET /v1/audit-events` | (Round 24 added — see Lane B) | NEW: `?stripeEventId=` filter |

## Finding categories

When a drift is filed as `F-MCP-NNN`, classify it:

| Category | Description | Severity |
|---|---|---|
| **schema-additive** | Tool omits an optional field the SDK supports. | Low — backward-compatible if added |
| **schema-required-missing** | Tool omits a REQUIRED field. | **High** — tool calls fail at server validation |
| **rename** | Same concept, different key name. | Medium — silent wrong-data risk |
| **type-narrowing** | Tool accepts `string` where SDK has enum/union. | Medium — junior gets cryptic 400s |
| **endpoint-mismatch** | Tool points at wrong API endpoint. | **High** — tool fails or hits wrong data |
| **response-shape** | Tool result shape != SDK result shape. | Medium — LLM caller sees unexpected fields |

## Acceptance criteria for Round 26 closure

1. Every finding F-MCP-NNN is filed under [docs/findings/](docs/) as a
   one-line entry: `F-MCP-NNN | <category> | <tool> | <fix delta>`.
2. The parity test at
   [tests/cross-package/mcp-tool-schema-parity.spec.ts](../tests/cross-package/)
   is **created** (does not exist today) and passes.
3. The test asserts, for every tool in
   `packages/mcp-server/src/tools/registry.ts`:
   - tool arg keys are a subset of `{ matching SDK method args ∪ API DTO fields }`,
   - tool result keys are a subset of `{ matching SDK result fields }`,
   - no rename without explicit allow-list (so the test can be tightened later).
4. The 10 findings each have either a "fixed in this PR" link or a
   "DEFERRED to Round 27 — reason" line.

## Why this is a seed not a Round-25 lane

Round 25 was scoped to adoption-surface unlocks — SDK quickstart,
adapter pattern, CLI bootstrap, error-catalog `next` field. Each is
independent of MCP drift; the operator can ship Round 25 outputs without
this audit landing. The MCP drift work needs its own focused session
because:

- It requires walking 10 × 3 = 30 type definitions in detail.
- The parity test design itself is a small project (Zod / TypeBox / hand-rolled?).
- Some findings will require API-side changes; those need OpenAPI sync
  and SDK regeneration in the same PR.

## Recommended Round 26 sequencing

1. **Hour 1** — Read all 10 tools + matching SDK methods + matching API
   DTOs. File raw findings in a scratch table.
2. **Hour 2** — Classify each finding, decide fix vs defer.
3. **Hour 3** — Write the parity test that captures the lock for fixed
   findings; explicitly allow-list the deferred ones with a TODO comment.
4. **Hour 4** — Apply the fixes (one PR per category if possible) and
   regenerate the catalog mirrors / SDK types / OpenAPI as needed.

## See also

- [packages/mcp-server/README.md](../packages/mcp-server/README.md) — current tool list and Claude Desktop config
- [packages/mcp-bridge/README.md](../packages/mcp-bridge/README.md) — sibling middleware (wrap other MCP servers with AEGIS verify)
- [docs/decisions/0008-mcp-as-control-plane.md](../docs/decisions/) — ADR-0008 stability commitment for tool names
- [docs/SEEDS.md](SEEDS.md) — index of all Round 25 seeds, including this one
