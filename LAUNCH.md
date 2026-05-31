# CERNIQ — Launch Runbook

> **Audience**: Operator (Erwin) executing the first production launch.
> **Scope**: All 8 surfaces — API, docs, dashboard, sdk-ts, sdk-py, cli, mcp-server, mcp-bridge.
> **Status**: Living document. Update statuses inline as gates pass. Do not delete history.

This is the single ordered playbook to take CERNIQ from "code green locally" to "all surfaces live, enterprise-quality". Every step links to a deeper doc; this file owns the **sequence and gate state**, not the detail.

---

## 0. Go/No-go snapshot

Tick each row when the prerequisite is in place. Launch proceeds only when every P0 is green.

| ID | Decision | Status | Source |
| --- | --- | --- | --- |
| **G-AUTH0** | Auth0 tenant created, env vars in hand | ☐ in progress (operator wiring) — SDK + dashboard code landed in `feat/auth0-dashboard-v1` | [CREDENTIALS_BOOTSTRAP §2](docs/CREDENTIALS_BOOTSTRAP.md), [infra/auth0/README.md](infra/auth0/README.md) |
| **G-KMS** | Env-var keys (v1 default), real KMS post-launch | ☑ accepted | [OPERATOR_DECISIONS OD-014](OPERATOR_DECISIONS.md) |
| **G-STRIPE** | Full tier ladder Free/Dev/Team/Scale (Path C: dark behind `BILLING_LADDER_ENABLED=false` at launch) | ☐ price IDs needed; ladder flag landed in `feat/auth0-dashboard-v1` | [OPERATOR_DECISIONS OD-003](OPERATOR_DECISIONS.md), [04_COMMERCIAL_STRATEGY](docs/spec/04_COMMERCIAL_STRATEGY.md) |
| **G-PUBLISH** | npm/PyPI/brew secrets wired | ☐ deferred per operator (env wiring first) | [OPERATOR_DECISIONS OD-023](OPERATOR_DECISIONS.md) |
| **G-DOMAIN** | `api.cerniq.io`, `app.cerniq.io`, `docs.cerniq.io` DNS routes | ☐ docs.cerniq.io = [OD-022](OPERATOR_DECISIONS.md) | DNS console |
| **G-OD024** | OD-024 Phase A2-A3 merged to main | ☐ in flight (peer session) | branch `feat/od-024-phase-a2-a3` |
| **G-OD021** | OTel CVE accepted in audit-config OR v2 migration landed | ☑ accept-default | [OPERATOR_DECISIONS OD-021](OPERATOR_DECISIONS.md) |
| **G-PRODCHECK** | All P0 rows in [PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) green | ☐ | [PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) |

**Launch authorization**: P0 gates green → operator signs §10 below.

---

## 1. Surface map and deploy targets

