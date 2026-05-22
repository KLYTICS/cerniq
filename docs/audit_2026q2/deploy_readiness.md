# OKORO — Deploy Readiness Audit (2026-Q2)

**Auditor**: Claude (Opus 4.7, 1M ctx) — read-only audit pass
**Date**: 2026-05-01
**Scope**: Railway (origin API + worker), Cloudflare Workers (Phase 3
edge verify), Vercel (potential dashboard target)
**Method**: Static read of repo at `/Users/money/Desktop/OKORO`. No
source mutations, no commands run that change state.

---

## TL;DR — first-deploy readiness

| Platform                          | Rating               | First deploy can succeed today? |
| --------------------------------- | -------------------- | ------------------------------- |
| **Railway — `okoro-api`**         | YELLOW (close)       | No — see blockers B1, B2, B3    |
| **Railway — `okoro-worker`**      | RED                  | No — see blocker B4 (entrypoint missing) |
| **Cloudflare Workers — cf-verify**| GREEN-as-locked      | Intentionally bricked. No action required for Phase 1. |
| **Vercel — dashboard**            | YELLOW (works, suboptimal) | Yes, with caveats — see V1, V2  |

The single biggest blocker is **B1: there are no Prisma migrations
checked in**, so `prisma migrate deploy` (which the API service runs on
boot) has nothing to apply against an empty Postgres. Everything else is
either pinned + reproducible or a known-not-yet-needed gate.

---

## 1. Reproducible builds

| Item                                   | Status | Evidence |
| -------------------------------------- | ------ | -------- |
| `pnpm-lock.yaml` present                | YES    | `/Users/money/Desktop/OKORO/pnpm-lock.yaml` (374 KB, lockfileVersion 9.0). Earlier sessions referenced its absence; it is now committed. |
| Lockfile-aware install in CI           | YES    | `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile`. |
| Lockfile-aware install in Docker       | YES    | Both `infra/docker/Dockerfile.api` and `Dockerfile.worker` use `--frozen-lockfile`. |
| Lockfile-aware install in Railway      | YES    | `railway.json` and `infra/railway/api.service.json` both use `--frozen-lockfile`. |
| `packageManager` pin                   | YES    | `package.json` sets `"packageManager": "pnpm@9.12.3"`; CI + Dockerfile pin to the same version. |
| `.nvmrc` present                       | YES    | Node `>=20.11.0` engine + `.nvmrc` file. |
| Workspace glob coverage                | YES    | `pnpm-workspace.yaml` includes `apps/*`, `packages/*`, `workers/*`, `scripts`, `tests`. The previously-flagged `scripts/*` gap is closed. |
| Release CI uses different pnpm version | **FLAG** | `release.yml` pins `pnpm/action-setup@v4` to **9.15.0**, while everywhere else uses **9.12.3**. This drift is small but is a supply-chain smell — pin to one version repo-wide. |
| Release CI uses different Node         | **FLAG** | `release.yml` runs Node `22.11.0`, while CI runs `20.11.0`. SDK builds on 22 and is consumed in 20 — usually fine for `tsup`-bundled output, but a divergence to call out. |

**Rating**: GREEN with two minor pin-drift notes.

---

## 2. Railway readiness

### 2.1 `okoro-api` service

`railway.json` (root) and `infra/railway/api.service.json` are slightly
out of sync — both are committed:

| Field             | `railway.json` (root)                                              | `api.service.json`                                                                 |
| ----------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `buildCommand`    | `pnpm install --frozen-lockfile && prisma:generate && build`        | identical                                                                          |
| `startCommand`    | `pnpm --filter @okoro/api start:prod`                               | `prisma:deploy && start:prod`                                                       |
| `healthcheckPath` | `/v1/health/ready`                                                  | `/v1/health/ready`                                                                  |
| `healthcheckTimeout` | 30                                                              | 30                                                                                  |
| `restartPolicyMaxRetries` | 5                                                          | 5                                                                                   |

A second descriptor `infra/railway/okoro-api.json` exists as a "legacy"
file with `healthcheckPath: /health` (no v1 prefix) — this would 404 in
production. The README marks it as deprecated; **delete it before
operators link Railway to it by mistake**.

**Healthcheck path correctness**: I verified the actual route by
reading `apps/api/src/main.ts` and `apps/api/src/modules/health/health.controller.ts`:

