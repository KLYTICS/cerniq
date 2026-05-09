---
title: AEGIS Service Map
audience: engineers picking a layer to work in
last-reviewed: 2026-05-04
---

# AEGIS Service Map

How the terminals, services, and packages fit together. This is the map an
engineer reads on day one to understand which layer owns which concern.

```
                         ┌─────────────────────────────────────┐
                         │  AEGIS principal (you, the operator) │
                         └─────────────────────────────────────┘
                                      │ holds private keys
                                      │ holds API keys
                                      ▼
            ┌──────────────────────────────────────────────────────┐
            │                  CLIENT TERMINALS                     │
            │  (have access to private keys; sign on behalf of      │
            │   the principal; never accept inbound traffic)        │
            ├──────────────────────────────────────────────────────┤
            │  • packages/sdk-ts        @aegis/sdk         (TS)     │
            │  • packages/sdk-py        aegis              (Py)     │
            │  • packages/cli           aegis              (Go)     │
            │  • packages/mcp-server    @aegis/mcp-server  (TS)     │
            └──────────────────────────────────────────────────────┘
                                      │  POST  /v1/agents/register
                                      │  POST  /v1/agents/:id/challenge
                                      │  POST  /v1/agents/:id/verify-handshake
                                      │  POST  /v1/agents/:id/policies
                                      │  POST  /v1/verify
                                      │  GET   /v1/audit/:id
                                      ▼
            ┌──────────────────────────────────────────────────────┐
            │                  AEGIS API (origin)                   │
            │  apps/api  ·  NestJS 11 + Fastify-eligible/Express    │
            ├──────────────────────────────────────────────────────┤
            │  modules/  identity   policy   verify   audit         │
            │            bate       webhooks billing  auth          │
            │            wellknown  mcp      compliance onboarding  │
            │  common/   crypto · prisma · redis · outbox · errors  │
            │  prisma/   AgentIdentity, AgentPolicy, AuditEvent…    │
            └──────────────────────────────────────────────────────┘
                  │              │                │
                  │ writes       │ caches         │ enqueues
                  ▼              ▼                ▼
            ┌──────────┐    ┌──────────┐    ┌────────────┐
            │ Postgres │    │  Redis   │    │  BullMQ    │
            │ (Prisma) │    │ (ioredis)│    │  (Redis)   │
            └──────────┘    └──────────┘    └────────────┘
                                                  │
                                                  │ deliveries (HMAC-signed)
                                                  ▼
                                       ┌──────────────────────┐
                                       │  WEBHOOK CONSUMERS    │
                                       │  customer endpoints   │
                                       └──────────────────────┘

            ┌──────────────────────────────────────────────────────┐
            │                  EDGE / READ PATH                     │
            ├──────────────────────────────────────────────────────┤
            │  • workers/cf-verify  Cloudflare Worker — KV-cached   │
            │                       /v1/verify port (Phase 3)       │
            │  • packages/verifier-rp @aegis/verifier-rp — offline   │
            │                       JWKS verify in any RP service   │
            └──────────────────────────────────────────────────────┘

            ┌──────────────────────────────────────────────────────┐
            │                  HUMAN SURFACE                        │
            ├──────────────────────────────────────────────────────┤
            │  • apps/dashboard        @aegis/dashboard   Next 16   │
            │    /, /agents, /agents/[id], /policies, /audit,       │
            │    /webhooks, /billing, /mcp-servers, /quickstart     │
            │    Cmd-K palette · g-prefixed chords · toasts         │
            │    Reads the same /v1/* endpoints as the SDK          │
            └──────────────────────────────────────────────────────┘
```

## Per-package responsibilities

| Path | Package | Owns |
|---|---|---|
| `apps/api/` | `@aegis/api` (private) | The control plane. Every state mutation flows through here. |
| `apps/dashboard/` | `@aegis/dashboard` (private) | Operator-facing read+write UI. Holds API keys, never private keys. |
| `packages/types/` | `@aegis/types` | Single source of truth for wire shapes (Zod schemas). API DTOs and dashboard fetch types both reconcile to these. |
| `packages/sdk-ts/` | `@aegis/sdk` | Public TS SDK. Browser- and Edge-runtime-safe. Holds the agent private key. |
| `packages/sdk-py/` | `aegis` | Python SDK. Mirrors TS surface. |
| `packages/cli/` | `aegis` (Go binary) | Operator CLI. `aegis agents register/handshake/...` |
| `packages/verifier-rp/` | `@aegis/verifier-rp` | Drop-in TS library for relying parties. Offline JWKS verification of `/v1/verify` tokens. |
| `packages/mcp-server/` | `@aegis/mcp-server` | MCP server exposing AEGIS tools to Claude Desktop / generic MCP clients. |
| `workers/cf-verify/` | (no npm name) | Cloudflare Worker port of `/v1/verify`. Phase-3 edge optimization. |
| `apps/api/prisma/` | (schema) | Postgres schema. AgentIdentity, AgentPolicy, AuditEvent (signed, chained), BateSignal, WebhookSubscription, Principal, OnboardingProgress, RelyingParty… |