| # | Surface | Deploy target | Public URL (planned) | Status | Sub-runbook |
| - | --- | --- | --- | --- | --- |
| 1 | `apps/api` | Railway | `api.cerniq.io` | code-green, not deployed | [§4 API](#4-api--railway) |
| 2 | `apps/docs` | Vercel | `cerniq.io`, `docs.cerniq.io` | ✅ `cerniq.io` live | [§5 Docs](#5-docs--vercel) |
| 3 | `apps/dashboard` | Vercel | `app.cerniq.io` | code-green, gated on Auth0 | [§6 Dashboard](#6-dashboard--vercel) |
| 4 | `packages/sdk-ts` | npm public | `@cerniq/sdk` | code-green, not published | [§7 SDK-TS](#7-sdk-ts--npm) |
| 5 | `packages/sdk-py` | PyPI | `cerniq` | code-green, not published | [§8 SDK-Py](#8-sdk-py--pypi) |
| 6 | `packages/cli` | GitHub Releases + brew | `cerniq` CLI | code-green, not packaged | [§9 CLI](#9-cli--github-releases) |
| 7 | `packages/mcp-server` | npm public | `@cerniq/mcp-server` | code-green, not published | [§7 SDK-TS](#7-sdk-ts--npm) (same wave) |
| 8 | `packages/mcp-bridge` | npm public | `@cerniq/mcp-bridge` | code-green, not published | [§7 SDK-TS](#7-sdk-ts--npm) (same wave) |

**Deploy ordering** is API → docs/dashboard → SDKs/CLI/MCP. SDKs and CLI publish AFTER the API is live so the install instructions are honest.

---

## 2. T-minus phases

### D-7 to D-3 — readiness
- [ ] OD-024 Phase A2-A3 merged to main (G-OD024)
- [ ] All [`pnpm doctor:full`](scripts/doctor.sh) green on main
- [ ] [PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) §§1-7 reviewed, P0 items addressed
- [ ] Auth0 tenant created — apps, callback URLs, Actions deployed per [`infra/auth0/README.md`](infra/auth0/README.md)
- [ ] Stripe products + prices created — Free/Dev/Team/Scale per [OD-003](OPERATOR_DECISIONS.md). Capture price IDs.
- [ ] Privacy + Terms drafted and published at `cerniq.io/privacy` and `cerniq.io/terms`
- [ ] Status-page hosting decision (OD-007). Recommendation: self-hosted dashboard route `status.cerniq.io`

### D-3 to D-1 — provisioning
- [ ] Railway project linked: `railway link` per [`infra/railway/README.md`](infra/railway/README.md)
- [ ] Production keypairs generated: `pnpm tsx scripts/generate-cerniq-keys.ts` — keys go to Railway Variables only, never disk
- [ ] Vercel project linked for dashboard: `vercel link` from `apps/dashboard/`
- [ ] DNS records prepared (not pointed yet): A/CNAME for `api.`, `app.`, `docs.cerniq.io`
- [ ] All env vars staged in Railway and Vercel — see [`infra/deploy/launch-env-checklist.md`](infra/deploy/launch-env-checklist.md)
- [ ] Slack incident webhook configured in GitHub Secrets (`SLACK_INCIDENT_WEBHOOK`)
- [ ] Audit chain integrity workflow tested in staging: `.github/workflows/audit-chain-integrity.yml`

### D-0 — go live
- Execute §§4-9 sub-runbooks in order, gate on smoke at each step. See [`scripts/launch-smoke.sh`](scripts/launch-smoke.sh).

### D+1 to D+7 — observation
- 24h monitoring rotation. p99 < 200ms, error rate < 1%, audit chain integrity job green.
- First customer/beta-user onboarding via [`BETA_ONBOARDING_RUNBOOK.md`](docs/BETA_ONBOARDING_RUNBOOK.md)
- Post-launch retro logged in `docs/SESSION_HANDOFF.md`

---

## 3. Pre-flight gate (mandatory before §4)

Run this gate on `main` from the canonical worktree. Every red item is a hard stop.

```sh
# 1. Branch + tree state
git status --short --branch                     # clean tree on main expected
git log --oneline -5                             # confirm OD-024 Phase A2-A3 has landed

# 2. Workspace health
pnpm install --frozen-lockfile
pnpm doctor:full                                 # green on every workspace
pnpm test:parity                                 # cross-package contract gate
pnpm check:openapi-zod                           # OpenAPI ↔ Zod schemas in sync
pnpm check:openapi-prisma                        # OpenAPI ↔ Prisma in sync
pnpm check:migrations                            # migrations immutable
pnpm audit --audit-level high --prod             # 0 critical, 0 high (OD-021 accepted)

# 3. Build artifacts
pnpm -r build                                    # every publishable dist/ fresh

# 4. Publish dry-run (will NOT publish anything)
pnpm tsx scripts/publish-dry-run.ts              # validates registry-readiness
```

If any of the above is red, **stop**. Open an issue, fix on a branch, re-run the gate.

---

## 4. API — Railway

> **Detail doc**: [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) §2 (Database) + §3 (Railway).
> **Infra README**: [`infra/railway/README.md`](infra/railway/README.md)
> **Service descriptor**: [`infra/railway/api.service.json`](infra/railway/api.service.json)

### 4.1 Provision
```sh
railway link                                     # CERNIQ project
railway service list                             # expect: cerniq-api, cerniq-worker, cerniq-pg, cerniq-redis
```

### 4.2 Set required env vars (from [`infra/deploy/launch-env-checklist.md`](infra/deploy/launch-env-checklist.md))
```sh
railway variables --service cerniq-api --set NODE_ENV=production \
  --set DATABASE_URL=... \
  --set REDIS_URL=... \
  --set CERNIQ_SIGNING_PRIVATE_KEY=... \
  --set JWT_ED25519_PRIVATE_KEY_B64=... \
  --set AUTH0_DOMAIN=... AUTH0_AUDIENCE=... AUTH0_REQUIRED=true \
  --set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... \
  --set STRIPE_PRICE_FREE=... STRIPE_PRICE_DEV=... STRIPE_PRICE_TEAM=... STRIPE_PRICE_SCALE=... \
  --set CERNIQ_API_KEY_BCRYPT_COST=12
# Full list: infra/deploy/launch-env-checklist.md
```

### 4.3 Deploy
```sh
railway up --service cerniq-api --detach
railway logs --service cerniq-api --follow       # watch boot until "Listening on port 4000"
```

### 4.4 Migrate
```sh
railway run --service cerniq-api -- pnpm --filter @cerniq/api prisma migrate deploy
railway run --service cerniq-api -- pnpm --filter @cerniq/api prisma migrate status
```

### 4.5 Smoke
```sh
export CERNIQ_API_BASE=https://api.cerniq.io
scripts/launch-smoke.sh api                      # checks /v1/health, /v1/health/ready, /metrics, /.well-known/audit-signing-key
```

### 4.6 Rollback
```sh
railway deployments list --service cerniq-api
railway rollback --service cerniq-api --deployment <id>
```

Detailed rollback in [`docs/INCIDENT_RUNBOOK.md`](docs/INCIDENT_RUNBOOK.md) §5.

---

## 5. Docs — Vercel

> **Status**: `cerniq.io` already live. Only `docs.cerniq.io` subdomain pending (OD-022).

### 5.1 Add docs.cerniq.io subdomain
```sh
vercel domains add docs.cerniq.io --project cerniq-docs
# Point CNAME docs.cerniq.io → cname.vercel-dns.com in DNS
vercel certs issue docs.cerniq.io
```

### 5.2 Remove lychee exclude
Edit `.github/workflows/docs.yml` — remove `--exclude '^https://docs\.cerniq\.io'`. PR + merge.

### 5.3 Smoke
```sh
scripts/launch-smoke.sh docs                     # checks docs.cerniq.io/200 + lychee link-check
```

---

## 6. Dashboard — Vercel

> **Gated on**: Auth0 wired (G-AUTH0) and API live (§4).

### 6.1 Set Vercel env (production + preview)
Required vars (see [`infra/deploy/launch-env-checklist.md`](infra/deploy/launch-env-checklist.md) §Dashboard):
- `CERNIQ_API_BASE_URL=https://api.cerniq.io/v1`
- `NEXT_PUBLIC_CERNIQ_API_BASE_URL=https://api.cerniq.io/v1`
- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_BASE_URL=https://app.cerniq.io`
- `AUTH0_SECRET` (32 random bytes hex)
- `STRIPE_PUBLISHABLE_KEY`

```sh
cd apps/dashboard
vercel env add CERNIQ_API_BASE_URL production    # repeat for each var
```

### 6.2 Deploy
```sh
vercel deploy --prod
```

### 6.3 Smoke
```sh
scripts/launch-smoke.sh dashboard                # /login → /agents (empty state) → /policies → /audit
```

### 6.4 Add custom domain
```sh
vercel domains add app.cerniq.io
# DNS: CNAME app.cerniq.io → cname.vercel-dns.com
```

---

## 7. SDK-TS — npm

> **Gated on**: API live (§4) so install instructions are honest. NPM_TOKEN secret per [OD-023](OPERATOR_DECISIONS.md).

### 7.1 First-time setup (already done if changesets is wired)
```sh
pnpm add -Dw @changesets/cli
pnpm changeset init
# Edit .changeset/config.json: ignore = ["@cerniq/api","@cerniq/dashboard","@cerniq/cli","@cerniq/audit-verifier",
#                                       "@cerniq/eslint-config","@cerniq/tsconfig","@cerniq/scripts"]
# Public: @cerniq/sdk, @cerniq/types, @cerniq/verifier-rp, @cerniq/mcp-server, @cerniq/mcp-bridge
```

GitHub Actions secret needed: `NPM_TOKEN` (npm automation token with publish rights on `@cerniq` scope). Or use OIDC trusted publisher via [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

### 7.2 Cut release
```sh
pnpm changeset                                   # author the changeset (which packages, what kind of bump)
pnpm changeset version                           # bumps versions, regenerates CHANGELOGs
git commit -am "chore(release): version packages"
```

### 7.3 Publish
```sh
pnpm tsx scripts/publish-dry-run.ts              # MUST be green
pnpm -r build                                    # fresh dist/
pnpm changeset publish                           # publishes only the changed packages
git push --follow-tags
```

### 7.4 Smoke
```sh
scripts/launch-smoke.sh sdk-ts                   # npm view, npx happy path
```

---

## 8. SDK-Py — PyPI

> Use PyPI OIDC trusted publisher (no API token). Per [OIDC docs](https://docs.pypi.org/trusted-publishers/).

### 8.1 Configure trusted publisher
1. Log in to PyPI as the `cerniq` package maintainer.
2. Add a trusted publisher: GitHub Actions, repo `KLYTICS/cerniq`, workflow `.github/workflows/release-sdk-py.yml`, env `pypi`.

### 8.2 Bump version
Edit `packages/sdk-py/pyproject.toml` `version = "0.1.0"`. Commit.

### 8.3 Tag + release
```sh
git tag sdk-py-v0.1.0
git push --tags
# Workflow auto-builds, runs tests, publishes to PyPI
```

### 8.4 Smoke
```sh
scripts/launch-smoke.sh sdk-py                   # pip install cerniq, import test
```

---

## 9. CLI — GitHub Releases

> **Detail**: [OD-010](OPERATOR_DECISIONS.md) — Go single static binary via goreleaser.

### 9.1 Goreleaser config
Already at `packages/cli/.goreleaser.yaml` (if missing, see [`infra/deploy/goreleaser-template.yaml`](infra/deploy/goreleaser-template.yaml)).

### 9.2 Cut release
```sh
git tag cli-v0.1.0
git push origin cli-v0.1.0
# .github/workflows/release-cli.yml builds darwin/linux/windows × amd64/arm64,
# publishes to GitHub Releases, updates KLYTICS/homebrew-cerniq tap.
```

### 9.3 Smoke
```sh
scripts/launch-smoke.sh cli                      # brew install cerniq, cerniq doctor, cerniq login (device-code)
```

---

## 10. Sign-off

```text
Pre-flight gate (§3) PASS:               ☐
Production checklist P0 (§0.G-PRODCHECK): ☐
All surfaces smoke green (§§4-9):         ☐
Privacy + Terms live:                     ☐
Status page reachable:                    ☐
Incident webhook tested:                  ☐
24h monitoring rotation scheduled:        ☐

Engineering lead:     ____________________   Date: ___________
Operator (Erwin):     ____________________   Date: ___________
```

---

## 11. Cross-references

| Surface area | Authoritative doc |
| --- | --- |
| Credentials sequencing | [`docs/CREDENTIALS_BOOTSTRAP.md`](docs/CREDENTIALS_BOOTSTRAP.md) |
| Per-surface deployment detail | [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) |
| Production gate criteria | [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md) |
| Package release process | [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md) |
| Incident handling | [`docs/INCIDENT_RUNBOOK.md`](docs/INCIDENT_RUNBOOK.md) |
| DR | [`docs/DR_RUNBOOK.md`](docs/DR_RUNBOOK.md) |
| Beta onboarding | [`docs/BETA_ONBOARDING_RUNBOOK.md`](docs/BETA_ONBOARDING_RUNBOOK.md) |
| Compliance bundle | [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md), [`docs/COMPLIANCE_BUNDLE.md`](docs/COMPLIANCE_BUNDLE.md) |
| Env var contract | [`.env.example`](.env.example), [`infra/deploy/launch-env-checklist.md`](infra/deploy/launch-env-checklist.md) |
| Operator decisions | [`OPERATOR_DECISIONS.md`](OPERATOR_DECISIONS.md) |

---

_Template version: 1.0 | First-launch revision. Update before Phase 2._