- `main.ts` sets `setGlobalPrefix('v1', { exclude: [{ path: '/', ... }, { path: '.well-known/(.*)', ... }] })`.
- `HealthController` uses `@Controller('health')` with `@Get('ready')`.
- `@Public()` is an **auth-bypass decorator** (`api-key.guard.ts`); it does **not** affect the URL prefix.
- Therefore the actual path is `/v1/health/ready`. ✅

The peer's earlier note in `SESSION_HANDOFF.md` ("the actual controller
exposes `/ready` without v1 prefix because it's marked `@Public` and
prefix excluded") is **incorrect**. `railway.json`'s
`healthcheckPath: /v1/health/ready` is right.

**Build/start command sanity**:

- `build` script in `apps/api/package.json` is `nest build` ✅
- `prisma:generate` is `prisma generate` ✅
- `prisma:deploy` is `prisma migrate deploy` ✅ — but the
  `migrations/` directory is **empty** (see § 7).

**Env-var coverage**: `infra/railway/api.service.json` enumerates 20+
env vars with provisioning notes. Cross-referenced against
`apps/api/src/config/config.schema.ts`:

| Var                                | Schema | Documented | Notes |
| ---------------------------------- | ------ | ---------- | ----- |
| `NODE_ENV`                         | yes    | yes        |       |
| `PORT`                             | yes    | yes        |       |
| `LOG_LEVEL`                        | yes    | yes        |       |
| `API_BASE_URL`                     | yes    | yes        |       |
| `DATABASE_URL`                     | yes    | yes        |       |
| `DATABASE_DIRECT_URL`              | **no** | yes        | Used in `_provision` notes for migrations; not validated by Zod. Either add to schema or document that Prisma reads it directly via the `directUrl` field — currently `schema.prisma` has only `url = env("DATABASE_URL")` so `DATABASE_DIRECT_URL` would be **silently ignored** by Prisma. |
| `REDIS_URL`                        | yes    | yes        |       |
| `JWT_ED25519_PRIVATE_KEY_B64`      | yes    | yes        |       |
| `JWT_ED25519_PUBLIC_KEY_B64`       | yes    | yes        |       |
| `AUDIT_ED25519_PRIVATE_KEY_B64`    | yes    | yes        |       |
| `AUDIT_ED25519_PUBLIC_KEY_B64`     | yes    | yes        |       |
| `OKORO_SIGNING_PUBLIC_KEY`         | yes    | **no**     | **Missing from `infra/railway/api.service.json`.** `wellknown.service.ts` throws at boot if absent (`onModuleInit`) — so the API will crash at startup in prod unless this is set. |
| `OKORO_SIGNING_KEY_ROTATED_AT`     | yes    | **no**     | Optional but documented in schema; missing from service descriptor. |
| `API_KEY_BCRYPT_COST`              | yes    | yes        |       |
| `THROTTLE_*`                       | yes    | yes        |       |
| `ENABLE_BATE`/`WEBHOOKS`/`SWAGGER` | yes    | yes        |       |
| `STRIPE_SECRET_KEY`                | yes    | yes        |       |
| `STRIPE_WEBHOOK_SECRET`            | yes    | yes        |       |
| `SENTRY_DSN`                       | yes    | yes        |       |
| `OTEL_*`                           | **no** | yes        | OTel env vars are listed for Railway but are not in `config.schema.ts`. Whether they're enforced depends on the (not-yet-imported) OTel bootstrap module. |
| `CORS_ORIGINS`                     | yes    | **no**     | Schema has it (default `*`); service descriptor doesn't. In prod this should NOT be `*` for an auth-bearing API. |

### 2.2 `okoro-worker` service

`infra/railway/worker.service.json` declares `startCommand: node apps/api/dist/workers/main.js`.

**Blocker**: `apps/api/src/workers/` does not exist in the repo. The
worker entry point is referenced in:
- `infra/docker/Dockerfile.worker` line 87: `CMD ["dist/workers/main.js"]`
- `infra/railway/worker.service.json` line 12

