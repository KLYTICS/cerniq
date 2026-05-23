---
title: CERNIQ — Compliance Control Map
scope: apps/api (NestJS management + verify surface), packages/types, packages/sdk-ts, packages/sdk-py, packages/verifier-rp, workers/cf-verify (stub), infra/{docker,postgres,redis,railway,cloudflare,observability,backup}, .github/workflows, scripts
audit-cadence: quarterly
owner: operator (Erwin)
last-reviewed: 2026-05-01
---

# CERNIQ — Compliance

This document maps CERNIQ's **current** implementation to the frameworks an
auditor or customer security team is most likely to ask about. It is the
single source customer-facing security questions resolve to.

> **Disclaimer.** This is honest evidence, not aspiration. A row marked
> `GAP` means the control is not implemented today — citing a `GAP` row in
> a customer questionnaire as `MET` is a fireable offence here. A row
> marked `PARTIAL` means the technical mechanism exists but a process,
> SLA, or operational artefact around it is missing. `MET` rows cite a
> file path that any reader can open and verify.
>
> CERNIQ has not yet been audited by a third party. SOC 2 Type II is the
> target post first paying customer (see § 6 and OD-004). Anything in
> this document is an internal self-assessment until that audit completes.

---

## 1. Scope

### In-scope components

| Component                | Path                                                                                             | Compliance role                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Management API           | `apps/api/src/`                                                                                  | Identity CRUD, policy issuance, audit, billing — full TSC surface |
| Verify hot path          | `apps/api/src/modules/verify/`                                                                   | Latency-budgeted authorisation decisions (CC6.1, CC7.x)           |
| Audit chain              | `apps/api/src/common/crypto/audit-chain.util.ts` + `apps/api/src/modules/audit/audit.service.ts` | Tamper-evident evidence (CC4.1, CC7.2, CC7.3)                     |
| Public verifier endpoint | `apps/api/src/modules/wellknown/`                                                                | Third-party signature verification (CC4.1)                        |
| Crypto utilities         | `apps/api/src/common/crypto/`                                                                    | Ed25519 + JWT + chain primitives (CC6.7, CC6.8)                   |
| API key auth             | `apps/api/src/modules/auth/api-key.guard.ts`, `api-key.service.ts`                               | Logical access control (CC6.1)                                    |
| Schema + retention       | `apps/api/prisma/schema.prisma`                                                                  | Data classification + retention (C1.1, C1.2)                      |
| Postgres baseline        | `infra/postgres/init.sql`                                                                        | Database least privilege, extensions (CC6.3)                      |
| Redis hardening          | `infra/redis/redis.conf`                                                                         | Cache integrity, command lockdown (CC6.6, CC6.8)                  |
| Container baseline       | `infra/docker/Dockerfile.api`, `Dockerfile.worker`                                               | Distroless nonroot runtime (CC6.6)                                |
| Security CI              | `.github/workflows/security.yml`                                                                 | SAST, SCA, secrets, SBOM, license (CC8.1, CC7.1)                  |
| Build CI                 | `.github/workflows/ci.yml`                                                                       | Lint, typecheck, test, build (CC8.1)                              |
| Secret hygiene           | `.husky/pre-commit`, `.github/gitleaks.toml`                                                     | Pre-commit secret block (CC6.1)                                   |
| ADRs                     | `docs/decisions/`                                                                                | Change-management rationale (CC8.1)                               |

### Out of scope

