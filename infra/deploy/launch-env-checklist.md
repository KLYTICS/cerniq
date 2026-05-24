# CERNIQ — Launch Env-Var Checklist

> **Owner**: Operator (Erwin) at deploy time.
> **Use**: Tick each row as the value is set in the target environment.
> **Canonical schema**: `apps/api/src/config/config.schema.ts` (any new var goes there first).
> **Surface guide**: see `.env.example` for dev-time documentation of every var.

This is the operator's per-target inventory: which secret goes into Railway, which into Vercel, which into GitHub Actions, which into the local CLI bootstrap. Built from a direct scan of `apps/api/src/config/config.schema.ts` and `process.env` references in `apps/api/` and `apps/dashboard/` on 2026-05-24.

---

## Legend

- `P0` = boot fails without it (or business feature broken)
- `P1` = recommended for prod hardening
- `P2` = optional / dev-only

---

## A. Railway → `cerniq-api` service

### A.1 — P0 runtime

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `NODE_ENV=production` | hard-set | gates dev-time defaults, refuses dev KMS |
| `PORT=4000` | hard-set | Railway maps this; do not override unless you also change the healthcheck |
| `LOG_LEVEL=info` | hard-set | `debug` is OK for first 24h then dial down |
| `API_BASE_URL=https://api.cerniq.io` | hard-set | used by Swagger + Stripe redirect URLs |
| `DATABASE_URL` | Railway PG plugin → autoset | Use `${{Postgres.DATABASE_URL}}` shared-var syntax |
| `REDIS_URL` | Railway Redis plugin → autoset | Same pattern |

### A.2 — P0 crypto (audit chain + JWT)

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `CERNIQ_SIGNING_PRIVATE_KEY` | `pnpm tsx scripts/generate-cerniq-keys.ts` | Ed25519 audit-chain key. Paste into Railway Variables. NEVER on disk. |
| `CERNIQ_SIGNING_PUBLIC_KEY` | same script | Published via `/.well-known/audit-signing-key`. |
| `CERNIQ_SIGNING_KEY_ROTATED_AT` | ISO-8601 timestamp | Now if first deploy; updated quarterly per `infra/kms/rotation-runbook.md`. |
| `JWT_ED25519_PRIVATE_KEY_B64` | same script | Distinct keypair for agent capability JWT signing. |
| `JWT_ED25519_PUBLIC_KEY_B64` | same script | Public companion. |
| `CERNIQ_WEBHOOK_SECRET_DEK_B64` | `openssl rand -base64 32` | 32-byte AES-256-GCM DEK wrapping webhook subscription secrets at rest. Boot fails-loud in prod without it. |

### A.3 — P0 auth (Auth0)

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `AUTH0_DOMAIN` | Auth0 dashboard → Settings | e.g. `cerniq.us.auth0.com` |
| `AUTH0_ISSUER` | derived | `https://${AUTH0_DOMAIN}/` (trailing slash required by Auth0 `iss` claim) |
| `AUTH0_AUDIENCE` | API audience identifier you set in Auth0 | e.g. `https://api.cerniq.io` |
| `AUTH0_ACTION_SECRET` | shared HMAC secret between Auth0 Action and API | 32 random bytes hex; rotate yearly |
| `AUTH0_REQUIRED=true` | hard-set | Refuses unauthenticated dashboard requests in prod |

### A.4 — P0 billing (Stripe — full ladder per OD-003)

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe dashboard → API keys (live mode) | `sk_live_…` — restricted key with minimum scopes preferred |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint config | `whsec_…` — must match the `/v1/billing/webhook` endpoint signing secret |
| `STRIPE_PRICE_DEVELOPER` | Stripe product → price | $49/mo recurring, ADR-0014 |
| `STRIPE_PRICE_GROWTH` ⚠️ | Stripe product → price | Maps to TEAM tier ($299) per ADR-0014. **DRIFT WARNING**: schema name is `GROWTH`, customer-visible name is `TEAM`. Do not rename until enum migration lands — see CLAUDE.md "PlanTier naming still has a dashboard/API boundary". |
| `STRIPE_PRICE_SCALE` ⚠️ | Stripe product → price | $1,499/mo per ADR-0014. **SCHEMA GAP**: `config.schema.ts` does NOT declare this var. It must be added before Stripe wiring is complete. **TODO before launch.** |
| `STRIPE_PRICE_ENTERPRISE` | Stripe product → price | Custom-quote; usually a placeholder price for invoicing |
| `STRIPE_PRICE_OVERAGE_VERIFY` | metered Stripe price | $0.0008/verify per OD-003 |
| `STRIPE_CHECKOUT_SUCCESS_URL` | `https://app.cerniq.io/billing/success` | Post-checkout redirect |
| `STRIPE_CHECKOUT_CANCEL_URL` | `https://app.cerniq.io/billing/cancel` | Cancelled-checkout redirect |
| `STRIPE_PORTAL_RETURN_URL` | `https://app.cerniq.io/billing` | Stripe customer-portal exit |