The Dockerfile itself has a comment acknowledging this gap (line 83:
"peer Claude is wiring `apps/api/src/workers/main.ts` … Until that
lands, the path below MUST exist or the container will crash loop").
Currently:
- `apps/api/src/modules/bate/bate.worker.ts` exists (BullMQ Queue + Worker class).
- No `main.ts` bootstrapper that wires queues + Pino + signal handling.

So the worker service **cannot be deployed** today. It will exit
immediately with a missing-module error. The API service does not
require this — BullMQ inside the API process will still spin up, but
it's a separate-process worker that's missing.

### 2.3 `okoro-pg` and `okoro-redis`

Descriptors are sound. Postgres uses `postgres:16-alpine` (matches
schema/CI). Redis uses `redis:7-alpine`. Init script
`infra/postgres/init.sql` is referenced; not opened in this audit but
listed in handoff notes. RPO/RTO for Postgres is documented (5 min /
60 min) — adequate for Phase 1.

**Rating**: API is YELLOW (close — fix blockers below). Worker is RED.

---

## 3. Cloudflare Workers readiness

`workers/cf-verify/wrangler.toml`:

- `compatibility_date = "2026-04-01"` — current.
- `compatibility_flags = ["nodejs_compat"]` — needed for `@noble/ed25519` and audit-chain util.
- `[[kv_namespaces]] id = "REPLACE_ME_AT_DEPLOY"` — placeholder by design (per Phase-3 deploy steps in `workers/cf-verify/README.md`).
- `[[durable_objects.bindings]] RATE_LIMITER` and migration `tag = "v1"` referencing `EdgeRateLimiter` — class is exported as a stub in `src/index.ts` (returns 501) but a Durable Object with no implementation will still be **provisioned** on `wrangler deploy`. This is acceptable Phase 3 prep.
- `[vars] OKORO_ORIGIN_URL = "https://api.okorolabs.io"` — placeholder hostname.

`package.json`:

```json
"deploy": "echo 'Phase 3 only — gated behind $5K OKORO MRR. Edit me when ready.' && exit 1",
```

The deploy gate is **explicit and discoverable**: any operator who
runs `pnpm deploy` from `workers/cf-verify` will see the message and
exit. The `README.md` documents the unlock procedure (provision KV,
swap secrets, edit the script body, then `wrangler deploy`).

`src/index.ts` is a **forward-only proxy** to the origin
(`/v1/verify`). It is safe to deploy without the verify algorithm
being ported yet (Phase 3 M1 milestone). However, a forward-only
worker provides **negative value** until M2 (KV cache) lands — every
verify pays an extra hop.

**Rating**: GREEN-as-locked. The gate is correctly sealed; no Phase-1
work needed. Operator should NOT deploy this in Phase 1.

---

## 4. Vercel readiness (dashboard)

`apps/dashboard/next.config.ts` is minimal:

```ts
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { typedRoutes: true },
};
```

`apps/dashboard/package.json` uses `next ^16.0.0`, `react ^19.0.0`.

**Vercel deploy path observations** (Jan 2026 platform reality):

- **V1 — No `vercel.json` / `vercel.ts`**: There is no platform config
  file. Vercel will autodetect Next.js and use Fluid Compute defaults.
  This works, but to lock the runtime (fluid-compute is the default,
  edge-functions deprecated), the project should commit a `vercel.ts`
  declaring `framework: 'nextjs'` and any `runtime: 'nodejs'`
  overrides for sensitive routes.
- **V2 — Monorepo root**: `apps/dashboard` is inside a pnpm workspace.
  Vercel needs `Root Directory: apps/dashboard` and will then run
  `pnpm install` from the repo root automatically (Vercel detects
  `pnpm-lock.yaml` at the root). This must be configured in the
  Vercel project settings; there is no IaC capturing it.
- **V3 — Node 20 lock**: `engines.node = ">=20.11.0"` at root. Vercel
  defaults to a recent LTS; pin via `vercel.ts` `nodeVersion` if you
  care which minor.
- **V4 — Server-side env**: dashboard reads `NEXT_PUBLIC_API_URL` per
  `.env.example`. No server actions are used in the visible pages
  (read of `app/page.tsx`, `app/agents/page.tsx`,
  `app/policies/page.tsx`); they appear to be RSC-only static
  shells. No middleware file in `apps/dashboard/`. Edge runtime is
  not required.
- **V5 — Build script**: `next build` (default). No
  `output: 'standalone'` is set — that's fine for Vercel (only needed
  for Docker).
- **V6 — Auth integration**: dashboard has no auth wired. For Phase 1
  internal-only use, this is fine; before any GA, an auth provider
  (Clerk via Marketplace, or a custom JWT against OKORO's own API
  keys) needs to land.
- **V7 — Cache Components / PPR**: Next 16 ships with Cache
  Components. The dashboard does not opt in (no `use cache`,
  `cacheLife`, `cacheTag`). Acceptable for Phase 1 minimal — fine to
  defer until traffic justifies it.

**Best-practice deltas (low priority for first deploy)**:
- Add `vercel.ts` at `apps/dashboard/vercel.ts` (or repo root,
  scoped) to pin framework + Node version.
