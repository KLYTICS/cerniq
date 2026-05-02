# AEGIS Phase 1 Coverage Gaps — Enterprise Review

**Date**: 2026-05-01  
**Review scope**: Apps (api, dashboard), packages (types, sdk-ts, sdk-py), workers (cf-verify)  
**Status**: Phase 1 MVP sprint in progress; multiple modules shipped, gaps flagged below.

---

## 1. Empty Module Directories

| Path | Status | Notes |
|------|--------|-------|
| `apps/api/src/modules/principals/` | **EMPTY** | Listed in WORK_BOARD.md M-003 but contains no files. Functionality absorbed into `identity.module.ts`. |
| `apps/api/src/modules/billing/` | **STUB ONLY** | Only `billing.module.ts` + `plans.spec.ts` (test scaffold); no service/controller implementation. Blocks M-011. |
| `apps/dashboard/app/audit/` | **EMPTY** | Directory created; no page.tsx or components. Placeholder only. |
| `apps/dashboard/app/billing/` | **EMPTY** | Directory created; no page.tsx or components. Placeholder only. |
| `apps/dashboard/app/webhooks/` | **EMPTY** | Directory created; no page.tsx or components. Placeholder only. |
| `packages/sdk-py/` | **PARTIAL** | Full client implementation shipped; no integration tests in `tests/` yet (tests/ directory exists but likely empty). |

**Action**: Remove `principals/` directory (content merged), populate dashboard stub pages or consolidate into single index route.

---

## 2. Controllers Without Test Coverage

| Controller | File | Paired `.spec.ts` | Gap |
|------------|------|-------------------|-----|
| `AuditController` | `audit.controller.ts` | **MISSING** | List + export-ndjson endpoints untested. |
| `HealthController` | `health.controller.ts` | **MISSING** | `/live` and `/ready` endpoints untested. |
| `IdentityController` | `identity.controller.ts` | **MISSING** | Registration + status flow untested at controller layer. |
| `PolicyController` | `policy.controller.ts` | **MISSING** | Create + list + revoke endpoints untested. |
| `VerifyController` | `verify.controller.ts` | **MISSING** | `/v1/verify` hot-path controller untested; unit tests exist for service but not HTTP layer. |
| `BateController` | `bate.controller.ts` | **MISSING** | Trust score endpoints untested. |
| `WellKnownController` | `wellknown.controller.ts` | ✓ Paired | Only controller with full test coverage. |

**Impact**: 6 of 7 controllers lack HTTP-layer tests (auth injection, response formatting, status codes). `verify.controller.ts` is critical path.

---

## 3. Services Without Test Coverage

| Service | File | Paired `.spec.ts` | Gap |
|---------|------|-------------------|-----|
| `AuditService` | `audit.service.ts` | **MISSING** | Append + list + hash-chain logic untested at service layer. |
| `IdentityService` | `identity.service.ts` | **MISSING** | Registration + revocation + challenge-response untested. |
| `PolicyService` | `policy.service.ts` | **MISSING** | Policy creation + JWT signing + revocation untested. |
| `BateService` | `bate.service.ts` | **MISSING** | Anomaly detection + score mutation untested. |
| `WebhooksService` | `webhooks.service.ts` | **MISSING** | Subscription + delivery logic untested. |
| `ApiKeyService` | `api-key.service.ts` | **MISSING** | Hash + validation logic untested (critical for security). |
| **Verify layer** | `verify.service.ts` + `spend-guard.service.ts` | ✓ Paired (both `.spec.ts`) | Full coverage for hot path; algorithm extracted. |

**Impact**: 6 of 8 services lack unit tests. `ApiKeyService` (auth) and `AuditService` (immutability guarantee) are high-risk gaps.

---

## 4. Dead Exports in Type Contracts

### `packages/types/src/schemas.ts`

**Exported but NEVER imported/used elsewhere in repo**:
- `AgentRuntimeSchema` — defined but no grep hits outside this file.
- `TrustBandSchema` — defined but no usage found in API or SDK.
- `SignalSeveritySchema` — no usage in modules/bate or anywhere.
- `ReportEventTypeSchema` — no usage in reporting endpoints.
- `AgentStatusResponseSchema` (partial) — `AgentIdentitySchema` used; this one shadows it.
- Several utility schemas (`AuditDecisionSchema`, `AgentPolicySchema`, etc.) — unclear if used.

**Risk**: Stale contract. Relying parties may implement against these and break silently when server-side changes.

### `packages/types/src/constants.ts`

All constants used:
- `AEGIS_HEADER_*` — injected in Pino redaction + SDK auth.
- `TRUST_BAND_THRESHOLDS` — used in bate scorer.
- `REDIS_KEY` — used in verify + bate modules.
- `WEBHOOK_EVENT` — used in bate service.
- `DENIAL_REASON_PRECEDENCE` — used in verify service.

**Status**: Constants are well-integrated; no dead exports found.

