# AEGIS — Operating directive for Claude sessions

> **Read this first.** This document is the contract every Claude session in
> this repo agrees to. It exists so parallel terminals can ship in concert
> instead of stepping on each other.

---

## What AEGIS is (one paragraph)

AEGIS is the neutral verification, policy enforcement, and behavioral
attestation layer between AI agents and the services they act on. We hold
**only public keys**, we sign **only what we observed**, and we are the
**Switzerland** of agent identity — protocol-, vendor-, and model-neutral.
Full thesis: `docs/spec/01_MASTER.md`.

---

## Architecture invariants (non-negotiable)

These are inviolable. If you think you need to break one, stop and write a
proposal in `docs/decisions/`, then ping the operator.

1. **Private keys never enter AEGIS.** Agent private keys are generated
   client-side. Our database stores public keys only. The SDK is the only
   surface that touches a private key, and only locally.
2. **The verify hot path is portable.** All logic in `apps/api/src/modules/verify`
   that touches signatures, policies, or spend evaluation must call into
   packages that have **zero NestJS / DI / framework imports** (currently
   `packages/types` and `apps/api/src/common/crypto/*` pure utilities). This
   is what lets us migrate `/v1/verify` to Cloudflare Workers in Phase 3
   without a rewrite.
3. **The audit log is append-only and signed.** Every write goes through
   `audit.service.append()`. No `UPDATE` or `DELETE` on `AuditEvent` ever.
   Each event includes the previous event's id + a signature over `{prev_sig
   || canonical(event)}` to form a hash chain.
4. **No silent failures, no fabricated data.** If a downstream call fails,
   surface it in the response and the audit log. Never return a synthetic
   trust score, a stub policy, or an empty array that pretends to be a
   "no results" answer when it's actually an error. (See operator's prior
   FAANG bar in feedback memory: `feedback_apex_quality_bar`,
   `feedback_cerniq_customer_journey`.)
5. **Multi-tenant isolation by `principalId` on every query.** No cross-
   principal data leaks. The `ApiKey` guard sets `req.principal` and every
   service method takes `principalId` as the first arg.
6. **Denial precedence is fixed.** Order, top wins:
   `AGENT_NOT_FOUND` → `AGENT_REVOKED` → `INVALID_SIGNATURE` →
   `POLICY_REVOKED` → `POLICY_EXPIRED` → `SCOPE_NOT_GRANTED` →
   `SPEND_LIMIT_EXCEEDED` → `TRUST_SCORE_TOO_LOW` → `ANOMALY_FLAGGED`.
   This is what relying parties code against. **Do not change without
   updating `docs/SECURITY.md` § Denial Precedence and bumping API version.**

---

## How parallel sessions claim work

1. Open `WORK_BOARD.md` at repo root.
2. Pick a module marked `STATUS: open`.
3. Run `~/.claude/peers/bin/claude-peers claim aegis <module-id> --note "<what you'll do>" --ttl 7200`.
4. Edit `WORK_BOARD.md` — flip STATUS to `claimed by <session-id>` and date it.
5. Stay inside the file paths listed for that module. If you need to touch
   files outside, message the holder of the conflicting claim:
   `claude-peers msg <session-id> "need to touch X for Y reason"`.
6. When done, append a short entry to `docs/SESSION_HANDOFF.md` and release:
   `claude-peers release aegis:<module-id>`.

---

## Stack reality

- **Monorepo**: pnpm workspaces, no Turborepo (deliberate — pnpm `-r` is
  enough at this scale).
- **API**: NestJS 11, Fastify-eligible but on Express for `rawBody` ease,
  Pino logging, Helmet, Zod-validated config, `@nestjs/throttler`.
- **DB**: Prisma 5, PostgreSQL 16. Schema at `apps/api/prisma/schema.prisma`.
- **Cache / queues**: Redis 7 + BullMQ 5.
- **Crypto**: `@noble/ed25519` for Ed25519, `jose` for EdDSA JWTs. **Do not
  introduce alternatives.** One curve, one library, audited.
- **Tests**: Jest (Nest convention) inside `apps/api`. Standalone packages
  may use Vitest.
- **Lint/format**: ESLint + Prettier. Configured at root and per-app.
- **SDK**: `packages/sdk-ts` (TypeScript, public, MIT — eventual);
  `packages/sdk-py` (Python, future).
- **Hosting**: Railway (origin) + Cloudflare Workers (Phase 3 edge).

---

## File layout cheatsheet

```
aegis/
├── apps/
│   ├── api/                       NestJS — identity, policy, verify, audit, BATE, webhooks
│   │   ├── prisma/schema.prisma   Source of truth for the data model
│   │   └── src/
│   │       ├── main.ts            Bootstrap (Helmet, CORS, Swagger, validation pipe)
│   │       ├── app.module.ts      Module wiring
│   │       ├── common/            Cross-cutting: prisma, redis, crypto, filters
│   │       ├── config/            Zod-validated env config
│   │       └── modules/           Feature modules
│   └── dashboard/                 Next.js 16 dev portal (Phase 1 minimal)
├── packages/
│   ├── types/                     Zod schemas — the API contract
│   ├── sdk-ts/                    @aegis/sdk — public TypeScript SDK
│   ├── sdk-py/                    aegis — Python SDK (scaffold)
│   ├── tsconfig/                  Shared TS configs
│   └── eslint-config/             Shared lint config (scaffold)
├── workers/
│   └── cf-verify/                 Cloudflare Worker — Phase 3 edge verify
├── docs/
│   ├── ARCHITECTURE.md            How the pieces fit together
│   ├── SECURITY.md                Threat model, key handling, denial precedence
│   ├── BATE_ALGORITHM.md          Trust score formula and signal weights
│   ├── SESSION_HANDOFF.md         Living log of session deliveries
│   └── spec/                      Original master, technical, GTM, API spec
├── CLAUDE.md                      ← you are here
├── WORK_BOARD.md                  Claimable modules
├── README.md                      Public-facing quickstart
└── docker-compose.yml             Local Postgres + Redis
```

---

## Quality bar (mirroring operator's other projects)

- **No `any`** unless you justify it in a comment with a `// type-rationale:` prefix.
- **`noUncheckedIndexedAccess`** is on at the base; the API softens it.
  Don't soften it elsewhere.
- **Every public service method has a unit test** (or an explicit
  `// untestable: <reason>` comment).
- **Errors are typed**, not strings. Use `AegisError` subclasses from
  `apps/api/src/common/errors`.
- **Constants live in `packages/types`**, not duplicated across services.
- **No fabricated data**, no `Math.random` in production code paths
  (allowed only in tests and seed scripts), no fallback values for
  observability metrics.
- **Crypto code requires a paired `.spec.ts`**. No exceptions.

---

## Operator decisions still pending

These are flagged in `WORK_BOARD.md` under `BLOCKED ON OPERATOR`. Do not
guess — leave a `// OPERATOR-INPUT-NEEDED:` comment and proceed with the
documented placeholder behavior.

1. **BATE scoring weights** — file: `docs/BATE_ALGORITHM.md` § "Weights".
2. **Cold-start trust accelerator policy** — file: same doc § "Cold start".
3. **Pricing tier hard gates** — file: `docs/spec/04_COMMERCIAL_STRATEGY.md`.

---

## When in doubt

Read in this order: this file → `docs/ARCHITECTURE.md` → `docs/SECURITY.md`
→ `docs/spec/03_TECHNICAL_SPEC.md` → the Prisma schema.