- Decide whether dashboard talks to OKORO API directly from RSC
  (Node runtime, can hold a service-account API key) or only via
  client-side fetches (browser-bearing user JWT).

**Rating**: YELLOW. Can deploy today; will work; missing platform
config is a "do this before GA" item, not a blocker.

---

## 5. Docker build hygiene

Both Dockerfiles (`Dockerfile.api`, `Dockerfile.worker`):

- Multi-stage: `base` → `deps` → `build` → `runtime`. ✅
- Distroless runtime: `gcr.io/distroless/nodejs20-debian12:nonroot`. ✅
- Non-root: `USER 65532:65532`. ✅
- BuildKit cache mount for the pnpm store. ✅
- Workspace-aware install: copies all `package.json` files before
  source for layer caching. ✅
- Prisma engine forwarded to runtime via `pnpm --prod deploy`. ✅
- Source maps enabled in prod (`NODE_OPTIONS=--enable-source-maps`). ✅
- HEALTHCHECK directive uses the JS-only `healthcheck.sh` (sic — it's
  actually a `.js` payload with `node` shebang) — works in distroless. ✅

`infra/docker/healthcheck.sh` is well-engineered: zero deps, hits
`/v1/health/ready`, distinguishes timeout vs. error vs. non-200.

`.dockerignore`:

```
**/node_modules
**/.next
**/dist
**/build
**/.turbo
**/coverage
**/.env
**/.env.*
!**/.env.example
**/.git
**/.github
**/*.md
!README.md
docs/
.vscode
.idea
*.log
postgres-data/
redis-data/
```

This is reasonable, but **excludes `**/*.md`** including `CLAUDE.md`
and root `OPERATOR_DECISIONS.md` — fine, these aren't needed at
runtime. **Caveat**: it does NOT exclude `tests/` — minor bloat.

**Rating**: GREEN.

---

## 6. Environment variable hygiene

### 6.1 The audit-key naming collision

Confirmed and persisting:

| Name (in code/docs)              | Where consumed                                                        |
| -------------------------------- | --------------------------------------------------------------------- |
| `AUDIT_ED25519_PRIVATE_KEY_B64`  | `audit.service.ts` (writes signed audit events) ; `config.schema.ts`  |
| `AUDIT_ED25519_PUBLIC_KEY_B64`   | `audit.service.ts` ; `config.schema.ts` ; `infra/railway/api.service.json` ; `.env.example` |
| `OKORO_SIGNING_PUBLIC_KEY`       | `wellknown.service.ts` (publishes JWKS + audit-signing-key) ; `config.schema.ts` ; `scripts/generate-okoro-keys.ts` |

Both names are validated and consumed by separate modules. **In
production this means the operator must set BOTH** (and they must
contain the same key material) or one of two surfaces is broken:

- If only `AUDIT_ED25519_*` is set → audit events sign and append, but `/.well-known/audit-signing-key` boot-fails (`wellknown` throws at `onModuleInit`).
- If only `OKORO_SIGNING_PUBLIC_KEY` is set → wellknown responds, but `audit.service.initSigningKey()` throws "must be set in production".

