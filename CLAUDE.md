# CERNIQ - Claude operating contract

Last audited: 2026-05-08

Read this before changing anything. This repository is a security, identity,
policy, billing, audit, SDK, dashboard, and edge platform. Treat it like
public-company infrastructure: every change needs a clear owner, a small blast
radius, typed contracts, auditable behavior, and verification evidence.

## What CERNIQ is

CERNIQ is the neutral verification, policy enforcement, and behavioral
attestation layer between AI agents and the services they act on. CERNIQ holds
only public keys, signs only what it observed, and remains protocol-, vendor-,
and model-neutral. The canonical product and architecture references are:

- `docs/spec/01_MASTER.md`
- `docs/spec/03_TECHNICAL_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/SERVICE_MAP.md`

## Repository map

| Path              | Owns                                                                          | Local guidance             |
| ----------------- | ----------------------------------------------------------------------------- | -------------------------- |
| `apps/api/`       | NestJS control plane, verify origin, Prisma, billing, audit, policy, identity | `apps/api/CLAUDE.md`       |
| `apps/dashboard/` | Next.js operator and developer dashboard                                      | `apps/dashboard/CLAUDE.md` |
| `packages/`       | Public SDKs, types, CLI, MCP packages, relying-party verifier                 | `packages/CLAUDE.md`       |
| `workers/`        | Cloudflare verify-edge surface                                                | `workers/CLAUDE.md`        |
| `tests/`          | Black-box, parity, cross-package, load, and chaos tests                       | `tests/CLAUDE.md`          |
| `infra/`          | Deployment, networking, Auth0, observability, backup, KMS docs/config         | `infra/CLAUDE.md`          |
| `docs/`           | Specs, runbooks, threat models, release and compliance material               | `docs/CLAUDE.md`           |

Before editing a scoped path, read its local `CLAUDE.md` after this file.

## Stack reality

- Monorepo: pnpm workspaces. Root scripts are the primary orchestration surface.
- API: NestJS 11, Prisma 5, PostgreSQL 16, Redis 7, BullMQ, Pino, Helmet, Zod
  config, Prometheus metrics, OpenTelemetry hooks, Stripe billing, optional KMS
  adapters.
- Dashboard: Next.js 16 and React 19. Server components by default.
- Public packages: TypeScript SDK, Python SDK, shared types, CLI, MCP server,
  MCP bridge, and relying-party verifier.
- Edge: Cloudflare Worker verify surface remains phase-gated and must preserve
  origin semantics.
- Crypto: Ed25519 is the primary curve. Use existing audited utilities and do
  not introduce alternate crypto libraries casually.

## File layout cheatsheet

