# Deploy pipeline — operator setup

This directory holds the **smoke-gate scripts** that CI runs after every
push-to-main deploy. The deploy itself is driven by:

- `.github/workflows/deploy-api.yml` — Railway (API + worker)
- `.github/workflows/deploy-vercel.yml` — Vercel (dashboard + docs)

Both workflows are triggered by **CI succeeding on main** (`workflow_run`
event). Push-to-main is the only deploy trigger; `workflow_dispatch` is the
manual escape hatch.

## One-time operator setup

Configure these secrets in GitHub → Settings → Secrets and variables →
Actions → Repository secrets. None of them can be derived from code; the
workflow exits early with `::notice::` if a required one is missing.

### Railway (API + worker)

| Secret                          | Source                                                              | Required |
|---------------------------------|---------------------------------------------------------------------|----------|
| `RAILWAY_TOKEN`                 | Railway dashboard → Project → Settings → Tokens → New project token | yes      |
| `RAILWAY_API_SERVICE_ID`        | Railway dashboard → aegis-api service → Settings → Service ID       | yes      |
| `RAILWAY_WORKER_SERVICE_ID`     | Railway dashboard → aegis-worker service → Settings → Service ID    | yes      |
| `DEPLOY_API_BASE_URL`           | The public production hostname (e.g. `https://api.aegislabs.io`)    | yes      |

The Railway service-level env vars (`DATABASE_URL`, `JWT_ED25519_*`,
`AUDIT_ED25519_*`, etc.) are owned by the **Railway dashboard**, not by
GitHub secrets. See `infra/railway/README.md` § 2–3 for the one-time
provisioning steps.

### Vercel (dashboard + docs)

| Secret                          | Source                                                          | Required |
|---------------------------------|-----------------------------------------------------------------|----------|
| `VERCEL_TOKEN`                  | vercel.com → Settings → Tokens → Create                         | yes      |
| `VERCEL_ORG_ID`                 | vercel.com → Settings → General → Team ID                       | yes      |
| `VERCEL_DASHBOARD_PROJECT_ID`   | Dashboard project → Settings → General → Project ID             | yes      |
| `VERCEL_DOCS_PROJECT_ID`        | Docs project → Settings → General → Project ID                  | yes      |
| `DASHBOARD_URL`                 | Production alias for the dashboard (e.g. `https://app.aegislabs.io`) | yes |
| `DOCS_URL`                      | Production alias for docs (e.g. `https://docs.aegislabs.io`)    | yes      |

Vercel project-level env vars (`AEGIS_API_BASE_URL`, `NEXT_PUBLIC_DOCS_URL`,
Auth0 keys, etc.) are owned by the **Vercel dashboard**, not by GitHub
secrets. `vercel pull --environment=production` in CI reads them.

### Shared

| Secret                      | Source                                                  | Required |
|-----------------------------|---------------------------------------------------------|----------|
| `DEPLOY_NOTIFY_WEBHOOK_URL` | Slack or Discord incoming webhook URL                   | no       |

Without it, rollbacks still happen — they just don't page anyone. Strongly
recommended for prod.

## How the pipeline behaves

1. Developer merges PR to `main`.
2. CI (`.github/workflows/ci.yml`) runs lint + typecheck + tests + e2e + build.
3. **On CI success**, both deploy workflows trigger in parallel:
   - `deploy-api.yml` deploys API then worker to Railway.
   - `deploy-vercel.yml` deploys dashboard and docs to Vercel (matrix).
4. Each app runs its own smoke gate (`scripts/deploy/smoke-*.sh`).
5. **On smoke failure**, that app rolls back to the previous deployment
   automatically. The deploy workflow run is still red, so the on-call
   sees it on the GitHub status badge.
6. **On smoke success**, `deploy-api.yml` fires a `repository_dispatch`
   event named `deployed-staging` — that triggers `audit-chain-integrity.yml`
   to verify the audit chain against the just-deployed API.

## Smoke gate scope

`smoke-api.sh` gates: liveness, readiness, JWKS, audit-signing-key,
pricing.json, Swagger-off-in-prod, verify-rejects-unauth. Latency budgets
per endpoint. Adding a gate is one line; see the script header.

`smoke-vercel.sh` gates per-app:
- **dashboard**: landing, login route, pricing route, 404 sanity.
- **docs**: landing, /docs, sitemap, robots, llms.txt + content check, 404.

If a new customer-visible route ships, **add it to the smoke gate**. The
gate is the contract between "deployed" and "serving."

## Running smoke locally

```sh
# Against staging:
API=https://staging.api.aegislabs.io bash scripts/deploy/smoke-api.sh

# Against a Vercel preview URL:
TARGET=https://aegis-docs-git-foo-klytics.vercel.app APP=docs \
  bash scripts/deploy/smoke-vercel.sh
```

Useful for verifying a rollback target before redeploying forward.

## Emergency: skip smoke

`deploy-api.yml` has a `workflow_dispatch` input `skip_smoke: true`. Only
use it when you know the smoke gate is wrong (e.g. you just renamed an
endpoint and forgot to update the gate). It bypasses rollback, so the new
deploy becomes prod regardless of correctness.

Document any skip-smoke usage in `docs/SESSION_HANDOFF.md` so the next
on-call can see what was bypassed and why.

## Failure-mode quick reference

| Symptom                                | Cause                                    | Fix                                           |
|----------------------------------------|------------------------------------------|-----------------------------------------------|
| "Pre-deploy gate" job skipped          | CI failed on main, or branch != main     | Fix CI; re-merge.                             |
| Railway "API deploy timed out"         | Build > 10min (rare) or Railway outage   | Check Railway status; re-run workflow.        |
| Smoke gate `/v1/health/ready` 503      | DB or Redis env var wrong on Railway     | `railway run --service aegis-api -- env`      |
| Smoke gate `/docs` returned 200        | `ENABLE_SWAGGER=true` in prod            | Flip env var on Railway dashboard; redeploy.  |
| Vercel deploy step "non-zero exit 1"   | Project not linked or wrong project ID   | Re-verify `VERCEL_*_PROJECT_ID` secrets.      |
| Rollback "non-zero" warning            | First-ever deploy — no rollback target   | Expected; ignore.                             |
| `repository_dispatch` not firing       | API-deploy smoke gate didn't pass        | Audit-chain-integrity is intentionally gated. |

## Why not Vercel's GitHub auto-deploy

Vercel's built-in GitHub integration auto-deploys on push, *in parallel*
with CI. That would let a deploy ship while CI is still red. By calling
the Vercel CLI from CI after CI passes, we keep deploy CI-gated and
atomic per-app.

If you must use Vercel's auto-deploy (e.g. for preview URLs on PRs), keep
it on for previews only — disable production deploys on the Vercel side
so this workflow is the single source of prod deploys.