The legacy descriptor `infra/railway/okoro-api.json` further muddies
the water by listing `AUDIT_SIGNING_PRIVATE_KEY_B64` /
`AUDIT_SIGNING_PUBLIC_KEY_B64` (the old RSA names, also kept in
`config.schema.ts` as `AUDIT_SIGNING_KEY_B64` "deprecated, kept for one
release").

**Recommendation (per `SESSION_HANDOFF` open conflict #3)**: pick one
canonical name (`OKORO_SIGNING_PUBLIC_KEY` per the wellknown module)
and have `audit.service.ts` read from it. Until that consolidation
lands, the runbook MUST instruct operators to set the public-key
value under both names.

### 6.2 Env vars referenced in docs but not in schema

- `DATABASE_DIRECT_URL` — referenced in railway descriptors and
  RUNBOOK; **not in `config.schema.ts`** and **not in `schema.prisma`**
  (`directUrl` field absent). Setting it has no effect today; Prisma
  pooler-vs-direct routing isn't wired.
- `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
  `OTEL_SERVICE_NAME` — referenced in railway descriptors; not in
  Zod schema. If an OTel SDK init module hasn't shipped, these are
  no-ops in production.

### 6.3 The legacy RSA path

`AUDIT_SIGNING_KEY_B64` is still in `config.schema.ts` as "deprecated,
to be removed in v0.2". It is still listed in
`infra/railway/okoro-api.json` (legacy descriptor). It does not appear
to be read anywhere active — keep an eye on this when deleting the
legacy descriptor.

**Rating**: YELLOW. The audit-key naming collision is a real
first-deploy footgun.

---

## 7. Database migrations

**Critical finding**: `apps/api/prisma/migrations/` is **empty**.

- `schema.prisma` is fully written (Principal, ApiKey, AgentIdentity,
  AgentPolicy, AuditEvent, BateSignal, etc.).
- No `migrations/<timestamp>_init/` directory exists.
- `package.json` defines `prisma:migrate` (= `migrate dev`) and
  `prisma:deploy` (= `migrate deploy`).
- Railway's `api.service.json` startCommand is `prisma:deploy && start:prod`.
- CI runs `prisma:deploy` against the test Postgres service.

**What this means for first deploy**:

- `prisma migrate deploy` requires a **migrations folder** with
  applied SQL. With an empty folder, it's a no-op — Postgres ends up
  empty, the API boots and immediately starts throwing on every
  query.
- Even worse, **CI is currently green only because** `prisma migrate
  deploy` against an empty migrations dir exits 0 and there are
  apparently no tests that hit a real query path against the empty
  schema. Re-check this assumption.

**Required fix before first deploy**:

```bash
# Generate the baseline migration locally
DATABASE_URL=postgresql://okoro:okoro@localhost:5432/okoro \
  pnpm --filter @okoro/api prisma migrate dev --name init
git add apps/api/prisma/migrations
git commit -m "feat(api): baseline prisma migration"
```

This is also **the strategy for the first deploy with no baseline** —
the first migration creates the entire schema from scratch on an
empty database. If a test database has been hand-applied via
`prisma db push` (which leaves no migration trail), it must be
dropped and re-created from migrations.

**Rating**: RED. This is the #1 blocker.

---

## 8. Secrets handling

| Secret                            | Source of truth in prod                                                         |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | Railway Postgres plugin OR Neon connection string (operator pastes into Railway dashboard). |
| `REDIS_URL`                       | Railway Redis plugin OR Upstash.                                                |
| `JWT_ED25519_PRIVATE_KEY_B64`     | Generated via `pnpm tsx scripts/generate-okoro-keys.ts --env`, piped into Railway, source file shredded. Documented in `infra/railway/README.md` § 2. |
| `JWT_ED25519_PUBLIC_KEY_B64`      | Same script.                                                                    |
| `AUDIT_ED25519_PRIVATE_KEY_B64`   | Same script. Same key copied to API + worker services so the audit chain stays unbroken. |
| `AUDIT_ED25519_PUBLIC_KEY_B64`    | Same script.                                                                    |
| `OKORO_SIGNING_PUBLIC_KEY`        | **Needs to be the same value as `AUDIT_ED25519_PUBLIC_KEY_B64`** until the naming collision is fixed. |
| `STRIPE_SECRET_KEY`               | Stripe dashboard → live secret key.                                             |
| `STRIPE_WEBHOOK_SECRET`           | Stripe dashboard → endpoint signing secret.                                     |
| `SENTRY_DSN`                      | Sentry project settings (separate projects for API vs worker per descriptor).   |
| `OTEL_EXPORTER_OTLP_HEADERS`      | Bearer token for OTel collector — shape `Authorization=Bearer%20<token>`.       |

**No KMS path is defined**. All secrets live as plaintext in Railway's
encrypted variable store (and Vercel's, if dashboard goes there). For
Phase 1 / pre-SOC2 this is acceptable; for SOC2 evidence collection,
the operator should plan for either:

- Railway's planned secrets-manager integration (when GA), or
- An external KMS (AWS KMS, HashiCorp Vault) with
  `OKORO_KMS_KEY_ID`-style indirection — not currently in schema.

The Husky pre-commit hook (`.husky/pre-commit`) does grep for
`okoro_sk_*`, `.pem`, `.env` etc. before staging — defensive layer
against accidental commit.

**Rating**: YELLOW. Process is documented; KMS path is roadmap-only.

---

## 9. Health/ready endpoint cross-reference

| Surface                  | Path declared         | Path served                                                                           |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------- |
| `railway.json` (root)    | `/v1/health/ready`    | matches `HealthController` (`@Controller('health') + @Get('ready')`) under `setGlobalPrefix('v1')`. ✅ |
| `infra/railway/api.service.json` | `/v1/health/ready` | matches. ✅                                                                            |
| `infra/railway/okoro-api.json` (legacy) | `/health` | **MISMATCH** — would 404 in prod. Delete this file.                                    |
| `infra/docker/healthcheck.sh` | `/v1/health/ready` (configurable via `HEALTHCHECK_PATH`) | matches. ✅ |
| `infra/railway/README.md` § 5 | `/v1/health/live`, `/v1/health/ready` | both routes exist on the controller. ✅ |
| `workers/cf-verify/src/index.ts` | `/health` (edge worker self-check) | served at edge, distinct from origin. ✅ |

The `SESSION_HANDOFF.md` claim that "the actual controller exposes
`/ready` without v1 prefix because it's marked `@Public` and prefix
excluded" is **wrong**. `@Public()` is an auth-bypass marker
(`apps/api/src/modules/auth/api-key.guard.ts`); it has nothing to do
with URL prefix exclusion. The only `setGlobalPrefix` exclusions are
`/` and `.well-known/(.*)`. Health endpoints **do** live under
`/v1/`.

**Rating**: GREEN (with one stale legacy descriptor to delete).

---

## 10. CI workflow correctness

`.github/workflows/ci.yml`:

- Postgres + Redis services with healthcheck conditions ✅
- Uses `pnpm install --frozen-lockfile` ✅
- Runs `prisma:deploy` against the service Postgres ✅ — but see § 7 (no migrations exist yet, so this is a no-op).
- Uses `migrate deploy`, not `migrate dev` ✅
- Lint, typecheck, tests, e2e, build — all wired ✅
- pnpm 9.12.3, Node 20.11.0 — pinned ✅

`.github/workflows/security.yml`:

- 9 jobs + summary gate (gitleaks, osv-scanner, npm-audit, trivy-fs,
  codeql, license-check, semgrep, sbom, workflow-permissions).
- **Action-pinning placeholders persist**: every third-party action
  has a `# pin: replace with full sha before merge` comment. The
  workflow header explicitly acknowledges this as an intentional
  exception that must be closed in a single PR. Found 17 occurrences
  of the placeholder marker. This is a **medium-severity supply-chain
  posture gap** — not a deploy blocker, but should not stay open
  through any external code review.
- Top-level `permissions: contents: read` ✅
- License allowlist with embedded Node program ✅
- One concern: `osv-scanner-action` is referenced as
  `google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v1.9.1`
  — that's a reusable workflow ref, which is technically pinnable to
  a SHA but is also a different attack-surface than `uses: foo@sha`.

`.github/workflows/release.yml`:

- pnpm 9.15.0 (drift from 9.12.3 used everywhere else — see § 1).
- Node 22.11.0 (drift from 20.11.0 elsewhere).
- Changesets-driven publish to npm with `NPM_CONFIG_PROVENANCE=true`
  — Sigstore provenance enabled. ✅
- Only handles `@okoro/sdk` and `@okoro/types`. Internal apps deploy
  via Railway / Vercel as documented. ✅

**Rating**: YELLOW (placeholder pins + minor version drift).

---

## 11. Missing-but-required artifacts (master list)

In approximate priority order:

1. **`apps/api/prisma/migrations/<ts>_init/`** — baseline migration
   does not exist. Required for `prisma migrate deploy` to do anything.
2. **`apps/api/src/workers/main.ts`** — the BullMQ worker bootstrap
   referenced by `Dockerfile.worker` and `infra/railway/worker.service.json`. Without this, the worker service crash-loops on first start.
3. **Resolution of `AUDIT_ED25519_PUBLIC_KEY_B64` vs `OKORO_SIGNING_PUBLIC_KEY` collision** — pick one; rewire the loser. Until then, operators must set both.
4. **`OKORO_SIGNING_PUBLIC_KEY` added to `infra/railway/api.service.json`** envVars list — currently missing; without it the API throws at boot.
5. **Full SHA pins on every third-party action** in `.github/workflows/security.yml` (and the lighter pins in `release.yml`).
6. **Deletion of `infra/railway/okoro-api.json`** — legacy descriptor with wrong `healthcheckPath`.
7. **Decision on `DATABASE_DIRECT_URL`** — either add `directUrl` to `schema.prisma` and the Zod schema, or remove the env var from descriptors so it doesn't mislead operators.
8. **`vercel.ts`** for the dashboard — only if Vercel is the chosen target. Lock framework + Node + Root Directory.
9. **OTel SDK bootstrap module** — if `OTEL_*` env vars are documented in service descriptors, something must consume them. Either ship the bootstrap or remove the vars until the module lands.
10. **Reconciliation of pnpm/Node versions across CI workflows** — pin everything to one version pair (currently 9.12.3 / 20.11.0 in CI; 9.15.0 / 22.11.0 in release).

---

## 12. Concrete blocker list — first deploy

Ordered by what stops the deploy first:

| # | Blocker                                                                           | Fix surface                          |
| - | --------------------------------------------------------------------------------- | ------------------------------------ |
| **B1** | No Prisma migrations exist. `migrate deploy` runs but applies nothing; queries fail. | Generate baseline migration; commit. |
| **B2** | `OKORO_SIGNING_PUBLIC_KEY` not in Railway descriptor; `wellknown.service` throws at boot. | Add to `infra/railway/api.service.json` and Railway dashboard. |
| **B3** | API boot also throws (in production) if `AUDIT_ED25519_*` not set. The descriptor includes them, so this is operator-set. | Set in Railway dashboard before first deploy. |
| **B4** | Worker service has no entrypoint (`apps/api/src/workers/main.ts` missing). | Either ship the bootstrap or skip the worker service for the first deploy and run BullMQ in-process inside the API. |
| **B5** | `infra/railway/okoro-api.json` has wrong healthcheck path (`/health`). If an operator links that descriptor, deploy goes unhealthy. | Delete the file. |
| **B6** | Audit signing key naming collision means operator must set the same key under two names; easy to mis-set. | Document explicitly OR consolidate names. |

Non-blockers but strongly-suggested-before-first-deploy:

- Replace SHA-pin placeholders in `security.yml`.
- Set `CORS_ORIGINS` to something other than `*` in production.
- Set `ENABLE_SWAGGER=false` (descriptor says so, ensure it sticks).

---

## 13. Suggested ordering for going live

### Stage 1 — Repo prep (no platform interaction yet)
1. Generate Prisma baseline migration (B1). Commit.
2. Decide audit-key consolidation (B6). Patch `audit.service.ts` or
   `wellknown.service.ts` to read from the canonical name. Update
   `.env.example` and railway descriptors.
3. Add `OKORO_SIGNING_PUBLIC_KEY` to `api.service.json` envVars (B2)
   if collision is left in place.
4. Delete `infra/railway/okoro-api.json` (B5).
5. Decide worker-deploy strategy (B4):
   - **Option A** (faster to ship): comment out the worker service
     in the Railway plan; run BullMQ inside the API process.
   - **Option B** (proper): ship `apps/api/src/workers/main.ts`,
     compile, deploy worker service.
6. SHA-pin third-party actions in `security.yml`.

### Stage 2 — Infra provisioning (Railway)
1. Provision `okoro-pg` (Postgres 16 plugin OR Neon).
2. Provision `okoro-redis` (Redis 7 plugin OR Upstash).
3. Generate prod keypairs via `scripts/generate-okoro-keys.ts --env`.
4. Set env vars on `okoro-api` per `infra/railway/api.service.json`,
   plus `OKORO_SIGNING_PUBLIC_KEY` (= `AUDIT_ED25519_PUBLIC_KEY_B64`
   value until collision resolved).
5. `railway up --service okoro-api` — first deploy runs `prisma
   migrate deploy` against the empty Postgres, creating the schema.

### Stage 3 — Health gates
1. Run the 6 verification commands from `infra/railway/README.md` § 5
   (live, ready, jwks.json, audit-signing-key, swagger=404).
2. Confirm `prisma migrate status` shows the baseline applied.
3. Confirm Stripe webhook receives a test event end-to-end (only
   relevant if billing flow is in scope for first deploy).

### Stage 4 — Worker (if Option B chosen)
1. `railway up --service okoro-worker`.
2. Watch logs for "queue.*ready / worker.*started".
3. Trigger a BATE signal ingestion; confirm score recompute.

### Stage 5 — Dashboard (Vercel)
1. Create Vercel project; Root Directory = `apps/dashboard`.
2. Set `NEXT_PUBLIC_API_URL` to the Railway API URL.
3. First preview deploy. Click through.
4. Promote to prod.

### Stage 6 — Edge (LATER — gated)
1. **Do not deploy `cf-verify` in Phase 1.** The deploy script is
   intentionally bricked. Revisit when Phase 3 unlocks (revenue gate
   per `OPERATOR_DECISIONS.md` / `WORK_BOARD.md`).

---

## 14. Per-platform readiness rating (summary)

| Platform                          | Rating               | Top-1 reason                                                                    |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| **Railway — `okoro-api`**         | YELLOW (close)       | No Prisma migrations + `OKORO_SIGNING_PUBLIC_KEY` not in descriptor.             |
| **Railway — `okoro-worker`**      | RED                  | Entry point `dist/workers/main.js` does not exist; container crash-loops.       |
| **Railway — Postgres / Redis**    | GREEN                | Standard managed plugins; init script + tuning notes documented.                 |
| **Cloudflare — cf-verify**        | GREEN-as-locked      | Deploy is sealed; README documents unlock path. No Phase-1 action needed.        |
| **Vercel — dashboard**            | YELLOW               | Works out of the box; missing platform config (`vercel.ts`) and auth.            |
| **CI — ci.yml**                   | GREEN                | All gates green-by-construction; one drift to clean up before next maintenance.  |
| **CI — security.yml**             | YELLOW               | Placeholder SHA pins + workflow permissions are correctly scoped.                |
| **CI — release.yml**              | YELLOW               | pnpm/Node version drift from rest of repo.                                       |
| **Docker images**                 | GREEN                | Multi-stage, distroless, non-root, healthcheck OK.                               |

---

## Appendix A — files referenced

- `/Users/money/Desktop/OKORO/README.md`
- `/Users/money/Desktop/OKORO/CLAUDE.md`
- `/Users/money/Desktop/OKORO/docs/RUNBOOK.md`
- `/Users/money/Desktop/OKORO/docs/ARCHITECTURE.md`
- `/Users/money/Desktop/OKORO/docs/SESSION_HANDOFF.md`
- `/Users/money/Desktop/OKORO/OPERATOR_DECISIONS.md`
- `/Users/money/Desktop/OKORO/package.json`
- `/Users/money/Desktop/OKORO/pnpm-workspace.yaml`
- `/Users/money/Desktop/OKORO/pnpm-lock.yaml`
- `/Users/money/Desktop/OKORO/railway.json`
- `/Users/money/Desktop/OKORO/.env.example`
- `/Users/money/Desktop/OKORO/.dockerignore`
- `/Users/money/Desktop/OKORO/apps/api/package.json`
- `/Users/money/Desktop/OKORO/apps/api/src/main.ts`
- `/Users/money/Desktop/OKORO/apps/api/src/config/config.schema.ts`
- `/Users/money/Desktop/OKORO/apps/api/src/config/config.service.ts`
- `/Users/money/Desktop/OKORO/apps/api/src/modules/health/health.controller.ts`
- `/Users/money/Desktop/OKORO/apps/api/src/modules/wellknown/wellknown.service.ts`
- `/Users/money/Desktop/OKORO/apps/api/src/modules/audit/audit.service.ts`
- `/Users/money/Desktop/OKORO/apps/api/prisma/schema.prisma`
- `/Users/money/Desktop/OKORO/apps/api/prisma/migrations/` (empty)
- `/Users/money/Desktop/OKORO/apps/dashboard/package.json`
- `/Users/money/Desktop/OKORO/apps/dashboard/next.config.ts`
- `/Users/money/Desktop/OKORO/workers/cf-verify/package.json`
- `/Users/money/Desktop/OKORO/workers/cf-verify/wrangler.toml`
- `/Users/money/Desktop/OKORO/workers/cf-verify/src/index.ts`
- `/Users/money/Desktop/OKORO/workers/cf-verify/README.md`
- `/Users/money/Desktop/OKORO/infra/docker/Dockerfile.api`
- `/Users/money/Desktop/OKORO/infra/docker/Dockerfile.worker`
- `/Users/money/Desktop/OKORO/infra/docker/healthcheck.sh`
- `/Users/money/Desktop/OKORO/infra/railway/api.service.json`
- `/Users/money/Desktop/OKORO/infra/railway/worker.service.json`
- `/Users/money/Desktop/OKORO/infra/railway/postgres.service.json`
- `/Users/money/Desktop/OKORO/infra/railway/redis.service.json`
- `/Users/money/Desktop/OKORO/infra/railway/okoro-api.json` (legacy — recommend deletion)
- `/Users/money/Desktop/OKORO/infra/railway/README.md`
- `/Users/money/Desktop/OKORO/.github/workflows/ci.yml`
- `/Users/money/Desktop/OKORO/.github/workflows/security.yml`
- `/Users/money/Desktop/OKORO/.github/workflows/release.yml`