```text
cerniq/
|-- apps/
|   |-- api/                    NestJS control plane and origin verify path
|   `-- dashboard/              Next.js operator/developer dashboard
|-- packages/
|   |-- types/                  shared Zod schemas and constants
|   |-- sdk-ts/                 public TypeScript SDK
|   |-- sdk-py/                 public Python SDK
|   |-- cli/                    operator CLI
|   |-- verifier-rp/            relying-party offline verifier
|   |-- mcp-server/             CERNIQ MCP server
|   `-- mcp-bridge/             MCP verification middleware
|-- workers/cf-verify/          Cloudflare verify edge
|-- tests/                      e2e, parity, load, and chaos coverage
|-- infra/                      deployment and operational config/docs
|-- docs/                       specs, runbooks, decisions, handoffs
|-- CLAUDE.md                   root Claude contract
|-- AGENTS.md                   Codex/OMX operating contract
|-- WORK_BOARD.md               claimable work modules
`-- OPERATOR_DECISIONS.md       unresolved operator choices
```

## Architecture invariants (non-negotiable)

1. Private keys never enter CERNIQ. Client SDKs may generate and hold private
   keys locally; the API and database store public keys only.
2. The `/v1/verify` hot path must remain portable. Decision logic that touches
   signatures, policies, spend, trust scores, or denial precedence belongs in
   pure utilities or portable package code, not NestJS-only wrappers.
3. Audit events are append-only and signed. No production path may update or
   delete `AuditEvent` records. Every append must preserve hash-chain
   verifiability and third-party auditability.
4. No silent failures and no fabricated data. Downstream failure must be visible
   in the response, logs, metrics, or audit trail as appropriate. Never hide an
   error behind an empty list, fake score, stub policy, or synthetic success.
5. Multi-tenant isolation is by `principalId` on every query and mutation. The
   API key guard establishes the principal; services carry that boundary all the
   way to Prisma calls, cache keys, queues, and webhooks.
6. Denial precedence is stable API behavior. Current order:
   `AGENT_NOT_FOUND`, `AGENT_REVOKED`, `INVALID_SIGNATURE`,
   `POLICY_REVOKED`, `POLICY_EXPIRED`, `SCOPE_NOT_GRANTED`,
   `TRIAL_EXHAUSTED`, `SPEND_LIMIT_EXCEEDED`, `TRUST_SCORE_TOO_LOW`,
   `ANOMALY_FLAGGED`. `PLAN_LIMIT_EXCEEDED` is the pre-algorithm billing gate.
   Any change requires a spec/docs update, parity tests, and API version review.
7. Contracts are generated or centrally owned. Wire schemas and constants belong
   in `packages/types` unless a local package owns a narrower public contract.
8. Public SDKs and verifier packages must stay runtime-portable. Do not add
   Node-only APIs to browser, edge, or relying-party surfaces.

## Latest session state

Use `docs/SESSION_HANDOFF.md` as the freshest work log when it conflicts with
older summary docs. As of the newest reviewed sessions:

- The conversion loop is live: pricing CTA to login return preservation to
  billing auto-checkout to Stripe upgrade to continued verify.
- `/.well-known/pricing.json` is the canonical public pricing mirror; dashboard
  pricing SSR-fetches it through `CERNIQ_API_BASE_URL` with an explicit build-time
  fallback and parity coverage.
- Safe redirect helpers protect `/login` return paths and checkout intent. Do
  not bypass them with ad hoc URL handling.
- Free trial exhaustion is a lifetime product gate represented by
  `TRIAL_EXHAUSTED`; paid overage metering is wired through Stripe usage records
  and must never block the verify hot path.
- Cross-package parity is a first-class gate. Use it whenever dashboard, API,
  generated enums, SDKs, OpenAPI, or public docs share a contract.

## Quality bar

- Prefer deletion, reuse, and boundary repair over new layers.
- No new dependency unless the task explicitly requires it and the benefit is
  worth the supply-chain and maintenance cost.
- No `any` unless it has a nearby `// type-rationale:` comment.
- No `Math.random` in production security, identity, billing, policy, or audit
  paths. Use cryptographic randomness where randomness is required.
- Errors are typed and cataloged. Do not throw raw strings.
- Crypto, auth, billing, policy, audit, and tenant-boundary changes require
  paired tests in the same change.
- Migrations are append-only after merge. Never edit a previously applied
  migration unless the operator explicitly asks for a local repair before it has
  been deployed.
- Public docs, OpenAPI, Zod schemas, generated enums, SDK types, and dashboard
  assumptions must move together.
- Keep changes small enough for a reviewer to understand the risk.

## Work protocol

1. Check `git status --short --branch` first. This repo often has many active
   edits. Do not revert or overwrite work you did not make.
2. Read `WORK_BOARD.md` and `docs/SESSION_HANDOFF.md` before broad changes.
   If a Claude peer claim is required, use the existing `claude-peers` protocol.
3. Identify the owning surface and read the local `CLAUDE.md`.
4. Make the smallest coherent change. Keep unrelated cleanup out of feature,
   security, or hot-path work.
5. Update tests, generated files, docs, and runbooks in the same change when a
   public contract or operator behavior changes.
6. Run the narrowest meaningful verification first, then broader gates when the
   blast radius justifies them.
7. Leave a handoff entry in `docs/SESSION_HANDOFF.md` for meaningful platform
   work, especially when the next session must know a decision or gap.

## How parallel sessions claim work

