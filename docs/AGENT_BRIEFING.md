# AEGIS — Agent briefing for new Claude sessions

> **Read this in the first 60 seconds of a new session in this repo.**
> It's the cold-pickup compression of CLAUDE.md (156 lines), the master
> handoff (740 lines), the work board (840 lines), and the session log
> (3,300+ lines). After this, you know enough to act safely.

---

## What AEGIS is (one sentence)

AEGIS is the neutral verification, policy enforcement, behavioral
attestation, and signed-audit layer between AI agents and the services
they act on. We hold **public keys only**, sign **only what we
observed**, and stay **vendor / model / protocol neutral**. The wedge:
[`docs/MASTER_ENGINEERING_HANDOFF.md`](./MASTER_ENGINEERING_HANDOFF.md) §6.

---

## Before you do anything (60-second checklist)

```sh
# 1. Who else is in here right now?
~/.claude/peers/bin/claude-peers status

# 2. Where is the repo? Anything dirty?
cd /Users/money/Desktop/AEGIS && git status --short

# 3. What was the last round? (newest at top)
head -80 docs/SESSION_HANDOFF.md
```

The peers system is **advisory mode** — claims don't lock paths. They
tell you who else is editing what so you don't overwrite their
in-flight work. Always claim your scope:

```sh
~/.claude/peers/bin/claude-peers claim aegis "<scope-name>" \
  --note "<one-line summary>" --ttl 14400
```

Heartbeat every 20–30 minutes (`peers heartbeat`). Release when done.
Send a `peers msg <sid>` to coordinate cross-cutting changes.

---

## The six non-negotiable invariants

These are **inviolable**. If your work would break one, stop and write
an ADR in `docs/decisions/` first.

| # | Invariant | Where it's enforced |
|---|-----------|---------------------|
| 1 | **Private keys never enter AEGIS.** | SDK generates client-side; only `publicKey` on register. |
| 2 | **Verify hot path is portable.** | `apps/api/src/modules/verify/algorithm/verify.algorithm.ts` has zero NestJS / Prisma / Node-only imports. CF Workers must run the same code. |
| 3 | **Audit log is append-only and signed.** | `audit.service.append()` is the only write path. No UPDATE / DELETE on `AuditEvent`. Hash chain + Ed25519 sig per row. |
| 4 | **No silent failures, no fabricated data.** | Redis-down → fail-closed `ANOMALY_FLAGGED`. No synthetic trust scores. No empty arrays masquerading as "no results". |
| 5 | **Multi-tenant isolation by `principalId`.** | Every service method takes principalId first; every Prisma query has `where: { principalId }`; RLS belt-and-braces. |
| 6 | **Denial precedence is fixed and ordered.** | `AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE → POLICY_REVOKED → POLICY_EXPIRED → SCOPE_NOT_GRANTED → SPEND_LIMIT_EXCEEDED → TRUST_SCORE_TOO_LOW → ANOMALY_FLAGGED`. Locked by ADR-0004 + `tests/cross-package/denial-precedence-enum.spec.ts`. |

The full operating directive lives at [`CLAUDE.md`](../CLAUDE.md). Read
it once, then come back here.

---

## Repo layout (memorize this)