---

## 5. Modules Not Wired to `app.module.ts`

**Checked**: All 9 module files (`audit.module.ts`, `auth.module.ts`, `bate.module.ts`, `health.module.ts`, `identity.module.ts`, `policy.module.ts`, `verify.module.ts`, `webhooks.module.ts`, `wellknown.module.ts`).

**Finding**: All 9 are imported in `app.module.ts` (lines 11–19). No orphaned modules detected.

**However**:
- `PrincipalsModule` is mentioned in WORK_BOARD.md but does NOT exist (directory is empty). If it was meant to be a separate module, it was never created or merged into identity without cleanup.

---

## 6. Lockfile & Install State

| Artifact | Status | Details |
|----------|--------|---------|
| `pnpm-lock.yaml` | **MISSING** | No lockfile in repo root; monorepo is `pnpm workspaces` (declared in `pnpm-workspace.yaml`). |
| `node_modules/` | **NOT FOUND** | Not committed (expected). |
| `packages/sdk-py/.venv/` | **PRESENT** | Python venv exists with ruff, pytest, httpx, cryptography installed. |
| **Before `pnpm dev`** | **MUST RUN** | `pnpm install` (requires either committed lock or a full `pnpm i` run to generate it). |

**Action**: Ensure CI/CD or README documents that `pnpm install` must run before dev server. **Recommend committing `pnpm-lock.yaml`** for reproducible builds.

---

## 7. Prisma Migrations

**Migration directory**: `apps/api/prisma/migrations/`

**Status**: **EMPTY** — no migration files present (e.g., no `*_init.sql`, `*_add_audit.sql`).

**Expected at this stage**:
- Initial schema creation (`001_init`)
- Post-launch incremental migrations

**Current approach**: Schema defined in `schema.prisma` (11k); database state must be bootstrapped via `prisma db push` (dev) or `prisma migrate deploy` (prod, once migrations are tracked).

**Risk**: 
- No version control of schema history.
- Production deployment will require a migration strategy before Phase 1 goes live.

**Action**: Create initial migration: `pnpm exec prisma migrate dev --name init` (generates migration file once schema is final). This should happen before production release.

---

## 8. TODO / FIXME / OPERATOR-INPUT-NEEDED Comments

**Total found**: 1 comment across entire repo.

| File | Line | Text |
|------|------|------|
| `workers/cf-verify/src/index.ts` | ~30 | `// OPERATOR-INPUT-NEEDED: choose token-bucket vs. sliding-window semantics` |

**None found** in:
- `apps/api/src/` (identity, policy, verify, audit, bate, webhooks services)
- `packages/types/src/`
- `packages/sdk-ts/src/`
- `apps/dashboard/`
- `packages/sdk-py/`

**Notes**:
- WORK_BOARD.md flags three operator decisions (M-007, M-018): BATE weights, cold-start policy, pricing tiers. These are **doc-level decisions, not code TODOs**.
- Interim BATE weights in `bate.scorer.ts` are documented as placeholder; no TODO comment needed (already tracked in WORK_BOARD).

---

## Summary of Enterprise Review Blockers

| Priority | Category | Count | Details |
|----------|----------|-------|---------|
| **CRITICAL** | Missing service tests | 6 | `audit`, `identity`, `policy`, `bate`, `webhooks`, `api-key` services untested. |
| **CRITICAL** | Missing controller tests | 6 | Same modules + `health` lack HTTP-layer coverage. |
| **HIGH** | Empty directories | 6 | `principals/` should be removed; dashboard stubs need content or consolidation. |
| **HIGH** | Stale type exports | 6+ | Schemas defined but unused; contracts unclear. |
| **MEDIUM** | No Prisma migrations | — | Schema not version-controlled; production deployment risky. |
| **MEDIUM** | No pnpm-lock.yaml | — | Reproducible builds not guaranteed. |
| **LOW** | OPERATOR-INPUT-NEEDED | 1 | Already tracked in WORK_BOARD; not a code gap. |

---

## Recommendations Before Phase 1 Production Gate

1. **Immediate** (next 2 sessions):
   - Add `.spec.ts` for the 6 untested services (prioritize: `AuditService`, `ApiKeyService`, `VerifyController`).
   - Clean up `principals/` directory (delete if merged into identity).
   - Populate or consolidate dashboard stubs.

2. **Before production**:
   - Run `pnpm exec prisma migrate dev --name init` to generate initial migration.
   - Commit `pnpm-lock.yaml` to repo.
   - Audit `packages/types/src/schemas.ts` — remove or document stale exports.

3. **Phase 1 gate checklist**:
   - [ ] 6 untested services → 90%+ coverage.
   - [ ] 6 untested controllers → 80%+ coverage (HTTP layer).
   - [ ] Prisma migrations tracked.
   - [ ] `pnpm-lock.yaml` committed.
   - [ ] `principals/` directory deleted or explained.