1. Open `WORK_BOARD.md`.
2. Pick a module marked `STATUS: open` or coordinate with the current holder.
3. Run
   `~/.claude/peers/bin/claude-peers claim cerniq <module-id> --note "<what you will do>" --ttl 7200`.
4. Update `WORK_BOARD.md` with the claim, session id, and date.
5. Stay inside the claimed path set. If you must cross scopes, message the
   holder before editing.
6. When meaningful work lands, append a concise newest-first entry to
   `docs/SESSION_HANDOFF.md`.
7. Release with `~/.claude/peers/bin/claude-peers release cerniq:<module-id>`.

## Operator decisions still pending

Do not guess on these. Use `OPERATOR-INPUT-NEEDED` in code/docs and proceed
only with the documented placeholder behavior.

1. BATE scoring weights - see `docs/BATE_ALGORITHM.md`.
2. Cold-start trust accelerator policy - see `docs/BATE_ALGORITHM.md`.
3. Pricing tier hard gates and Stripe price population - see
   `docs/spec/04_COMMERCIAL_STRATEGY.md`,
   `docs/decisions/0014-pricing-and-free-trial.md`, and
   `OPERATOR_DECISIONS.md`.
4. Dashboard production and preview environments need `CERNIQ_API_BASE_URL` so
   pricing renders from the live discovery endpoint instead of fallback.
5. Auth0 v4 SDK install and real provider configuration are required before the
   dashboard login receiver is live.
6. Provider-backed KMS, Stripe price IDs, Stripe metered-price configuration,
   `sales@cerniqapp.com`, and deploy actions that require real credentials or
   console changes remain operator-owned.

## Verification commands

Use the narrowest command that proves the change, then expand as needed.

| Purpose                   | Command                                               |
| ------------------------- | ----------------------------------------------------- |
| Full local gate           | `pnpm check`                                          |
| Typecheck all workspaces  | `pnpm typecheck`                                      |
| Lint all workspaces       | `pnpm lint`                                           |
| Unit tests all workspaces | `pnpm test`                                           |
| API typecheck             | `pnpm --filter @cerniq/api typecheck`                 |
| API unit tests            | `pnpm --filter @cerniq/api test -- --passWithNoTests` |
| Dashboard typecheck       | `pnpm --filter @cerniq/dashboard typecheck`           |
| Cross-package parity      | `pnpm test:parity`                                    |
| OpenAPI/Zod parity        | `pnpm check:openapi-zod`                              |
| OpenAPI/Prisma parity     | `pnpm check:openapi-prisma`                           |
| Migration immutability    | `pnpm check:migrations`                               |
| Doctor                    | `pnpm doctor`                                         |
| Full doctor               | `pnpm doctor:full`                                    |

If a command cannot run because required services or secrets are missing, state
that clearly and run the closest offline check.

## Enterprise readiness checklist

Before calling a change done, ask:

- Does it preserve private-key, tenant, denial-precedence, audit-chain, and
  verify-portability invariants?
- Does every new behavior have an observable success and failure mode?
- Are customer-visible contracts reflected in `packages/types`, OpenAPI, SDKs,
  docs, and dashboard code where relevant?
- Are security, billing, policy, and audit changes covered by regression tests?
- Are logs and metrics useful without leaking secrets or tenant data?
- Can an operator debug or roll back this from the runbooks?
- Are known gaps captured as `OPERATOR-INPUT-NEEDED`, `Not-tested`, or a handoff
  note rather than buried in prose?

## Commit standard

Commit messages follow the Lore protocol in `AGENTS.md`: intent line first,
then narrative context, then useful git trailers such as `Constraint:`,
`Rejected:`, `Confidence:`, `Scope-risk:`, `Directive:`, `Tested:`, and
`Not-tested:`.

## When in doubt

Read in this order:

1. This file
2. The scoped `CLAUDE.md`
3. `docs/SERVICE_MAP.md`
4. `docs/ARCHITECTURE.md`
5. `docs/SECURITY.md`
6. `docs/spec/03_TECHNICAL_SPEC.md`
7. `apps/api/prisma/schema.prisma`