```
aegis/
├── apps/
│   ├── api/                  NestJS API — modules/ (identity, policy, verify,
│   │   ├── prisma/           audit, bate, billing, webhooks, auth, auth0,
│   │   ├── src/              kms, mcp, idp-clerk, idp-workos, onboarding,
│   │   └── scripts/          compliance, wellknown, health) + common/
│   └── dashboard/            Next.js 16 dev portal
├── packages/
│   ├── types/                Zod schemas — wire contract source of truth
│   ├── sdk-ts/               @aegis/sdk — TS public client
│   ├── sdk-py/               aegis — Python public client
│   ├── verifier-rp/          @aegis/verifier-rp — drop-in offline RP verifier
│   ├── audit-verifier/       @aegis/audit-verifier — offline audit chain verifier
│   ├── mcp-bridge/           @aegis/mcp-bridge — wrap() any MCP server
│   ├── mcp-server/           @aegis/mcp-server — Claude Desktop integration
│   ├── cli/                  Go single-static-binary aegis-cli
│   └── tsconfig/             shared TS configs
├── workers/
│   └── cf-verify/            Cloudflare Worker — Phase 3 edge verify
├── examples/
│   ├── fintech-payments/     Single-token PSP gate
│   ├── acp-bridge/           Stripe ACP + AEGIS dual verify
│   ├── banking-rails/        ISO 20022 / treasury per-rail trust
│   ├── ai-platform-tool-call/ MCP integration
│   ├── relying-party-verifier/ RP pattern
│   ├── saas-seat-provisioning/ SCIM-shaped agent fan-out
│   └── reconciliation/       Audit ↔ system join + 4 mismatch classes
├── tests/
│   ├── cross-package/        SDK↔API + signer↔verifier + denial-enum parity
│   ├── e2e/                  15 black-box numbered suites
│   ├── load/                 k6 + autocannon harnesses
│   └── chaos/                fault-injection scaffold
├── infra/
│   ├── observability/        otel-collector.yaml, alerts/, grafana-dashboards/, runbooks/
│   ├── kms/                  KMS wiring per provider
│   ├── postgres/, redis/     local docker-compose
│   └── auth0/                Auth0 Action source
├── scripts/                  operator scripts (keys, seed, health, audit-verify)
├── docs/                     spec/, decisions/, personas/, plus the docs below
└── workers/cf-verify/        edge port of verify hot path
```

---

## Documentation map (where to read what)

| If you need…                                | Read |
|---------------------------------------------|------|
| The contract for this session               | `CLAUDE.md` |
| The ARCHITECTURAL big picture               | `docs/MASTER_ENGINEERING_HANDOFF.md` |
| What's claimed / shipping right now         | `WORK_BOARD.md` + `peers status` |
| What's just landed (newest first)           | `docs/SESSION_HANDOFF.md` |
| How a layer is composed with X foundational system | `docs/INTEGRATION_PATTERNS.md` |
| How to onboard a partner                    | `docs/PARTNER_ONBOARDING.md` |
| Compliance evidence map                     | `docs/COMPLIANCE_BUNDLE.md` |
| Local dev setup                             | `docs/RUNBOOK.md` |
| On-call incident response                   | `docs/INCIDENT_RUNBOOK.md` |
| Architecture deep-canon docs                | `docs/{ARCHITECTURE, SECURITY, THREAT_MODEL_v2, CAPACITY_PLAN, FAILURE_MODES, RETENTION_POLICY}.md` |
| The OpenAPI wire spec                       | `docs/spec/AEGIS_API_SPEC.yaml` |
| Why a decision was made                     | `docs/decisions/0001..0013.md` (ADRs) |

---

## What just shipped (rounds 11–14)

| Round | Lead session | What landed                                                           |
|-------|--------------|------------------------------------------------------------------------|
| 11    | sid=d328b045 | spec-sync CI scripts + denial-enum reorder + fintech `agent-sim.ts`    |
| 12    | sid=d328b045 | `examples/acp-bridge`, `examples/banking-rails`, `INTEGRATION_PATTERNS.md` |
| 12    | sid=c4f241c5 | Webhook secret envelope encryption, Stripe scaffold                    |
| 12    | sid=69abf7c1 | Stripe billing controller, audit NDJSON tenant export, OTel spans, dashboard /billing + /webhooks |
| 13    | sid=c4f241c5 | KMS module type-clean, multi-tenant E2E, bulk-encrypt webhook secrets  |
| 13    | sid=d328b045 | `@aegis/audit-verifier` package, `examples/reconciliation`, `INCIDENT_RUNBOOK.md`, `COMPLIANCE_BUNDLE.md` |
| 14    | sid=d328b045 | this briefing + cross-package parity tests + partner onboarding kit    |

For the long-form what-shipped-when, walk `docs/SESSION_HANDOFF.md`.

---

## Where to start (by intent)

### "I want to add a new feature"
1. Check `WORK_BOARD.md` for an open module that fits.
2. Claim it via peers + flip STATUS to `claimed by <sid>`.
3. Read the module's listed Goal + Acceptance + paths.
4. Stay inside the listed paths. Coordinate via peers msg if you need to cross.