### A.5 — P1 hardening

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `API_KEY_BCRYPT_COST=12` | hard-set | 12 in prod, 4 in tests only |
| `CORS_ORIGINS` | hard-set | `https://app.cerniq.io,https://docs.cerniq.io` — never `*` in prod |
| `CERNIQ_ADMIN_TOKEN` | `openssl rand -hex 32` | Used for `/ready` admin probe and rare break-glass admin endpoints |
| `CERNIQ_KMS_PROVIDER=in-memory` | hard-set for v1 | Migration path to `aws`/`gcp`/`vault` is documented in `infra/kms/README.md` |

### A.6 — P1 observability

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `CERNIQ_OTEL_ENABLED=true` | hard-set after CVE story decided | OD-021: real OTel exposure is low because exporter is internal-only |
| `CERNIQ_OTEL_SERVICE_NAME=cerniq-api` | hard-set | |
| `CERNIQ_OTEL_EXPORTER=otlp-http` | hard-set | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | your collector URL | e.g. Tempo, Honeycomb, DataDog, Vercel Otel |
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=prod,service.namespace=cerniq` | |
| `CERNIQ_REGION` | `us-east-1` (matches Railway region) | Stamps every span/log |
| `SENTRY_DSN` | Sentry project DSN | Leave blank to disable error reporting |

### A.7 — P1 build identity

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `CERNIQ_VERSION` | CI workflow injects `${{ github.ref_name }}` | Surfaces at `GET /health/version` for blue-green confirmation |
| `GIT_SHA` | CI workflow injects `${{ github.sha }}` | |
| `BUILD_AT` | CI workflow injects build timestamp | |

### A.8 — P1 feature flags (review before flip)

| Var | Default | Recommended for launch |
| --- | --- | --- |
| `ENABLE_BATE=true` | true | true (BATE scorer kernel shipped) |
| `ENABLE_WEBHOOKS=true` | true | true (M-008 stub + delivery) |
| `ENABLE_SWAGGER=true` | true | **false** for prod (don't expose internal API schema; toggle on per debug session) |
| **`BILLING_LADDER_ENABLED=false`** | false | **false** for launch (Path C — flip after first paying beta customer completes a full checkout smoke). Gates /v1/billing/checkout server-side. |
| `CERNIQ_DPOP_REQUIRED=false` | false | false — flip ON after client-side proof rollout per [ADR](docs/decisions/) |
| `CERNIQ_HYBRID_PQ_ENABLED=false` | false | false — gated on OD-014 triggers |
| `CERNIQ_POLICY_ENGINES=builtin` | builtin | builtin (Cedar/OPA opt-in per principal per OD-013) |
| `THROTTLE_VERIFY_PER_MIN=1000` | 1000 | per-tier override applied at runtime via @nestjs/throttler |
| `THROTTLE_DEFAULT_PER_MIN=120` | 120 | |

---

## B. Railway → `cerniq-worker` service

Inherits all of A.1–A.7 from shared variables.

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `CERNIQ_AUDIT_RETENTION_INTERVAL_MS` | optional | Default in-code; only override for ops experiment |
| `CERNIQ_ONBOARDING_BACKFILL_CRON` | optional | BullMQ cron for `PrincipalOnboarding` rollups; default in-code |

---

## C. Vercel → `cerniq-dashboard` project

Note: `apps/dashboard` is not yet wired with the Auth0 v4 SDK per CLAUDE.md. Until M-020 fully lands, the dashboard reads an **operator-pinned API key** rather than per-user Auth0 sessions. Set up both sets of vars so the flip is one toggle, not a redeploy.

### C.1 — P0 backend coordinates

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `CERNIQ_API_BASE_URL=https://api.cerniq.io/v1` | hard-set | Server-side fetcher target (SSR pages, server actions) |
| `NEXT_PUBLIC_API_URL=https://api.cerniq.io` | hard-set | Client-side `fetch` from React components (rare; mostly server) |
| `CERNIQ_API_URL=https://api.cerniq.io` | hard-set | Legacy alias still referenced in some routes — DRIFT, keep populated until cleaned up |