## The first-run workflow — terminal-by-terminal

This is the canonical flow `docs/QUICKSTART.md` walks an operator through.
Each step lists which terminals participate.

| Step | Operator action | Terminal | What happens |
|---|---|---|---|
| 1 | `pnpm add @aegis/sdk` | shell | SDK installed. |
| 2 | `generateKeypair()` | SDK (browser-safe) | Ed25519 keypair, private stays local. |
| 3 | `aegis.agents.register({publicKey, runtime})` | SDK → API | `AgentIdentity` row written; principal-bound. |
| 4 | `aegis.handshake(agentId, privateKey)` | SDK → API → SDK → API | Challenge issued (Redis-stored), signed locally, verified server-side. Trust score → ≥600. |
| 5 | `aegis.policies.create(agentId, {...})` | SDK → API | EdDSA-signed JWT policy issued. |
| 6 | `aegis.sign(privKey, agentId, policyId, ctx)` then `aegis.verify(token, ctx)` | SDK | Locally-signed verify token. |
| 6b | `POST /v1/verify` | SDK → API | Verify hot path runs full denial-precedence sweep. Returns `approved | denied | flagged`. |
| 6c | Audit row written | API → Postgres | Hash-chained, AEGIS-signed event. Webhooks dispatch async via outbox + BullMQ. |
| 7 | Operator opens `/agents/:id` | Dashboard → API | Status dot, trust band, recent audit, handshake panel — all live. |

Every step has at least one Bloomberg-density visualization in the dashboard
and at least one CopyButton-backed snippet in `/quickstart`.

## Architecture invariants — quick reference

These are the inviolable rules. Full text in `apps/api/CLAUDE.md`.

1. **Private keys never enter AEGIS.** SDK is the only surface that touches one.
2. **Verify hot path is portable.** Pure functions, no NestJS imports — so the CF Worker port (Phase 3) is a drop-in.
3. **Audit is append-only and signed.** Every write goes through `audit.service.append()`. Hash-chained. No `UPDATE`/`DELETE` ever.
4. **No silent failures.** Failures surface in response + audit log. No fabricated empty arrays masking errors.
5. **Multi-tenant isolation by `principalId` on every query.** No cross-principal leaks.
6. **Denial precedence is fixed.** `AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE → POLICY_REVOKED → POLICY_EXPIRED → SCOPE_NOT_GRANTED → SPEND_LIMIT_EXCEEDED → TRUST_SCORE_TOO_LOW → ANOMALY_FLAGGED`. Spec-sync CI keeps engine + verifier-rp + OpenAPI byte-identical.

## Cross-terminal coordination — for parallel sessions

Multiple Claude sessions work in this repo. Coordination layer:

- `~/.claude/peers/bin/claude-peers claim aegis <scope> --note ...` before edits.
- `WORK_BOARD.md` lists modules; status tracked there.
- `OPERATOR_DECISIONS.md` carries open decisions with reasoned defaults.
- `docs/SESSION_HANDOFF.md` is appended after every session — read the last entry to know what just landed.
- `claude-peers msg <sid> "..."` for cross-session pings.
- `claude-peers conflict-check` before commit catches path overlap.

See `apps/api/CLAUDE.md` § "How parallel sessions claim work" for the contract.

## File layout — at a glance

```
aegis/
├── apps/
│   ├── api/                       NestJS — control plane
│   └── dashboard/                 Next.js 16 — operator UI
├── packages/
│   ├── types/                     @aegis/types — Zod schemas
│   ├── sdk-ts/                    @aegis/sdk — TS SDK
│   ├── sdk-py/                    aegis — Python SDK
│   ├── cli/                       aegis — Go CLI
│   ├── verifier-rp/               @aegis/verifier-rp — offline RP verifier
│   ├── mcp-server/                @aegis/mcp-server — MCP integration
│   └── tsconfig/, eslint-config/  shared configs
├── workers/
│   └── cf-verify/                 Cloudflare Worker — Phase 3 edge verify
├── docs/
│   ├── QUICKSTART.md              ← you-after-reading-this
│   ├── SERVICE_MAP.md             ← here
│   ├── ARCHITECTURE.md            How the pieces fit together
│   ├── SECURITY.md                Threat model + denial precedence
│   ├── BATE_ALGORITHM.md          Trust score formula + signal weights
│   ├── SESSION_HANDOFF.md         Living log of session deliveries
│   └── spec/                      Master, technical, GTM, OpenAPI
├── examples/
│   ├── ai-platform-tool-call/     MCP agent → AEGIS verify → downstream
│   ├── fintech-payments/          Stripe-style checkout with verify gate
│   └── saas-seat-provisioning/    SCIM-flavored agent provisioning
├── infra/
│   └── cloudflare/                Phase-3 edge planning notes
├── CLAUDE.md                      Operating directive (root)
├── WORK_BOARD.md                  Claimable modules
└── OPERATOR_DECISIONS.md          Open decisions with reasoned defaults
```