### "I want to fix a bug"
1. Reproduce locally (`docs/RUNBOOK.md`).
2. If it's an invariant violation → `docs/INCIDENT_RUNBOOK.md` first.
3. Write the regression test in `tests/cross-package/` if it spans surfaces, otherwise in the module's `*.spec.ts`.
4. Fix; submit; run `pnpm vitest run` from root for the parity sweep.

### "I want to extend a foundational integration"
1. Find the closest example in `examples/`.
2. Read `docs/INTEGRATION_PATTERNS.md` § for that vertical.
3. Don't reinvent — the dual-verify pattern (acp-bridge), per-rail trust (banking-rails), MCP wrap (ai-platform-tool-call) are the canonical shapes.

### "I'm operating in production"
1. `docs/INCIDENT_RUNBOOK.md` for SEV-1/SEV-2.
2. `infra/observability/runbooks/` for specific alert symptoms.
3. `docs/CAPACITY_PLAN.md` § for SLA targets.

### "I want to ship a public package"
1. `packages/audit-verifier/` and `packages/verifier-rp/` are the two MIT-licensed external-facing packages. The pattern: closed dep set (`@noble/*` only), edge-runtime ready, paired specs, "what's intentionally absent" README section.
2. Add a parity test in `tests/cross-package/` that locks the public surface against the API.

---

## Quality bar (mirror to your work)

```
[ ] No `any` without // type-rationale: prefix
[ ] noUncheckedIndexedAccess respected
[ ] Every public service method has a unit test OR // untestable: <reason>
[ ] Errors are AegisError subclasses (apps/api/src/common/errors/)
[ ] Constants live in packages/types/src/constants.ts
[ ] No Math.random() in production paths (tests/seeds OK)
[ ] Crypto code has paired .spec.ts — NO exceptions
[ ] No fabricated data, no synthetic trust scores
[ ] Multi-tenant: principalId is the FIRST argument of every service method
[ ] Verify hot path: zero NestJS/Prisma/ioredis in verify.algorithm.ts
[ ] Audit append: only via audit.service.append()
[ ] New env vars in apps/api/src/config/config.schema.ts
[ ] New modules in apps/api/src/app.module.ts imports array
[ ] Schema changes have migration + backfill
[ ] spec-sync.yml CI passes (parity scripts in packages/types/scripts and apps/api/scripts)
```

---

## What's safe to add right now (additive paths)

These directories are **non-conflicting** if you stay strictly inside them:

- `examples/<new-vertical>/` — new integration examples
- `tests/cross-package/<new-parity>.spec.ts` — new regression guards
- `docs/<NEW_DOC>.md` — new documentation
- `tools/<new-utility>/` — new operator / partner tooling
- `packages/<new-public-package>/` — new MIT-licensed package
- `infra/observability/runbooks/<new-runbook>.md` — new alert runbooks

These are **shared / claim-required** before editing:

- `apps/api/src/**` — coordinate with peers; `app.module.ts` is the busiest hotspot
- `apps/dashboard/**` — dashboard peers usually own this
- `apps/api/prisma/**` — schema migrations need explicit ADR
- `OPERATOR_DECISIONS.md`, `WORK_BOARD.md` — peer-dirty
- `docs/SESSION_HANDOFF.md` — append-only at top, never rewrite

---

## How to make CI green before you commit

```sh
# Workspace-wide test sweep including cross-package parity:
pnpm vitest run

# Spec-sync:
pnpm -F @aegis/types spec-sync       # OpenAPI ↔ Zod
pnpm -F @aegis/api spec-sync         # OpenAPI ↔ Prisma

# API typecheck:
pnpm -F @aegis/api typecheck

# Dashboard typecheck:
pnpm -F @aegis/dashboard typecheck
```

Anything red here will be red in CI. Don't push until all green
locally — peers downstream will notice.

---

## When in doubt

1. Read CLAUDE.md.
2. Search SESSION_HANDOFF for the most recent session that touched
   your area.
3. `peers msg <sid>` the most recent author if their work is unclear.
4. Cite the file:line you're working from when describing what you'll
   do — it forces concrete thinking and gives the next Claude session
   anchors to follow.

> **The single best thing you can do for the next session: leave a
> handoff entry that's specific enough to act on cold.**
