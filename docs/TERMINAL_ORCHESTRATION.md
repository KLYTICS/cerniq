---
title: AEGIS Terminal Orchestration
last-reviewed: 2026-05-05
owner: operator (Erwin)
audience: every parallel session — humans, Claudes, contractors
companion-to: AEGIS_MASTER_STATE_2026_05.md (deep ref) · WORK_BOARD.md (claimable units) · SPRINT_PROTOCOL.md (process)
---

# AEGIS — Terminal Orchestration

> The single launchpad for parallel sessions. **Read PART VII of `AEGIS_MASTER_STATE_2026_05.md` for the deep map**; read this for *what to do in the next 60 minutes*. If those two docs disagree, MASTER_STATE wins on intent, this wins on sequencing.

---

## 1. State of play (cold-pickup, 60 seconds)

| Layer | Status |
|---|---|
| Phase 1 GA gates G-1..G-4 | ✅ all closed (audit JWKS, free-tier quota+Stripe, BATE anomaly, webhook subs) |
| Round 15 (today, 2026-05-05) | ✅ landed — plan-aware throttler, API key rotation+24h overlap, audit retention service+CLI, perf benchmark, error catalog with retry semantics |
| Type errors across `@aegis/api` | 0 (fourth consecutive round) |
| Phase 1 GA closure | OD-003 **DECIDED** today via ADR-0014 — only Stripe price IDs in `.env` + 3 small unblocks (KMS install, `@nestjs/schedule`, webhook secret bcrypt) remain |
| Denial precedence | **CHANGED 2026-05-05** — `TRIAL_EXHAUSTED` (HTTP 402) inserted between `SCOPE_NOT_GRANTED` and `SPEND_LIMIT_EXCEEDED` per ADR-0014. CLAUDE.md invariant 6 update pending. |
| Live peer claims | refresh with `peers status` (NOT `peers list` — that's help text) |
| Ship gate | `make preflight` (full) · `make preflight-fast` (no vitest) · `make preflight-prod` (gates on missing prod env) |

**The one path to revenue.** First paying user = developer hits `TRIAL_EXHAUSTED` (HTTP 402, after 10K lifetime free verifies per ADR-0014) → email → `POST /v1/billing/checkout` → Stripe → webhook flips `planTier=DEVELOPER` → next verify clears. The whole pipe is wired. With OD-003 now DECIDED, only Stripe price IDs in `.env` and three small dev-side items separate code-complete from first-$49.

> **Funnel correctness (round 19 fix).** `FREE.monthlyVerifyQuota` is set to `Number.POSITIVE_INFINITY` so the per-plan gate never fires for FREE — `TrialService` is the canonical lifetime gate (10K cap → `TRIAL_EXHAUSTED`). The earlier double-gate at 10K both ways meant FREE customers always hit `PLAN_LIMIT_EXCEEDED` first by precedence, making `TRIAL_EXHAUSTED` unreachable and the funnel diagram below inaccurate. Per peer review F-08; see `apps/api/src/modules/billing/plans.ts:93-106`.

---

## 2. Active peer claims (snapshot — refresh with `peers list --repo aegis`)

> Snapshots go stale within minutes. Always re-check before editing.

| sid | scope | owns (files / paths) | do not touch without `peers msg` |
|---|---|---|---|
| `c4f241c5` | round-16-cream-loaded | `packages/sdk-ts/**` (catalog consumption), `apps/api/src/modules/wellknown/**` (retention well-known), evidence bundle paths under `apps/api/src/modules/compliance/**`, `tools/{audit-evidence-bundle,postman}/`, publish dry-run | sdk-ts, wellknown, compliance evidence bundle, those two `tools/` dirs |
| `cb622ccf` | terminal-orchestration | this file, `tools/preflight/**`, top-level `Makefile` (preflight targets only) | the preflight tool — coordinate before extending |

> `bba1b6c1` (handshake-quickstart) released or TTL-expired since the last refresh. Always re-check via `peers status`.

Off-limits union for new sessions starting now: `apps/api/src/modules/{wellknown,compliance}/**`, `packages/sdk-ts/**`, `tools/{audit-evidence-bundle,postman,preflight}/**`. (Identity / dashboard `/quickstart` may be back open — verify via `peers status` before claiming.)

---

## 3. Terminal → service → file map

> Source of truth: `AEGIS_MASTER_STATE_2026_05.md` PART VII. Below is the *actionable* compression: what to claim, what to install, what to verify. Open peer overlaps are flagged in the **conflicts** column.

| T | name | priority | what ships | primary paths | install / cmd | acceptance | conflicts |
|---|---|---|---|---|---|---|---|
| **G** | KMS SDK install | P0 | KMS adapters compile, encrypted at rest with real provider | `apps/api/package.json` (already declared in `optionalDependencies`); `apps/api/src/modules/kms/**` | `pnpm install` (re-pull optionals) → `pnpm -F @aegis/api typecheck` | 0 tsc errors including `kms.module.ts`; `pnpm jest kms` green | none |
| **H** | `@nestjs/schedule` wiring | P0 | replace round-15's self-arming `setInterval` with framework cron | `apps/api/package.json`, `apps/api/src/app.module.ts`, `apps/api/src/modules/compliance/audit-retention.service.ts` | `pnpm add @nestjs/schedule -F @aegis/api`; add `ScheduleModule.forRoot()` to imports; convert retention to `@Cron(CronExpression.EVERY_DAY_AT_3AM)` | retention runs on cron, not setInterval; `getStatus()` reflects last cron tick; existing 13 tests still green | `app.module.ts` is busiest hotspot — `peers msg` before edit |
| **I** | OpenAPI ↔ Zod parity script | ✅ DONE | `pnpm check:openapi-zod` runs green | `packages/types/scripts/check-openapi-zod-parity.ts` (+ paired `.spec.ts`) | shipped — verified 2026-05-06 per peer review F-10 | CI gates parity on every PR | n/a |
| **F** | ~~Webhook secret bcrypt~~ — **MISDIAGNOSIS, ALREADY HARDENED** | done (round 13) | secret encrypted at rest with **AES-256-GCM** (NOT bcrypt — bcrypt is one-way, would break HMAC signing) | `apps/api/src/common/crypto/webhook-secret-cipher.ts`, `webhooks.service.ts.subscribe()` returns plaintext once + persists ciphertext via `cipher.encrypt(secret)` | already shipped; multi-tenant `deleteMany({ where: { id, principalId } })` already enforces isolation in `unsubscribe()` | n/a — ✅ |
| **A** | Python SDK fill-out | P1 | LangChain/CrewAI/AutoGen unblocked | `packages/sdk-py/aegis/**` | mirror TS surface — note: M-015 says 70 tests already green, audit current gaps before coding | `pip install` from local + LangChain example signs request in 3 lines | none — independent package |
| **B** | MCP bridge transport glue | P1 | the distribution wedge fully operational | `packages/mcp-bridge/src/{index,transport}.ts` | implement MCP SDK 1.0 `Server.setRequestHandler` interception; extract token from transport headers | `wrap(server, config)` rejects untrusted tool calls; passes `{agentId, trustScore, band}` to handlers | none |
| **C** | Dashboard features | P1 | new user completes register→policy→verify in UI without docs | `apps/dashboard/**` | BATE widget (locked-on-FREE pattern), agent list, audit viewer, onboarding wizard tied to `PrincipalOnboarding` | 7-step wizard hits all `hasFirst*` flags | **HEAVY** — peer `bba1b6c1` owns dashboard quickstart; coordinate before any edit |
| **D** | Email lifecycle triggers | P1 | activation + quota-90% + welcome + dunning emails | new `apps/api/src/modules/notifications/**` | BullMQ jobs from billing webhook handlers + Resend or Postmark; OD pending: provider choice | 4 triggers fire end-to-end against test inbox | requires touching `stripe.service.ts` — `peers msg` before edit |
| **E** | Usage monitoring + admin endpoint | P1 | operator sees quota saturation across tenants | `metrics.service.ts` (gauge), new `apps/api/src/modules/admin/**` (or extend `billing.controller.ts`) | `aegis_plan_quota_pct` gauge, `GET /v1/admin/usage`, alert rule `> 90% on FREE` | gauge populated, admin endpoint scoped to FULL key with admin claim | none |

### Out-of-band terminals (not in MASTER_STATE PART VII but live in repo)

| T | name | status | notes |
|---|---|---|---|
| J | CLI (Go single-binary) | active per `packages/cli/` untracked tree | OD-009 (auth model) + OD-010 (binary language) defaults already locked; install scripts under `scripts/install/` |
| K | examples/* (5 verticals scaffolded) | round-12/13 landed acp-bridge, banking-rails, reconciliation; ai-platform-tool-call + saas-seat-provisioning + fintech-payments + acp-bridge dirs all present | OD-011 first-three quickstarts already locked to fintech / mcp-tool-call / saas-seat |
| L | audit-verifier (standalone) | round-13 shipped `packages/audit-verifier/` | independent verification of audit chain without AEGIS API |

---

## 4. The first-paying-user funnel (the only thing that matters this week)

> **Updated 2026-05-05.** OD-003 closed via ADR-0014. Plan tier names changed: Growth → **Team** ($299) + new **Scale** ($1,499). Free trial is **lifetime 10K verifies** (not monthly) returning HTTP 402 with new `TRIAL_EXHAUSTED` denial code.

```
[Operator]                                  [Code]                              [Customer]
─────────                                   ──────                              ─────────
1. ✅ DONE — ADR-0014 locks pricing         ──→ encode tiers in plans.ts
2. Set Stripe price IDs in .env             ──→ STRIPE_PRICE_DEVELOPER, _TEAM, _SCALE
3. (Terminal G) pnpm install KMS SDKs       ──→ tsc 0 errors with KMS
4. (Terminal H) ScheduleModule.forRoot()    ──→ retention on cron
5. ✅ DONE (round 13) — webhook secret AES-GCM encrypted at rest
                                                            ▼
                                ──────────────────→ design partner uses 10K lifetime free trial
                                                            ▼
                                            hits TRIAL_EXHAUSTED (HTTP 402)
                                                            ▼
                                            (Terminal D email trigger fires — P1, not P0; manual outreach OK for first-10)
                                                            ▼
                                            POST /v1/billing/checkout → Stripe → webhook → planTier=DEVELOPER
                                                            ▼
                                                        $49 MRR
```

P0 chain is **5 steps total**. Step 1 (OD-003 pricing) ✅ DONE today. Step 5 (webhook secret-at-rest) ✅ DONE round 13 — was misdiagnosed as "bcrypt" when AES-GCM was already shipped (bcrypt would have broken outgoing HMAC signing — the secret must remain decryptable). Step 2 is the only remaining operator input. Steps 3+4 are in-flight by other peers. Run `make preflight-prod` to gate.

---

## 5. Quality bar — the FAANG checklist (mirror this on every PR)

```
[ ] No `any` without // type-rationale: prefix
[ ] noUncheckedIndexedAccess respected
[ ] Every public service method has a unit test OR // untestable: <reason>
[ ] Errors are AegisError subclasses + registered in error-catalog.ts (round 15)
[ ] Constants in packages/types/src/constants.ts
[ ] No Math.random() in production paths (tests/seeds OK)
[ ] Crypto code has paired .spec.ts — NO exceptions
[ ] No fabricated data, no synthetic trust scores, no fail-open on security gates
[ ] Multi-tenant: principalId is the FIRST argument of every service method
[ ] Verify hot path: zero NestJS/Prisma/ioredis in verify.algorithm.ts (CF Workers portability)
[ ] Audit append: only via audit.service.append()
[ ] New env vars in apps/api/src/config/config.schema.ts
[ ] New modules in apps/api/src/app.module.ts imports array
[ ] Schema changes have migration + backfill + immutability check
[ ] spec-sync CI passes (OpenAPI ↔ Zod ↔ Prisma parity)
[ ] Plan-aware throttle respected on hot endpoints
[ ] Error catalog entry registered (round 15) — `pnpm -F @aegis/scripts audit:errors`
```

Drop one item, the PR review bounces — match operator's bar on FORGE / CerniQ / Apex.

---

## 6. Coordinate-or-touch matrix

Always coordinate (claim + `peers msg`) before any edit:

```
apps/api/prisma/schema.prisma                    everyone's foundation
apps/api/src/modules/verify/algorithm/verify.algorithm.ts   hot path, invariants
packages/types/src/index.ts                      public API contract
apps/api/src/app.module.ts                       module wiring (Terminal H lives here)
CLAUDE.md                                        invariants, never change without operator
WORK_BOARD.md                                    everyone reads this
docs/SESSION_HANDOFF.md                          append-only at top
OPERATOR_DECISIONS.md                            operator-owned register
```

Safe-additive paths (no claim needed beyond declaring scope):

```
examples/<new-vertical>/                         new integrations
tests/cross-package/<new-parity>.spec.ts         new regression guards
docs/<NEW_DOC>.md                                new documentation (this file's path)
tools/<new-utility>/                             new operator tooling
infra/observability/runbooks/<new-runbook>.md    new alert runbooks
```

---

## 7. One-liners every session needs

```bash
# situational awareness
peers status                                                    # ALL active claims (despite the name)
peers digest --since 24h                                        # recent activity
head -120 docs/SESSION_HANDOFF.md                               # what just shipped

# ship-readiness gate (NEW 2026-05-05 — see tools/preflight/README.md)
make preflight-fast                                             # pre-commit subset (~3s)
make preflight                                                  # full run including cross-package vitest
make preflight-prod                                             # gates on missing prod env vars

# claim flow
peers claim aegis <scope> --note "<one line>" --ttl 7200
peers heartbeat                                                 # every 20-30 min
peers msg <sid> "need to touch X for Y"                         # before crossing
peers handoff --summary "..." --next "..." --files a,b,c        # at end of session
peers release aegis:<scope>

# build / test / quality gate
pnpm install                                                    # picks up optionalDeps
pnpm -F @aegis/api typecheck                                    # 0 errors required
pnpm -F @aegis/api test                                         # jest
pnpm vitest run                                                 # cross-package + scripts
pnpm check                                                      # full gate (typecheck+lint+test+spec-sync+migrations)
pnpm bench:verify --concurrency 50 --total 5000                 # perf baseline
pnpm -F @aegis/scripts audit:errors                             # error catalog audit
pnpm -F @aegis/scripts run audit-retention -- --dry-run         # retention dry-run

# safe pre-commit
peers conflict-check || exit 1                                  # composes into pre-commit
```

---

## 8. Operator decisions blocking ship (from `OPERATOR_DECISIONS.md`)

**Critical-path status: clear.** OD-003 closed 2026-05-05 via ADR-0014.

| ID | Decision | Resolution / Default | Status |
|---|---|---|---|
| **OD-003** | Pricing tiers + free trial | ADR-0014: Trial 10K lifetime / Dev $49+50K / Team $299+500K / Scale $1,499+5M / Ent custom · uniform $0.0008/verify overage · NEW `TRIAL_EXHAUSTED` denial code | **DECIDED** |
| OD-001 | BATE scoring weights | rule-based v1 weights in `bate.weights.ts` | open (default shipped) |
| OD-002 | Cold-start trust accelerator | new agents = 500, KYC required >700 | open (default shipped) |
| OD-005 | Webhook delivery max attempts → DLQ | 8 attempts (Stripe parity) | open (default shipped) |
| OD-006 | `/v1/verify` rate-limit FREE | 10 rps + 20 burst — encoded round 15 | open (default shipped) |

Silence past due date = consent for default. With OD-003 closed, the only remaining operator-side gate is **Stripe price IDs in `.env`** (per the ADR's encoding requirements).

**ADR-0014 architectural impact (read before you ship):**
- Plan tier names changed: `GROWTH` → `TEAM` (same $299/500K) + new `SCALE` ($1,499/5M).
- Free trial is now **lifetime cap 10K verifies**, not monthly. `Principal.trialUsed` (or equivalent counter) needs persisting across calendar months.
- New denial code `TRIAL_EXHAUSTED` (HTTP 402) inserted in precedence chain between `SCOPE_NOT_GRANTED` and `SPEND_LIMIT_EXCEEDED`. **CLAUDE.md invariant 6 needs update** to reflect the 10-code chain. Likewise `docs/SECURITY.md` § Denial Precedence and the `DenialReason` enum in `verify.dto.ts` + OpenAPI spec.
- Overage rate uniform $0.0008/verify across paid tiers (160× marginal cost — convenience pricing).
- Companion files: `docs/finance/AEGIS_Financial_Model_v1.xlsx`, `docs/finance/AEGIS_Strategy_Memo_v1.docx`.

---

## 9. What "FAANG-quality out of the box" means here

A new developer hits `git clone && pnpm install && pnpm db:up && pnpm db:migrate && pnpm dev` and gets:

1. A NestJS API on `:4000` with Swagger at `/docs`, all 18 modules wired, 14 Prisma models migrated, BullMQ workers spinning.
2. A Next.js dashboard on `:3000` with the onboarding wizard.
3. Discovery surface live at `/.well-known/aegis-configuration`, `/.well-known/jwks.json`, `/.well-known/audit-signing-key`, `/.well-known/security.txt`, `/.well-known/llms.txt`.
4. A demo seed (`pnpm seed:dev`) creates principal + API key + agent + policy so the first verify call works in 30 seconds.
5. `pnpm check` runs typecheck + lint + jest + vitest + spec-sync + migration immutability — same gate CI enforces, all green.
6. Plan-aware throttling, API key rotation with 24h overlap, audit retention enforced per tier, perf benchmark with exact-rank quantiles, error catalog with retry semantics — all from round 15.
7. Audit chain is independently verifiable via `packages/audit-verifier` (no AEGIS account required to verify a chain).
8. Discovery surface is self-describing: every endpoint, denial enum, trust band ladder, and JWKS published at one URL.

Anything below this bar is a P0 bug. Anything above it is gravy.

---

## 10. The next concrete action (right now)

Pick one and claim it:

| If you have… | Claim |
|---|---|
| 30 min + production safety mind | Terminal **G** — KMS install (`pnpm install` then verify tsc 0) |
| 1 hour + module-wiring caution | Terminal **H** — `@nestjs/schedule` + retention cron |
| 2 hours + crypto eye | Terminal **F** — webhook secret bcrypt + multi-tenant spec |
| Half a day | Terminal **A** Python SDK gaps OR Terminal **D** email triggers |
| A full sprint | Terminal **B** MCP transport glue OR Terminal **C** dashboard features (coordinate with `bba1b6c1`) |

Then: `peers claim`, edit, `pnpm check`, `peers handoff`, `peers release`. Newest entry tops `docs/SESSION_HANDOFF.md`. Round counter advances.

---

*Generated 2026-05-05. Refresh whenever the active-peer table goes stale or a P0 row in §3 closes.*
