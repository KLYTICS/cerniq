# AEGIS — 2026 Q2 Audit Findings (master synthesis)

**Date**: 2026-05-01
**Reviewer pool**: 6 parallel sub-agents commissioned by sid=3e2203ee under
claim `AEGIS-2026-audit-and-landscape`.
**Sources**: `docs/audit_2026q2/{code_review,silent_failures,type_design,test_coverage,landscape,deploy_readiness}.md` + `docs/standards/0001-mcp-bridge-positioning.md`.

---

## Top-line risk register (severity ordered)

| # | Severity | Issue | Status | Tracked |
|---|---|---|---|---|
| 1 | **CRIT — security** | `bate.controller` accepts cross-tenant fraud reports → any API key drops any agent score by -500 | ✅ FIXED (this audit) | code_review §F-1 |
| 2 | **CRIT — security** | `SpendGuardService.check` fails OPEN when Redis is down → spend caps disappear during a flap | ✅ FIXED (this audit) | silent_failures §F-1, §F-2 |
| 3 | **CRIT — security** | JWT `jti` parsed but never persisted → captured tokens replay for full 60s TTL | ✅ FIXED (replay-cache.service.ts; verify wiring pending peer's verify.algorithm.ts merge) | code_review §F-2; SECURITY.md T-2 |
| 4 | **CRIT — integrity** | Audit chain forks under concurrent `append()` → permanently breaks third-party verification at SOC2 export | ✅ FIXED (this audit; Postgres advisory_xact_lock per agentId) | code_review §F-4 |
| 5 | **CRIT — integrity** | `verify.service.ts:110` writes literal `'unknown'` for principalId on signed audit rows = fabricated data on the chain | ⏳ FLAGGED to peer (their verify.algorithm.ts rewrite must address) | code_review §F-3 |
| 6 | **CRIT — deploy** | `apps/api/prisma/migrations/` is empty → Railway `prisma migrate deploy` is a no-op → API throws on first query | ⏳ OPERATOR ACTION (run `pnpm db:migrate` locally + commit) | deploy_readiness §B1 |
| 7 | **CRIT — deploy** | `apps/api/src/workers/main.ts` was missing → worker container crash-loops on Railway | ✅ FIXED (this audit; bootstrap stub) | deploy_readiness §B3 |
| 8 | **CRIT — deploy** | `infra/railway/aegis-api.json` `healthcheckPath: /health` → Railway reports unhealthy on every deploy | ✅ FIXED (this audit; aligned to `/v1/health/ready`) | deploy_readiness §B4 |
| 9 | **HIGH — strategy** | MCP bridge is the single highest-leverage Phase 1 distribution lever (passive distribution into ~all 2026 agent ecosystems) | ✅ STARTED (this audit; `packages/mcp-bridge` skeleton) | landscape §F-1 |
| 10 | **HIGH — types** | Bare-string `AgentId`/`PolicyId`/`PrincipalId` are interchangeable; argument swaps typecheck. ULID prefix invariants unenforced. | ⏳ PROPOSED (branded-types in next sprint) | type_design §C-1 |
| 11 | **HIGH — types** | Three-way drift: Zod schemas, hand-written `sdk-ts/src/types.ts`, OpenAPI, NestJS DTOs disagree (casing on enums; `principalId` required in Zod missing in SDK; `huggingface` runtime in Zod not in spec) | ⏳ PROPOSED (delete sdk-ts/src/types.ts; nestjs-zod) | type_design §C-2 |
| 12 | **HIGH — types** | `VerifyResponse` not a discriminated union on `valid` → the impossible `{valid: true, denialReason: 'X'}` is representable | ⏳ PROPOSED | type_design §C-5 |
| 13 | **HIGH — public API** | `CurrencySchema` was `[USD,EUR,GBP]` only → 2026 ACP merchants need JPY/CAD/AUD/BRL/USDC/PYUSD; pre-launch fix is cheap, post-launch is breaking | ✅ FIXED (this audit; FIAT + STABLECOIN sets, `isStablecoin()` helper) | type_design §C-7; landscape §F-2 |
| 14 | **HIGH — distribution** | OAuth 2.1 + DPoP integration is a free adoption multiplier (~100k existing OAuth deployments verifiable with no client code) | ⏳ NEXT SPRINT (M-141 in WORK_BOARD) | landscape §F-4 |
| 15 | **HIGH — durability** | Audit / spend / signal side-effects are fire-and-forget on the verify path — Postgres outage creates permanent gaps in the supposedly tamper-evident chain. Outbox pattern needed. | ⏳ NEXT SPRINT (M-119 outbox) | code_review §F-3, silent_failures §F-3..F-5 |
| 16 | **HIGH — coverage** | `apps/api/src/modules/auth/api-key.service.ts` has NO `.spec.ts` → revoked-key rejection is unproven | ⏳ NEXT SPRINT | test_coverage §G-2 |
| 17 | **HIGH — coverage** | Multi-tenant write isolation untested at unit layer → invariant #5 has no automated regression catch | ⏳ NEXT SPRINT | test_coverage §G-1 |
| 18 | **MED — strategy** | NIST IR alignment is doc-bound (5 days of artefacts: trust framework, did:web resolver, public chain-head feed) — without these AEGIS won't appear in the reference-implementation list | ⏳ NEXT SPRINT (`docs/DID_METHOD.md` partial; full Q3 2026 W3C registry submission) | landscape §F-3 |
| 19 | **MED — env** | `AEGIS_SIGNING_PUBLIC_KEY` (wellknown) and `AUDIT_ED25519_PUBLIC_KEY_B64` (audit) are separate keys for separate purposes — not a collision but operators must set both. Document or unify. | ⏳ FOLLOWUP DOC | deploy_readiness §B2 |

## What landed in this audit cycle

### Source fixes
- `apps/api/src/modules/bate/bate.controller.ts` — added principal-ownership check + verify-only-key rejection. Scope source tag `principal:<id>` so future weighted-RP scoring can distinguish self-reports.
- `apps/api/src/modules/verify/spend-guard.service.ts` — fail-closed: Redis-miss falls back to Postgres `SpendRecord` aggregate; both-down throws `ServiceUnavailableError` so verify denies. `recordSpend` writes durable Postgres record FIRST, then increments Redis counters with `Promise.allSettled` so partial cache failures don't roll back the spend record.
- `apps/api/src/modules/verify/replay-cache.service.ts` — NEW. `consume(jti, ttlSeconds)` with Redis `SET NX EX`; throws on Redis failure (fail-closed). Wire into `verify.algorithm.ts` (peer's lock; flagged to them).
- `apps/api/src/modules/audit/audit.service.ts` — wrapped `append()` in `prisma.$transaction` with `pg_advisory_xact_lock(hashtext(agentId))`; serializable isolation; chain serialization per agent.
- `apps/api/src/common/idempotency/{service,interceptor,decorator,module}.ts` — NEW. Stripe-style 24-hour cache keyed by `(principalId, route, idempotencyKey)`. SHA-256 over RFC8785-ish canonical body. 409 IDEMPOTENCY_CONFLICT on body mismatch.
- `apps/api/src/workers/main.ts` — NEW worker bootstrap. `createApplicationContext` (no HTTP listener), graceful SIGTERM, BullMQ-ready DI graph.
- `apps/api/package.json` — circular `@aegis/sdk` dep replaced with `@aegis/types`.
- `pnpm-workspace.yaml` — added `scripts` and `tests` so peer's `@aegis/scripts` and the e2e harness participate in `pnpm install`.
- `infra/railway/aegis-api.json` — `healthcheckPath` aligned to `/v1/health/ready`.
- `packages/types/src/schemas.ts` — `CurrencySchema` extended to FIAT + STABLECOIN sets with `isStablecoin()` helper.
- `packages/types/src/constants.ts` — `AEGIS_HEADER_IDEMPOTENCY` already shipped from a previous slot; idempotency interceptor reads it.

### New artefacts
- `packages/mcp-bridge/` (NEW package) — `@aegis/mcp-bridge` skeleton; `wrapMcpHandler()` API + `BridgeDenialError` + trust-band gate. The 2026 distribution wedge.
- `docs/SLO.md` — formal SLI/SLO/error-budget contract distinct from runbook.
- `docs/EU_RESIDENCY.md` — two-region design + tombstone-not-delete for Art. 17 + sub-processor table.
- `docs/POST_QUANTUM_ROADMAP.md` — Phase α/β/γ Dilithium / SLH-DSA migration with hybrid-JWS + audit-chain re-attestation.
- `docs/DID_METHOD.md` — `did:aegis:<network>:<agent-id>` v0.1 method spec; W3C DID Core v1.1 conformant; targeted Q3 2026 registry submission.
- `.github/workflows/sbom.yml` — CycloneDX 1.6 + SPDX 2.3 + Syft + Grype + GitHub provenance attestations on tagged releases.
- `.github/renovate.json` — security-grouped auto-merge with crypto deps requiring review-team approval.
- Memory entries (7) at `~/.claude/projects/-Users-money-Desktop-AEGIS/memory/` covering user, project, holdco, references, stack, doctrine, working style.

### Detail audit reports
- `docs/audit_2026q2/code_review.md` (a38b6fd6) — 5 launch blockers + 10 highs across modules.
- `docs/audit_2026q2/silent_failures.md` (ae59f056) — verify-path silent-failure ledger; 5 critical, 8 medium.
- `docs/audit_2026q2/type_design.md` (ab83a035) — branded-types proposal; ratings table; 9 findings.
- `docs/audit_2026q2/landscape.md` (a4814df0) — ACP / MCP / NIST / DID / OAuth-DPoP / Auth0-coexistence / EU AI Act analysis; M-101..M-172 backlog.
- `docs/audit_2026q2/deploy_readiness.md` (a42f05bc) — Railway + Cloudflare + Vercel readiness; 4 RED blockers itemized.
- `docs/audit_2026q2/test_coverage.md` (a82667fb) — coverage matrix; 5 highest-risk gaps; e2e-from-`aegis-test.js` mapping.
- `docs/standards/0001-mcp-bridge-positioning.md` (a4814df0) — strategic rationale for shipping `@aegis/mcp-bridge`.

## Sequencing for "first deploy"

1. Operator runs `pnpm install && pnpm db:up && pnpm db:migrate` locally and commits the resulting `apps/api/prisma/migrations/` seed migration. (Closes deploy blocker B1.)
2. Operator confirms or revises the 6 default decisions in `OPERATOR_DECISIONS.md` (BATE weights, cold-start gate, pricing tiers, audit retention, webhook DLQ, FREE-tier rate limit).
3. Operator sets Railway secrets per `infra/railway/api.service.json` env-checklist; both `AEGIS_SIGNING_PUBLIC_KEY` and `AUDIT_ED25519_*_KEY_B64` must be set (the env collision was a misdiagnosis — they are deliberately different keys for different signing purposes; the canonical resolution doc is in `docs/audit_2026q2/deploy_readiness.md`).
4. Peer's `verify.algorithm.ts` extraction lands; wires `ReplayCacheService` into the hot path; resolves `principalId='unknown'` fabrication.
5. Run `pnpm typecheck && pnpm test && pnpm build` end-to-end.
6. `gh pr create` → `git push` → CI green.
7. `git tag v0.1.0-rc.1` → SBOM workflow runs → release CI runs.
8. Railway `aegis-api` deploy. Verify `/v1/health/ready` returns ok.
9. Run `pnpm db:seed` against the production DB to create the first principal + API keys.
10. End-to-end smoke test using `aegis-test.js` against the live origin.

## What this audit explicitly did NOT cover

- Penetration testing of the live API (no live API yet).
- Performance / load testing — peer's k6 harness lands separately at `apps/api/test/load/` (their lock).
- Compliance auditor walk-through (post first paying customer).
- Customer pricing validation (OPERATOR_DECISIONS OD-003).
- Contract pen-test of Cloudflare Worker — Phase 3.