### C.2 — P0 operator-pinned API key (until Auth0 lands per-user)

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `CERNIQ_DASHBOARD_PRINCIPAL_ID` | from your operator principal record | Created during seed-demo on first API boot |
| `CERNIQ_DASHBOARD_API_KEY` | scope=FULL key generated for the operator principal | Generate via `POST /v1/auth/api-keys` once API is live |
| `CERNIQ_DASHBOARD_EMAIL` | operator email | Logged for audit |

### C.3 — P0 Auth0 (M-020 LANDED — per `feat/auth0-dashboard-v1` branch)

> **State**: Auth0 v4 SDK installed in `apps/dashboard`. `lib/auth0.ts` instantiates the client, `middleware.ts` mounts routes + gates protected pages, `lib/auth.ts` reads real Auth0 sessions when AUTH0_REQUIRED=true (falls back to operator-pinned key otherwise). Path C launch posture per [LAUNCH.md §6](../../LAUNCH.md#6-dashboard--vercel).

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `AUTH0_REQUIRED=true` | hard-set | Activates Auth0 mode. With it false, dashboard stays in operator-pinned mode. |
| `AUTH0_DOMAIN` | Auth0 dashboard → Settings → Basic information | e.g. `cerniq.us.auth0.com` (no scheme, no trailing slash) |
| `AUTH0_CLIENT_ID` | Auth0 dashboard → app → settings | Regular Web Application |
| `AUTH0_CLIENT_SECRET` | Auth0 dashboard → app → settings | Marked sensitive in Vercel |
| `AUTH0_BASE_URL=https://app.cerniq.io` | hard-set | The dashboard's external origin |
| `AUTH0_SECRET` | `openssl rand -hex 32` | 32-byte cookie encryption secret per Auth0 v4 SDK |
| `AUTH0_AUDIENCE=https://api.cerniq.io` | same as A.3 | The API identifier set in Auth0's APIs section |

#### C.3.1 — Auth0 tenant setup (operator one-time)
1. In Auth0 dashboard, create an Application (Regular Web App) and an API.
2. Application → Settings → Allowed Callback URLs: `https://app.cerniq.io/api/auth/callback`.
3. Application → Settings → Allowed Logout URLs: `https://app.cerniq.io`.
4. Application → Settings → Allowed Web Origins: `https://app.cerniq.io`.
5. Deploy the Auth0 Action at [`infra/auth0/actions/cerniq-audit-login.js`](../auth0/actions/cerniq-audit-login.js) (Login post-trigger).
6. The Action must populate `user_metadata.cerniq_api_key` and the `https://cerniq.io/principal_id` custom claim per `lib/auth.ts` readers.

### C.4 — P1 Stripe (publishable side)

| Var | Source / how to set | Notes |
| --- | --- | --- |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` from Stripe dashboard | Embedded in checkout flow |
| `NEXT_PUBLIC_BILLING_LADDER_ENABLED=false` | hard-set | Dashboard reads this to hide upgrade CTAs. Pair with API's `BILLING_LADDER_ENABLED`. Flip both together. |

---

## D. GitHub Actions secrets

### D.1 — Publishing (only when G-PUBLISH unblocks per OD-023)

| Secret | Used by | Notes |
| --- | --- | --- |
| `NPM_TOKEN` | `.github/workflows/release.yml` | npm automation token, publish scope on `@cerniq` |
| `PYPI_TRUSTED_PUBLISHER` | `.github/workflows/release-sdk-py.yml` | OIDC — no token needed once trusted publisher is configured at PyPI |
| `HOMEBREW_TAP_TOKEN` | goreleaser → KLYTICS/homebrew-cerniq | GH PAT with `repo` scope on the tap repo |

### D.2 — Audit + alerting

| Secret | Used by | Notes |
| --- | --- | --- |
| `SLACK_INCIDENT_WEBHOOK` | `.github/workflows/audit-chain-integrity.yml`, gitleaks, semgrep | Incoming webhook URL for #incidents |
| `CERNIQ_PROD_API_KEY` | `.github/workflows/audit-chain-integrity.yml` | Read-only API key for production audit chain spot-check |

### D.3 — Deploy hooks (optional)

| Secret | Used by | Notes |
| --- | --- | --- |
| `RAILWAY_TOKEN` | only if you wire CD via Actions | Otherwise `railway up` from local is fine |
| `VERCEL_TOKEN` | optional CD | Otherwise `vercel deploy` from local is fine |

---

## E. Operator-only (local laptop)

Never go on a server. Stored in `~/.config/cerniq/` or your password manager.

| Var | Notes |
| --- | --- |
| `RAILWAY_TOKEN` | from `railway login`, cached in `~/.railway/config.json` |
| `VERCEL_TOKEN` | from `vercel login`, cached in `~/.vercel/auth.json` |
| `gh auth login` | for repo + PR + secrets management |
| `~/.npmrc` automation token | for `pnpm changeset publish` if running locally |
| Stripe restricted key | with limited scopes for local testing |
| Production `.env.production` | **NEVER COMMITTED** — only ever pasted into Railway/Vercel UI |

---

## F. Known launch-blocking gaps (must close before §10 sign-off)

1. **`config.schema.ts` is missing `STRIPE_PRICE_SCALE`** — the schema declares `STRIPE_PRICE_DEVELOPER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_ENTERPRISE`, `STRIPE_PRICE_OVERAGE_VERIFY` but not `STRIPE_PRICE_SCALE`. Without it, the SCALE tier ($1,499 per ADR-0014) cannot be priced. **Fix**: add to schema + Stripe service + tests. ~10 LOC. Tracks as a launch-prerequisite work item.

2. **Dashboard reads both `CERNIQ_API_BASE_URL` and `CERNIQ_API_URL`** — drift. The canonical name per `.env.example` is `CERNIQ_API_BASE_URL`. The legacy alias `CERNIQ_API_URL` is still referenced in some dashboard routes. **Fix**: grep + canonicalize. ~5 LOC. Or document both during the launch and clean up post-launch.

3. **Auth0 v4 SDK not installed in dashboard** — ✅ RESOLVED on `feat/auth0-dashboard-v1` branch. Path C wiring: SDK installed, routes mounted at `/api/auth/*`, dual-mode `lib/auth.ts` (Auth0 when configured, operator-pinned otherwise). Operator still needs to provision the Auth0 tenant + deploy the Action + populate the env quartet.

4. **API direct `process.env` reads bypass Zod validation** — `CERNIQ_ADMIN_TOKEN`, `CERNIQ_AUDIT_RETENTION_INTERVAL_MS`, `CERNIQ_ONBOARDING_BACKFILL_CRON`, `CERNIQ_OTEL_*`, `CERNIQ_REGION`, `LOAD_TEST`, `HOSTNAME`. **Not blocking** but a future cleanup: move these into `config.schema.ts` so misconfiguration fails-loud at boot rather than at first reference.

5. **`AUDIT_ED25519_*` legacy aliases still accepted** — `.env.example` warns these are deprecated and will be removed in v0.2. **Not blocking** for launch but Stripe-billing/Audit-signing tests must use the canonical `CERNIQ_SIGNING_*` names only.

---

## G. Sign-off

```text
A. Railway cerniq-api populated:      ☐
B. Railway cerniq-worker populated:   ☐
C. Vercel dashboard populated:        ☐
D. GitHub Actions secrets populated:  ☐
F. Gaps F.1, F.3 closed:              ☐ (F.2, F.4, F.5 deferred OK)
```

_Last updated: 2026-05-24 (launch-readiness branch). Sourced from `config.schema.ts`, `.env.example`, and direct `process.env` grep over `apps/api` + `apps/dashboard`._