- Customer agent code, customer-side private keys, customer infrastructure
  (CLAUDE.md invariant #1: CERNIQ holds public keys only).
- Personnel security, HR onboarding/offboarding, physical security — solo
  founder today; controls scale with first hire (see § 6).
- Phase 3 Cloudflare Worker production deployment (`workers/cf-verify/` is
  a forward-only stub; production code path stays on Railway until M-013
  unlocks).

---

## 2. Frameworks covered

| Framework                 | Version                         | Coverage in this doc                                                   |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| SOC 2 Type II             | TSC 2017 + 2022 Points of Focus | § 3.1 — all five categories                                            |
| ISO/IEC 27001             | 2022 (Annex A, 93 controls)     | § 3.2 — technological themes; Org/People/Physical out-of-scope flagged |
| OWASP API Security Top 10 | 2023                            | § 3.3 — all 10                                                         |
| NIST CSF                  | 2.0 (2024)                      | § 3.4 — six functions; PROTECT + DETECT at sub-category                |
| NIST SP 800-53            | Rev. 5                          | § 3.5 — selected SC, AU, IA, AC families                               |

---

## 3. Control mappings

Status legend: `MET` (implemented + cited), `PARTIAL` (mechanism exists,
process or SLA missing), `GAP` (not implemented), `NA` (intentionally
out of scope, with reason).

### 3.1 SOC 2 Type II

#### Common Criteria — Control Environment (CC1.x)

| Control | Name                                                  | CERNIQ implementation                                                                                                         | Evidence source                                                   | Status                                                  |
| ------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| CC1.1   | Demonstrates commitment to integrity & ethical values | Architecture invariants encode integrity (no fabricated data, signed audit chain). Operator-facing directive is the contract. | `CLAUDE.md` (invariants 1–6)                                      | MET                                                     |
| CC1.2   | Board / oversight independence                        | Solo founder; no board.                                                                                                       | —                                                                 | NA — solo entity; revisit when first hire or board seat |
| CC1.3   | Establishes structures, reporting lines               | Single operator; module ownership tracked by claim.                                                                           | `WORK_BOARD.md`, `docs/SESSION_HANDOFF.md`                        | PARTIAL — formal org chart deferred to first hire       |
| CC1.4   | Demonstrates commitment to competence                 | Quality bar codified (no `any`, paired specs for crypto, FAANG checklist).                                                    | `CLAUDE.md` § "Quality bar"; `docs/CONTRIBUTING.md`               | MET                                                     |
| CC1.5   | Holds individuals accountable                         | Commit hooks block secrets; PR template includes threat-model checklist.                                                      | `.husky/pre-commit`, `.husky/commit-msg`, `commitlint.config.cjs` | MET                                                     |

#### Common Criteria — Communication (CC2.x)

| Control | Name                                     | CERNIQ implementation                                                     | Evidence source                                                                                    | Status                                                                |
| ------- | ---------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| CC2.1   | Obtains / generates relevant information | Audit chain captures every authorisation decision with full context.      | `apps/api/src/modules/audit/audit.service.ts:75`, `apps/api/prisma/schema.prisma:185` (AuditEvent) | MET                                                                   |
| CC2.2   | Internal communication of objectives     | Living docs: ARCHITECTURE, SECURITY, THREAT_MODEL, SESSION_HANDOFF.       | `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/SESSION_HANDOFF.md`                              | MET                                                                   |
| CC2.3   | External communication                   | Public spec + `/.well-known/audit-signing-key` for third-party verifiers. | `apps/api/src/modules/wellknown/wellknown.service.ts`                                              | PARTIAL — public docs site (`docs.cerniqapp.com`) not yet live; M-014 |

#### Common Criteria — Risk Assessment (CC3.x)

| Control | Name                                | CERNIQ implementation                                                                           | Evidence source                                                                                                                                                                                                                                  | Status |
| ------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| CC3.1   | Specifies suitable objectives       | Latency, denial-precedence, retention, audit integrity all stated as numeric / ordered targets. | `docs/ARCHITECTURE.md:60` (latency budgets), `docs/SECURITY.md:108` (denial precedence), `docs/SLO.md`                                                                                                                                           | MET    |
| CC3.2   | Identifies and analyses risk        | STRIDE threat catalog, 31 threats.                                                              | `docs/THREAT_MODEL.md`, `docs/THREAT_MODEL_v2.md`                                                                                                                                                                                                | MET    |
| CC3.3   | Considers potential for fraud       | BATE module is the explicit fraud-signal pipeline.                                              | `apps/api/src/modules/bate/bate.scorer.ts`, `bate.weights.ts`                                                                                                                                                                                    | MET    |
| CC3.4   | Identifies & assesses change impact | ADR series + change-management workflow.                                                        | `docs/decisions/0001-cuid-vs-ulid.md`, `docs/decisions/0002-ed25519-only-crypto.md`, `docs/decisions/0003-portable-verify-path.md`, `docs/decisions/0004-denial-precedence-public-api.md`, `docs/decisions/0005-audit-chain-canonicalization.md` | MET    |

#### Common Criteria — Monitoring (CC4.x)

| Control | Name                                                       | CERNIQ implementation                                                      | Evidence source                                                                                                                      | Status                                           |
| ------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| CC4.1   | Selects, develops, performs ongoing & separate evaluations | Append-only audit log + chain verifier published; security CI weekly cron. | `apps/api/src/common/crypto/audit-chain.util.ts:86` (sign), `:98` (verify); `.github/workflows/security.yml:21` (Mon 06:00 UTC cron) | MET                                              |
| CC4.2   | Communicates deficiencies                                  | SESSION_HANDOFF flags critical findings (e.g. A-001/A-019/A-002).          | `docs/SESSION_HANDOFF.md:20`                                                                                                         | PARTIAL — no formal incident-tracker integration |

#### Common Criteria — Control Activities (CC5.x)

| Control | Name                                   | CERNIQ implementation                                                | Evidence source                                                                                              | Status |
| ------- | -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| CC5.1   | Selects & develops control activities  | Six architecture invariants + denial-precedence are non-negotiable.  | `CLAUDE.md` § "Architecture invariants"                                                                      | MET    |
| CC5.2   | Selects & develops technology controls | Helmet, CORS allow-list, API-key guard, throttler, gitleaks, trivy.  | `apps/api/src/main.ts:21`, `apps/api/src/modules/auth/api-key.guard.ts:19`, `.github/workflows/security.yml` | MET    |
| CC5.3   | Deploys through policies & procedures  | RUNBOOK + CONTRIBUTING + commit conventions enforced via commitlint. | `docs/RUNBOOK.md`, `docs/CONTRIBUTING.md`, `commitlint.config.cjs`                                           | MET    |

#### Common Criteria — Logical Access (CC6.x)

| Control | Name                                            | CERNIQ implementation                                                                                       | Evidence source                                                                                  | Status                            |
| ------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| CC6.1   | Implements logical access security              | API-key required on every non-public route; bcrypt cost 12; prefix-narrowed constant-time match.            | `apps/api/src/modules/auth/api-key.guard.ts:19`, `api-key.service.ts:38`, `:54`                  | MET                               |
| CC6.2   | Provisions / removes credentials                | Issue + revoke surfaces; `lastUsedAt` tracked; `revokedAt` zeroes future auth.                              | `api-key.service.ts:28`, `apps/api/prisma/schema.prisma:46` (`revokedAt`)                        | MET                               |
| CC6.3   | Manages access rights via least privilege       | Two key scopes (`FULL`, `VERIFY_ONLY`); two DB roles (`cerniq_app` DML, `cerniq_readonly` SELECT-only).     | `apps/api/prisma/schema.prisma:60` (ApiKeyScope), `infra/postgres/init.sql:86` (role separation) | MET                               |
| CC6.4   | Restricts physical access                       | Hosting outsourced to Railway / Cloudflare. See § 5 subprocessors.                                          | —                                                                                                | NA — inherited from subprocessors |
| CC6.5   | Logical & physical removal of media             | Distroless container, no persistent local disk for compute. Postgres / Redis on managed plugins.            | `infra/docker/Dockerfile.api:82`                                                                 | MET                               |
| CC6.6   | Implements boundary protections                 | Helmet, CORS allow-list, `protected-mode yes` on Redis, `requirepass`, no public ingress to Postgres/Redis. | `apps/api/src/main.ts:21`, `infra/redis/redis.conf:26`, `:44`                                    | MET                               |
| CC6.7   | Restricts data movement / encryption in transit | TLS 1.3 (Cloudflare/Railway termination); EdDSA-signed JWTs for policy tokens.                              | `docs/SECURITY.md:32`, `apps/api/src/common/crypto/jwt.util.ts`                                  | MET                               |
| CC6.8   | Prevents/detects malicious software             | gitleaks pre-commit + CI; trivy filesystem scan; CodeQL; semgrep; OSV-scanner; pnpm-audit.                  | `.github/workflows/security.yml:41`, `:71`, `:90`, `:117`, `:149`, `:253`, `.husky/pre-commit`   | MET                               |

#### Common Criteria — System Operations (CC7.x)

| Control | Name                                              | CERNIQ implementation                                                                   | Evidence source                                                                                                            | Status                                  |
| ------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| CC7.1   | Detects / monitors configuration changes          | Prometheus metrics, slow-query log (250 ms), Redis slowlog (10 ms), pg_stat_statements. | `apps/api/src/common/observability/metrics.service.ts`, `infra/postgres/init.sql:62`, `infra/redis/redis.conf:139`         | MET                                     |
| CC7.2   | Monitors components for anomalies                 | BATE anomaly signals + audit append on every decision; `latency-monitor-threshold 100`. | `apps/api/src/modules/bate/bate.scorer.ts`, `apps/api/src/modules/audit/audit.service.ts:75`, `infra/redis/redis.conf:145` | MET                                     |
| CC7.3   | Evaluates security events                         | Tamper-evident chain — any verifier can detect a break.                                 | `apps/api/src/common/crypto/audit-chain.util.ts:98`, `docs/SECURITY.md:144`                                                | MET                                     |
| CC7.4   | Responds to identified events (incident response) | RUNBOOK exists; tabletop pending.                                                       | `docs/RUNBOOK.md`                                                                                                          | PARTIAL — no rehearsed IR drill         |
| CC7.5   | Recovers from incidents                           | DR runbook + Postgres AOF + RDB.                                                        | `infra/redis/redis.conf:77`, `infra/backup/`                                                                               | PARTIAL — DR tabletop not run (see § 6) |

#### Common Criteria — Change Management (CC8.1)

| Control | Name                                                                        | CERNIQ implementation                                                                                                        | Evidence source                                                                                  | Status |
| ------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ |
| CC8.1   | Authorises, designs, develops, configures, tests, approves, deploys changes | CI gates (lint, typecheck, unit, e2e, build); ADR-driven decisions; commitlint; conventional commits; spec-sync drift check. | `.github/workflows/ci.yml`, `scripts/verify-spec.ts`, `commitlint.config.cjs`, `docs/decisions/` | MET    |

#### Common Criteria — Risk Mitigation (CC9.x)

| Control | Name                                                     | CERNIQ implementation                      | Evidence source                                                   | Status                       |
| ------- | -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- | ---------------------------- |
| CC9.1   | Identifies, selects, develops risk-mitigation activities | Threat model maps to mitigations + status. | `docs/THREAT_MODEL.md` (catalog), `docs/THREAT_MODEL_v2.md` § 4–8 | MET                          |
| CC9.2   | Manages vendor / business-partner risk                   | Subprocessor list maintained (§ 5).        | This file § 5                                                     | PARTIAL — no signed DPAs yet |

#### Availability (A1.x)

| Control | Name                                          | CERNIQ implementation                                                                          | Evidence source                                                                                          | Status                                                     |
| ------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A1.1    | Maintains capacity for objectives             | Latency budgets (200 ms P1, 80 ms P3); Prometheus histograms; load test scaffold (autocannon). | `docs/ARCHITECTURE.md:60`, `apps/api/src/common/observability/metrics.service.ts`, `apps/api/test/load/` | PARTIAL — soak test not run, capacity model not formalised |
| A1.2    | Implements environmental protections, backups | Redis AOF + RDB; Postgres managed by Railway plugin.                                           | `infra/redis/redis.conf:77`, `infra/backup/`                                                             | PARTIAL — automated backup-restore drill outstanding       |
| A1.3    | Tests recovery                                | DR runbook stub.                                                                               | `docs/RUNBOOK.md`, `infra/backup/`                                                                       | GAP — never tested end-to-end                              |

#### Confidentiality (C1.x)

| Control | Name                                     | CERNIQ implementation                                            | Evidence source                                                                          | Status                                                                                     |
| ------- | ---------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| C1.1    | Identifies & maintains confidential info | See § 4 data classification.                                     | This file § 4, `apps/api/prisma/schema.prisma`                                           | MET                                                                                        |
| C1.2    | Disposes of confidential info            | Cascade deletes on Principal removal; audit retained per OD-004. | `apps/api/prisma/schema.prisma:43` (`onDelete: Cascade`), `OPERATOR_DECISIONS.md` OD-004 | PARTIAL — automated retention purge (7-year cutoff) not wired; A-019 schema rework pending |

#### Processing Integrity (PI1.x)

| Control | Name                                           | CERNIQ implementation                                                                                           | Evidence source                                                                                                                                                                     | Status |
| ------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| PI1.1   | Definitions of processing requirements         | Zod schemas as the API contract.                                                                                | `packages/types/src/schemas.ts`                                                                                                                                                     | MET    |
| PI1.2   | Inputs are complete, accurate, valid           | NestJS global ValidationPipe + Zod-validated env.                                                               | `apps/api/src/main.ts`, `apps/api/src/config/config.schema.ts`                                                                                                                      | MET    |
| PI1.3   | Processing produces accurate, complete outputs | Pure verify algorithm with paired spec; spend counters atomic via Redis INCRBY (algorithm extracted M-005 ext). | `apps/api/src/modules/verify/algorithm/verify.algorithm.ts`, `apps/api/src/modules/verify/algorithm/verify.algorithm.spec.ts`, `apps/api/src/modules/verify/spend-guard.service.ts` | MET    |
| PI1.4   | Output delivery / retention                    | NDJSON streaming export for audit, signed and chained.                                                          | `apps/api/src/modules/audit/audit.service.ts:190`                                                                                                                                   | MET    |
| PI1.5   | Stores items completely & accurately           | Append-only `AuditEvent` (no `UPDATE`/`DELETE` ever — CLAUDE.md invariant #3).                                  | `CLAUDE.md` invariant 3, `apps/api/prisma/schema.prisma:185`                                                                                                                        | MET    |

#### Privacy (P1–P8)

| Control   | Name                                                                       | CERNIQ implementation                                                                      | Evidence source                    | Status                                                                                             |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| P1.x–P8.x | Notice, choice, collection, use, retention, access, disclosure, monitoring | We collect Principal email + (optional) name only; no end-user PII; no marketing tracking. | `apps/api/prisma/schema.prisma:17` | PARTIAL — public privacy notice not yet drafted; GDPR Art 17 erasure relies on A-019 schema rework |

---

### 3.2 ISO/IEC 27001:2022 — Annex A (technological controls focus)

We map only the technological clauses where CERNIQ has direct overlap.
Organisational (5.x), People (6.x), and Physical (7.x) clauses are
out-of-scope for this technical doc — they live under operator HR/legal
once the company has employees beyond a single founder.

| Control | Name                                                   | CERNIQ implementation                                                                                   | Evidence source                                                                                                                                     | Status                                                       |
| ------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 8.2     | Privileged access rights                               | Two API-key scopes (`FULL`, `VERIFY_ONLY`) + two DB roles (`cerniq_app` DML, `cerniq_readonly` SELECT). | `apps/api/src/modules/auth/api-key.service.ts:33`, `infra/postgres/init.sql:86`                                                                     | MET                                                          |
| 8.3     | Information access restriction                         | Multi-tenant isolation by `principalId` on every query (CLAUDE.md invariant #5).                        | `CLAUDE.md` invariant 5, `apps/api/src/modules/audit/audit.service.ts:139`                                                                          | MET                                                          |
| 8.5     | Secure authentication                                  | bcrypt cost 12 with constant-time compare; prefix-narrowed lookup; never plaintext-logged.              | `apps/api/src/modules/auth/api-key.service.ts:38`, `:66`; `apps/api/src/app.module.ts:37` (Pino redact)                                             | MET                                                          |
| 8.6     | Capacity management                                    | Throttler config; Redis maxmemory cap; latency monitoring.                                              | `infra/redis/redis.conf:57`, `apps/api/src/modules/verify/verify.module.ts`                                                                         | PARTIAL — formal capacity model deferred                     |
| 8.8     | Management of technical vulnerabilities                | Weekly OSV-scanner + trivy + pnpm-audit cron.                                                           | `.github/workflows/security.yml:21`, `:71`, `:117`                                                                                                  | PARTIAL — fix-SLA not codified (see § 6)                     |
| 8.9     | Configuration management                               | Distroless image, pinned digests, `--frozen-lockfile`.                                                  | `infra/docker/Dockerfile.api:25`, `:62`                                                                                                             | MET                                                          |
| 8.10    | Information deletion                                   | Cascade deletes on `Principal`; planned audit retention purge per OD-004.                               | `apps/api/prisma/schema.prisma:43`                                                                                                                  | PARTIAL — automated purge not wired                          |
| 8.11    | Data masking                                           | Pino redaction for header tokens.                                                                       | `apps/api/src/app.module.ts:37`                                                                                                                     | PARTIAL — DB-level masking N/A (we hold no PII beyond email) |
| 8.12    | Data leakage prevention                                | gitleaks (pre-commit + CI), license allow-list.                                                         | `.husky/pre-commit`, `.github/gitleaks.toml`, `.github/workflows/security.yml:41`, `:177`                                                           | MET                                                          |
| 8.13    | Information backup                                     | Redis AOF (everysec) + RDB; `infra/backup/` directory for Postgres baseline.                            | `infra/redis/redis.conf:77`, `infra/backup/`                                                                                                        | PARTIAL — restore drill outstanding                          |
| 8.15    | Logging                                                | Pino JSON logs; pg_stat_statements; Redis slowlog; Prometheus.                                          | `apps/api/src/app.module.ts:30`, `infra/postgres/init.sql:49`, `infra/redis/redis.conf:139`, `apps/api/src/common/observability/metrics.service.ts` | MET                                                          |
| 8.16    | Monitoring activities                                  | Audit append on every authorisation decision; metrics on every verify.                                  | `apps/api/src/modules/audit/audit.service.ts:75`, `apps/api/src/modules/verify/verify.service.ts`                                                   | MET                                                          |
| 8.20    | Network controls                                       | No public ingress to Postgres/Redis; Railway-internal network; CORS allow-list.                         | `infra/redis/redis.conf:18`, `apps/api/src/main.ts:23`                                                                                              | MET                                                          |
| 8.22    | Segregation of networks                                | Postgres/Redis on Railway internal plane; API on public ingress.                                        | `docs/SECURITY.md:38` (trust boundary diagram), `infra/redis/redis.conf:18`                                                                         | MET                                                          |
| 8.23    | Web filtering                                          | Helmet sets standard secure headers.                                                                    | `apps/api/src/main.ts:21`                                                                                                                           | MET                                                          |
| 8.24    | Use of cryptography                                    | One curve, one library: Ed25519 via `@noble/ed25519`; rationale ADR.                                    | `apps/api/src/common/crypto/ed25519.util.ts:1`, `docs/decisions/0002-ed25519-only-crypto.md`                                                        | MET                                                          |
| 8.25    | Secure development life cycle                          | CLAUDE.md quality bar; ADRs; threat-model checklist on PRs.                                             | `CLAUDE.md` § "Quality bar", `docs/CONTRIBUTING.md`, `docs/decisions/`                                                                              | MET                                                          |
| 8.26    | Application security requirements                      | Zod schemas on every input; typed error tree; denial precedence frozen.                                 | `packages/types/src/schemas.ts`, `apps/api/src/common/errors/cerniq-error.ts`, `docs/decisions/0004-denial-precedence-public-api.md`                | MET                                                          |
| 8.27    | Secure system architecture & engineering principles    | Documented invariants; portable verify path; non-custodial key policy.                                  | `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/decisions/0002-non-custodial-key-policy.md`, `docs/decisions/0003-portable-verify-path.md`               | MET                                                          |
| 8.28    | Secure coding                                          | ESLint + Prettier + TS strict + `noUncheckedIndexedAccess`; no `any` rule; paired spec for crypto.      | `eslint.config.mjs`, `tsconfig.base.json`, `CLAUDE.md` § "Quality bar"                                                                              | MET                                                          |
| 8.29    | Security testing in dev & acceptance                   | CodeQL, semgrep, e2e harness with property tests.                                                       | `.github/workflows/security.yml:149`, `:253`, `tests/` (root e2e harness)                                                                           | MET                                                          |
| 8.31    | Separation of dev / test / prod                        | `NODE_ENV` enforced; production refuses ephemeral keys.                                                 | `apps/api/src/modules/audit/audit.service.ts:55` (production-keys-required), `apps/api/src/config/config.schema.ts`                                 | MET                                                          |
| 8.32    | Change management                                      | Conventional commits, changesets, ADRs, CI gate.                                                        | `commitlint.config.cjs`, `.changeset/`, `docs/decisions/`, `.github/workflows/ci.yml`                                                               | MET                                                          |
| 8.34    | Protection of information systems during audit testing | Append-only audit log immune to mid-test mutation; spec-sync gate.                                      | `CLAUDE.md` invariant 3, `scripts/verify-spec.ts`                                                                                                   | MET                                                          |

---

### 3.3 OWASP API Security Top 10 (2023)

| Control | Name                                            | CERNIQ implementation                                                                                                                                                | Evidence source                                                                                                                   | Status                                                                                                    |
| ------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| API1    | Broken Object Level Authorisation               | Every service method takes `principalId` as the first arg + `where` clause. The audit `list()` re-fetches the agent scoped to the principal before returning events. | `apps/api/src/modules/audit/audit.service.ts:139`, `:211`; `CLAUDE.md` invariant 5                                                | MET                                                                                                       |
| API2    | Broken Authentication                           | API keys: bcrypt cost 12, prefix-narrowed candidate set, constant-time compare; revoked keys filtered; signed JWT tokens use EdDSA Ed25519.                          | `apps/api/src/modules/auth/api-key.service.ts:54`, `apps/api/src/common/crypto/jwt.util.ts`                                       | MET                                                                                                       |
| API3    | Broken Object Property Level Authorisation      | DTOs are Zod-typed; output dtos exclude `keyHash`, `signedToken` body, and other sensitive fields by construction.                                                   | `apps/api/src/modules/audit/audit.dto.ts`, `packages/types/src/schemas.ts`                                                        | MET                                                                                                       |
| API4    | Unrestricted Resource Consumption               | `@nestjs/throttler` per-key (1000 verify rpm, 120 default rpm); Redis `maxmemory` cap; spend caps per policy.                                                        | `apps/api/src/modules/verify/verify.module.ts`, `infra/redis/redis.conf:57`, `apps/api/src/modules/verify/spend-guard.service.ts` | MET                                                                                                       |
| API5    | Broken Function Level Authorisation             | Decorators (`@Public`, `@VerifyKeyOnly`) drive guard behaviour; default is "auth required".                                                                          | `apps/api/src/modules/auth/api-key.guard.ts:7`, `:10`, `apps/api/src/common/decorators/`                                          | MET                                                                                                       |
| API6    | Unrestricted Access to Sensitive Business Flows | Plan tier gates verify call volume; FREE tier hard-stops with rate limit (OD-006).                                                                                   | `apps/api/src/modules/billing/plans.ts`, `OPERATOR_DECISIONS.md` OD-006                                                           | MET                                                                                                       |
| API7    | Server-Side Request Forgery                     | Webhook deliveries are user-supplied URLs — currently no allow-list.                                                                                                 | `apps/api/src/modules/webhooks/webhook.delivery.ts`                                                                               | PARTIAL — no SSRF protection on customer webhook URLs (private-IP block + DNS rebind defence outstanding) |
| API8    | Security Misconfiguration                       | Helmet, CORS allow-list, distroless nonroot, Redis command lockdown, `protected-mode yes`.                                                                           | `apps/api/src/main.ts:21`, `infra/docker/Dockerfile.api:84`, `infra/redis/redis.conf:109`–`:131`                                  | MET                                                                                                       |
| API9    | Improper Inventory Management                   | OpenAPI spec + drift check; SBOM generated weekly.                                                                                                                   | `scripts/verify-spec.ts`, `.github/workflows/security.yml:285`, `.github/workflows/sbom.yml`                                      | MET                                                                                                       |
| API10   | Unsafe Consumption of APIs                      | `verifier-rp` does offline verify (no callbacks); webhook delivery has 5 s per-attempt timeout, 2 KiB body cap, exponential backoff, DLQ at 8 attempts.              | `packages/verifier-rp/`, `apps/api/src/modules/webhooks/webhook.delivery.ts`, `OPERATOR_DECISIONS.md` OD-005                      | MET                                                                                                       |

---

### 3.4 NIST CSF 2.0 (2024)

#### GOVERN

| Control | Name                                       | CERNIQ implementation                                      | Evidence source                                                    | Status                                          |
| ------- | ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| GV.OC   | Organisational Context                     | Mission stated; product surface scoped.                    | `CLAUDE.md` § "What CERNIQ is", `README.md`                        | MET                                             |
| GV.RM   | Risk Management Strategy                   | Quarterly review of this doc + threat model.               | This file header, `docs/THREAT_MODEL.md`                           | PARTIAL — risk register not formal              |
| GV.RR   | Roles, Responsibilities, Authorities       | Operator owns everything today.                            | `CLAUDE.md`, `OPERATOR_DECISIONS.md`                               | PARTIAL — RACI deferred to first hire           |
| GV.PO   | Policy                                     | Architecture invariants are the policy.                    | `CLAUDE.md` invariants 1–6                                         | MET                                             |
| GV.OV   | Oversight                                  | This doc is the oversight artifact.                        | This file                                                          | PARTIAL — independent review TBD                |
| GV.SC   | Cybersecurity Supply Chain Risk Management | SBOM, license allow-list, OSV-scanner, dependency pinning. | `.github/workflows/security.yml`, `infra/docker/Dockerfile.api:62` | PARTIAL — no formal vendor-risk programme (§ 6) |

#### IDENTIFY

| Control | Name             | CERNIQ implementation                                       | Evidence source                                   | Status |
| ------- | ---------------- | ----------------------------------------------------------- | ------------------------------------------------- | ------ |
| ID.AM   | Asset Management | Asset inventory in SECURITY.md; data classification in § 4. | `docs/SECURITY.md:9`, this file § 4               | MET    |
| ID.RA   | Risk Assessment  | STRIDE catalog.                                             | `docs/THREAT_MODEL.md`, `docs/THREAT_MODEL_v2.md` | MET    |
| ID.IM   | Improvement      | ARCHITECTURE_AUDIT findings drive backlog.                  | `docs/ARCHITECTURE_AUDIT.md`, `WORK_BOARD.md`     | MET    |

#### PROTECT

| Control  | Name                                                        | CERNIQ implementation                                                                         | Evidence source                                                                                             | Status                                                                                                                             |
| -------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| PR.AA-01 | Identities & credentials issued, managed, verified, revoked | API-key issue + revoke surfaces; JWKS publication for rotation.                               | `apps/api/src/modules/auth/api-key.service.ts:28`, `apps/api/src/modules/wellknown/wellknown.service.ts:98` | MET                                                                                                                                |
| PR.AA-02 | Identities are proofed and bound                            | Email verification flag; KYC for trust >700.                                                  | `apps/api/prisma/schema.prisma:24`, `apps/api/src/modules/bate/bate.cold-start.ts`                          | PARTIAL — email verification flow not yet wired (M-003)                                                                            |
| PR.AA-03 | Users / services / hardware authenticated                   | API-key guard on every protected route.                                                       | `apps/api/src/modules/auth/api-key.guard.ts:19`                                                             | MET                                                                                                                                |
| PR.AA-05 | Access permissions managed by least privilege               | Two key scopes, two DB roles.                                                                 | `apps/api/src/modules/auth/api-key.service.ts:33`, `infra/postgres/init.sql:86`                             | MET                                                                                                                                |
| PR.DS-01 | Data-at-rest protected                                      | Postgres native encryption (Railway-managed); bcrypt for keys; Redis AOF on encrypted volume. | `apps/api/prisma/schema.prisma:39`, `infra/postgres/init.sql`                                               | PARTIAL — encryption-at-rest is managed by Railway/Cloudflare; we don't apply application-layer envelope encryption to PII columns |
| PR.DS-02 | Data-in-transit protected                                   | TLS 1.3 enforced upstream; HSTS via Helmet defaults.                                          | `apps/api/src/main.ts:21`, `docs/SECURITY.md:32`                                                            | MET                                                                                                                                |
| PR.DS-10 | Integrity of data                                           | Audit chain Ed25519 signatures + prev-hash.                                                   | `apps/api/src/common/crypto/audit-chain.util.ts:86`                                                         | MET                                                                                                                                |
| PR.PS-01 | Configuration management practices                          | Pinned base images, frozen lockfile, env-validated config.                                    | `infra/docker/Dockerfile.api:25`, `apps/api/src/config/config.schema.ts`                                    | MET                                                                                                                                |
| PR.PS-05 | Installation & execution of unauthorised software prevented | Distroless runtime — no shell, no apt; `--frozen-lockfile` install; license allow-list.       | `infra/docker/Dockerfile.api:82`, `.github/workflows/security.yml:177`                                      | MET                                                                                                                                |
| PR.PS-06 | Secure software development practices                       | Quality bar in CLAUDE.md; CodeQL; semgrep; ADRs.                                              | `CLAUDE.md` § "Quality bar", `.github/workflows/security.yml:149`, `docs/decisions/`                        | MET                                                                                                                                |

#### DETECT

| Control  | Name                                     | CERNIQ implementation                                              | Evidence source                                                                                                    | Status                                                     |
| -------- | ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| DE.CM-01 | Networks & network services monitored    | No public ingress; CORS allow-list.                                | `apps/api/src/main.ts:23`, `infra/redis/redis.conf:18`                                                             | PARTIAL — WAF (Cloudflare) is Phase 3                      |
| DE.CM-03 | Personnel activity monitored             | Audit chain captures every authorised action.                      | `apps/api/src/modules/audit/audit.service.ts:75`                                                                   | MET                                                        |
| DE.CM-09 | Computing hardware & software monitored  | Prometheus metrics; pg_stat_statements; Redis slowlog.             | `apps/api/src/common/observability/metrics.service.ts`, `infra/postgres/init.sql:49`, `infra/redis/redis.conf:139` | MET                                                        |
| DE.AE-02 | Anomalies analysed for impact            | BATE worker debounces, recomputes, emits webhook on band crossing. | `apps/api/src/modules/bate/bate.worker.ts`, `apps/api/src/modules/bate/bate.scorer.ts`                             | MET                                                        |
| DE.AE-04 | Adverse events characterised             | Decision + denialReason captured per event.                        | `apps/api/prisma/schema.prisma:185` (AuditEvent), `docs/SECURITY.md:108` (denial precedence)                       | MET                                                        |
| DE.AE-08 | Incidents declared when criteria are met | Trigger criteria not formal.                                       | —                                                                                                                  | GAP — incident declaration runbook + criteria not codified |

#### RESPOND

| Control  | Name                                           | CERNIQ implementation                                   | Evidence source                                                                 | Status                                                                               |
| -------- | ---------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| RS.MA-01 | Incident management plan executed              | RUNBOOK.md scaffolded.                                  | `docs/RUNBOOK.md`                                                               | PARTIAL — never exercised                                                            |
| RS.AN-03 | Analyses performed to determine root cause     | Audit chain export + slow-query log + trace IDs.        | `apps/api/src/modules/audit/audit.service.ts:190`, `infra/postgres/init.sql:62` | MET                                                                                  |
| RS.CO-02 | Internal & external stakeholders kept informed | Status page TODO.                                       | —                                                                               | GAP — status page (`status.cerniqapp.com`) not live; THREAT_MODEL.md acceptance gate |
| RS.MI-02 | Incidents contained & eradicated               | Revoke endpoints (agent, policy, API key) + cache bust. | `docs/SECURITY.md:170` (T-3 mitigation)                                         | MET                                                                                  |

#### RECOVER

| Control  | Name                           | CERNIQ implementation   | Evidence source                                                 | Status                    |
| -------- | ------------------------------ | ----------------------- | --------------------------------------------------------------- | ------------------------- |
| RC.RP-01 | Recovery plan executed         | DR runbook + AOF + RDB. | `docs/RUNBOOK.md`, `infra/redis/redis.conf:77`, `infra/backup/` | PARTIAL — never exercised |
| RC.CO-04 | Public updates during recovery | Status page TODO.       | —                                                               | GAP                       |

---

### 3.5 NIST SP 800-53 Rev. 5 — selected families

Only the controls with direct CERNIQ overlap; this is **not** a complete
800-53 mapping (we are not a federal-information-system tenant).

| Control | Name                                         | CERNIQ implementation                                                        | Evidence source                                                                                                                                       | Status                                                                          |
| ------- | -------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| AC-2    | Account Management                           | API-key issue/revoke + DB role separation.                                   | `apps/api/src/modules/auth/api-key.service.ts:28`, `infra/postgres/init.sql:86`                                                                       | MET                                                                             |
| AC-3    | Access Enforcement                           | Guard + multi-tenant isolation by `principalId`.                             | `apps/api/src/modules/auth/api-key.guard.ts:19`, `CLAUDE.md` invariant 5                                                                              | MET                                                                             |
| AC-6    | Least Privilege                              | Two key scopes; two DB roles; distroless nonroot.                            | `apps/api/prisma/schema.prisma:60`, `infra/postgres/init.sql:86`, `infra/docker/Dockerfile.api:84`                                                    | MET                                                                             |
| AU-2    | Event Logging                                | Audit append on every authorisation decision.                                | `apps/api/src/modules/audit/audit.service.ts:75`                                                                                                      | MET                                                                             |
| AU-9    | Protection of Audit Information              | Append-only schema + Ed25519 chain signatures + JWKS-published verifier key. | `CLAUDE.md` invariant 3, `apps/api/src/common/crypto/audit-chain.util.ts:86`, `apps/api/src/modules/wellknown/wellknown.service.ts:98`                | MET                                                                             |
| AU-11   | Audit Record Retention                       | 7 years (OD-004).                                                            | `OPERATOR_DECISIONS.md` OD-004                                                                                                                        | PARTIAL — automated purge not wired                                             |
| IA-2    | Identification & Authentication              | API-key auth required on every protected route.                              | `apps/api/src/modules/auth/api-key.guard.ts:19`                                                                                                       | MET                                                                             |
| IA-5    | Authenticator Management                     | bcrypt cost 12; one-time plaintext disclosure on issuance.                   | `apps/api/src/modules/auth/api-key.service.ts:38`                                                                                                     | MET                                                                             |
| SC-8    | Transmission Confidentiality & Integrity     | TLS 1.3 + Helmet defaults.                                                   | `apps/api/src/main.ts:21`                                                                                                                             | MET                                                                             |
| SC-12   | Cryptographic Key Establishment & Management | Ed25519; key rotation via JWKS; production refuses ephemeral keys.           | `docs/decisions/0002-ed25519-only-crypto.md`, `apps/api/src/modules/wellknown/wellknown.service.ts`, `apps/api/src/modules/audit/audit.service.ts:55` | MET                                                                             |
| SC-13   | Cryptographic Protection                     | Ed25519 / EdDSA; bcrypt cost 12; HMAC-SHA-256 webhook signatures.            | `apps/api/src/common/crypto/ed25519.util.ts`, `apps/api/src/common/crypto/jwt.util.ts`, `apps/api/src/modules/webhooks/webhook.delivery.ts`           | MET                                                                             |
| SC-28   | Protection of Information at Rest            | Managed Postgres encryption + bcrypt for API keys.                           | `infra/postgres/init.sql`, `apps/api/src/modules/auth/api-key.service.ts:38`                                                                          | PARTIAL — application-layer envelope encryption for PII columns not implemented |

---

## 4. Data classification

| Model · Field                                | Classification                | Retention                    | Encryption at rest                                | Encryption in transit | Notes                                                               |
| -------------------------------------------- | ----------------------------- | ---------------------------- | ------------------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| `Principal.email`                            | PII                           | Until account deletion       | Postgres native (Railway-managed disk encryption) | TLS 1.3               | citext column; only PII we hold                                     |
| `Principal.name`                             | PII (low)                     | Until account deletion       | Postgres native                                   | TLS 1.3               | Optional                                                            |
| `Principal.kycVerified`                      | Confidential                  | Until account deletion       | Postgres native                                   | TLS 1.3               | Boolean only — KYC docs themselves not stored by CERNIQ             |
| `Principal.billingCustomerId`                | Confidential                  | Until account deletion       | Postgres native                                   | TLS 1.3               | Stripe ID, not card data                                            |
| `ApiKey.keyHash`                             | Sensitive (secret-derivative) | Until revoke + 7 y for audit | bcrypt cost 12 + Postgres native                  | TLS 1.3               | Plaintext shown once at issuance                                    |
| `ApiKey.keyPrefix`                           | Internal                      | Until revoke + 7 y           | Postgres native                                   | TLS 1.3               | First 12 chars only — used for narrowing, not auth                  |
| `ApiKey.lastUsedAt`                          | Internal                      | Until revoke + 7 y           | Postgres native                                   | TLS 1.3               | —                                                                   |
| `AgentIdentity.publicKey`                    | Public (PII-adjacent)         | Until revoke + 7 y for audit | Postgres native                                   | TLS 1.3               | Links to a principal — track as PII-adjacent for correlation        |
| `AgentIdentity.label`, `model`, `runtime`    | Internal                      | Until revoke + 7 y           | Postgres native                                   | TLS 1.3               | Customer-supplied metadata                                          |
| `AgentIdentity.trustScore`, `trustBand`      | Internal                      | Until revoke + 7 y           | Postgres native                                   | TLS 1.3               | BATE output                                                         |
| `AgentPolicy.signedToken`                    | Sensitive                     | Until revoke + 7 y           | Postgres native                                   | TLS 1.3               | EdDSA-signed; verifiable but server-side authoritative              |
| `AgentPolicy.scopes` (JSON)                  | Internal                      | Until revoke + 7 y           | Postgres native                                   | TLS 1.3               | —                                                                   |
| `AuditEvent.*`                               | Audit evidence                | **7 years** (OD-004)         | Postgres native                                   | TLS 1.3               | Append-only; signed; A-019 schema rework pending for GDPR Art 17    |
| `AuditEvent.policySnapshot` (JSON)           | Confidential                  | 7 y                          | Postgres native                                   | TLS 1.3               | —                                                                   |
| `BateSignal.payload` (JSON)                  | Internal                      | 7 y aligned with audit       | Postgres native                                   | TLS 1.3               | Anti-fraud reverse-engineering risk → never exposed publicly        |
| `TrustScoreHistory.*`                        | Internal                      | 7 y                          | Postgres native                                   | TLS 1.3               | Required for "why did my score change" customer-facing explainer    |
| `WebhookSubscription.secret`                 | Sensitive                     | Until revoke                 | Postgres native (column-level encryption planned) | TLS 1.3               | HMAC-SHA-256 secret; A-001 hardening: encrypt-at-column outstanding |
| `WebhookDelivery.payload` (JSON)             | Confidential                  | 30 d (operational)           | Postgres native                                   | TLS 1.3               | —                                                                   |
| `RelyingParty.apiKeyHash`                    | Sensitive                     | Until revoke                 | bcrypt + Postgres native                          | TLS 1.3               | —                                                                   |
| `SpendRecord.amount`, `merchantId`, `domain` | Confidential                  | 7 y aligned with audit       | Postgres native                                   | TLS 1.3               | —                                                                   |

---

## 5. Subprocessors

| Subprocessor | Purpose                                                           | Data shared                                                                                                                                                                                                                         | Region                                                         | DPA                                                               |
| ------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Railway      | Compute (API + workers); managed Postgres + Redis plugins         | Everything in `apps/api/prisma/schema.prisma` (Principal email, API key hashes, public keys, policies, audit events, BATE signals)                                                                                                  | US (default region; EU available — see `docs/EU_RESIDENCY.md`) | https://railway.app/legal/dpa (placeholder until executed)        |
| Cloudflare   | Edge proxy + WAF + DDoS (Phase 3) + Workers verify path (Phase 3) | Request metadata only at L7; verify path will see signed tokens (no plaintext PII)                                                                                                                                                  | Global anycast; EU isolation available                         | https://www.cloudflare.com/cloudflare-customer-dpa/ (placeholder) |
| Stripe       | Billing (subscription + metered usage)                            | Principal billing customer ID, plan tier, metered verify counts. **No card numbers ever transit CERNIQ** — Stripe's hosted Checkout / Elements tokenises card data; we hold only the `customerId`.                                  | US, with EU SCCs                                               | https://stripe.com/legal/dpa (placeholder)                        |
| Sentry       | Error capture (DSN optional, disabled in dev)                     | Stack traces, redacted request headers (`x-cerniq-api-key`, `x-cerniq-verify-key`, `authorization` scrubbed by Pino redact list before log shipping). PII redaction enforced by Sentry's `beforeSend` hook (TODO if not yet wired). | US or EU per project setting                                   | https://sentry.io/legal/dpa/ (placeholder)                        |

PCI scope: CERNIQ is **out of PCI scope** because we never touch a card
PAN. Stripe Elements/Checkout handles all cardholder data; CERNIQ sees
opaque `customerId` strings and webhook signatures only.

---

## 6. Open compliance gaps (honest)

This is the list a customer security team is allowed to read.

| Gap                                           | Status  | Notes                                                                                                                                                                                                                                                |
| --------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Annual penetration test                       | GAP     | Schedule before public launch. Methodology: GHOST SWARM per `docs/THREAT_MODEL.md` acceptance gates.                                                                                                                                                 |
| Vendor risk reviews (subprocessors)           | GAP     | No formal review process; subprocessors listed in § 5 chosen on reputation only. Process formalises with first paying customer.                                                                                                                      |
| Personnel security training                   | GAP     | Solo founder. Trigger: first hire. Training programme + annual refresh + onboarding security checklist scaffolded then.                                                                                                                              |
| Business continuity tabletop                  | GAP     | `docs/RUNBOOK.md` exists, `infra/backup/` exists; tabletop drill never run. Schedule before first paying customer.                                                                                                                                   |
| Vulnerability management SLA                  | PARTIAL | `.github/workflows/security.yml` runs OSV-scanner / trivy / pnpm-audit / CodeQL / semgrep weekly; SLA for Critical/High/Medium fix windows is not codified. Target: Critical 7 d, High 30 d, Medium 90 d (proposed, not yet committed).              |
| Customer-facing breach notification SLA       | GAP     | No DPA executed; no privacy policy public. Both required before first enterprise contract.                                                                                                                                                           |
| Audit log retention enforcement               | PARTIAL | Schema supports 7-year retention (OD-004); automated purging cron not wired. Enforced by manual operator action until then.                                                                                                                          |
| Anti-malware on endpoints                     | GAP     | Applies once team grows. Trigger: second team member. Document the trigger condition rather than ship a control nobody operates.                                                                                                                     |
| Status page                                   | GAP     | `status.cerniqapp.com` not live (`docs/THREAT_MODEL.md` acceptance gate).                                                                                                                                                                            |
| Incident-declaration criteria                 | GAP     | RUNBOOK has the recovery scaffold; severity bands and declaration thresholds are not formal.                                                                                                                                                         |
| Public privacy notice                         | GAP     | Required before collecting any non-developer PII. Today we collect only developer email; threshold to act is the first non-developer-facing surface.                                                                                                 |
| Bug bounty programme                          | GAP     | `security@cerniqapp.com` mailbox + a `SECURITY.md` advisory channel pending.                                                                                                                                                                         |
| Cyber insurance                               | GAP     | Embroker / Coalition binder pending — `docs/THREAT_MODEL.md` acceptance gate.                                                                                                                                                                        |
| Webhook URL SSRF defence                      | GAP     | Customer-supplied webhook URLs are not screened for private IPs / DNS rebinding. (OWASP API7)                                                                                                                                                        |
| Application-layer envelope encryption for PII | PARTIAL | Postgres native encryption-at-rest is the only layer. Email and `policySnapshot` JSON not envelope-encrypted. Defer until SOC 2 Type II evidence collection demands it.                                                                              |
| Audit-event PII redactability (GDPR Art 17)   | GAP     | Current `AuditEvent` schema signs over raw `denialReason` text. ARCHITECTURE_AUDIT A-019 (High): refactor to sign over `decisionReasonHash` so PII columns can be nulled without breaking the chain. **Must land before M-006 ships to production**. |
| RLS at Postgres layer                         | GAP     | Defence-in-depth on top of app-layer `principalId` filtering. Tracked in `docs/ARCHITECTURE.md` § 8.                                                                                                                                                 |

---

## 7. Audit cadence + revisitation

- **Quarterly review** of this document by the operator. Each row has an
  implicit `last-reviewed` of the document's frontmatter date until the
  row was last touched. Reviewer asks for each row: (a) does the cited
  path still exist? (b) does it still implement the control as described?
  (c) has the surrounding code drifted in a way that demotes the row?
- **Annual third-party audit** planned post first paying customer. Until
  then this is internal self-assessment.
- **Triggered review** on any of: a new subprocessor, a new framework an
  enterprise prospect requires, an architecture invariant change, or a
  security incident.
- **Drift detection**: `scripts/verify-spec.ts` already gates spec/code
  drift; an extension that asserts every cited path in this document
  exists is open work.

---

## 8. How to use this doc

- **Auditor.** Read top-to-bottom. Cite by section number in the audit
  response. The data classification (§ 4) and subprocessor list (§ 5) are
  the two most-asked artefacts; the SOC 2 mappings (§ 3.1) carry the
  weight.
- **Customer security questionnaire (CAIQ / SIG Lite).** Roughly 80% of
  questions resolve to a row above. Cite the row. Where a question
  doesn't have a row, file an issue against this document — silence is
  the wrong answer.
- **Engineer (us).** When adding a feature, scan § 3 for controls the
  feature touches and update the affected rows in the same PR. The doc
  is part of the change. If a feature lifts a `PARTIAL` to `MET`, flip
  the status and cite the new path.
- **What to never do.** Never cite a `GAP` row as `MET` in any external
  document. Never invent a control to fill a row. If a row's cited path
  is missing, mark the row `GAP` immediately and ping the operator —
  a missing citation is more dangerous than a missing control because
  it implies false confidence.
