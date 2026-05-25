# Vercel — Dashboard deploy command sequence

> Concrete commands for §6 of [LAUNCH.md](../../LAUNCH.md). Gates on Auth0 wired (per CLAUDE.md "Operator decisions still pending #5") and the API live at `api.cerniq.io`.

## Prerequisites

- `vercel --version` ≥ 32.x — `pnpm dlx vercel@latest --version` if not installed globally
- `vercel login` — once
- Auth0 tenant + app created (per [`infra/auth0/README.md`](../auth0/README.md))
- API live + reachable at `https://api.cerniq.io/v1/health` (200)

## Step 1 — Link

```sh
cd apps/dashboard
vercel link                           # scope: KLYTICS, project: cerniq-dashboard
```

If the project doesn't exist yet, create it in the Vercel dashboard first (preferred — keeps team/environment configuration explicit).

## Step 2 — Configure framework + Node version

In Vercel project settings (web UI):

- **Framework Preset**: Next.js
- **Root Directory**: `apps/dashboard`
- **Build Command**: `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @cerniq/dashboard build`
- **Output Directory**: `.next` (default)
- **Install Command**: leave blank (Build Command above handles it)
- **Node Version**: 20.x (matches `.nvmrc`)

## Step 3 — Set environment variables

From [launch-env-checklist.md §C](launch-env-checklist.md). Run for `production`, `preview`, and `development` targets where each var applies:

```sh
# P0 backend coordinates (all envs)
vercel env add CERNIQ_API_BASE_URL production   # paste: https://api.cerniq.io/v1
vercel env add CERNIQ_API_BASE_URL preview      # paste: https://api-preview.cerniq.io/v1 (or same as prod for first launch)

# Until Auth0 v4 SDK lands per M-020 — operator-pinned API key
vercel env add CERNIQ_DASHBOARD_PRINCIPAL_ID production  # paste prn_… from your operator principal
vercel env add CERNIQ_DASHBOARD_API_KEY production       # paste cer_… with FULL scope

# Once Auth0 lands
vercel env add AUTH0_DOMAIN production
vercel env add AUTH0_CLIENT_ID production
vercel env add AUTH0_CLIENT_SECRET production            # marked sensitive automatically
vercel env add AUTH0_BASE_URL production                 # https://app.cerniq.io
vercel env add AUTH0_SECRET production                   # openssl rand -hex 32
vercel env add AUTH0_AUDIENCE production
```

## Step 4 — Deploy preview first

```sh
vercel deploy                          # preview URL → exercise it
```

Manual smoke against the preview URL:

- `/login` returns 200
- `/agents` returns the empty-state UI (no data yet)
- `/policies` similarly
- `/audit` shows the genesis event from the API

## Step 5 — Promote to production

```sh
vercel deploy --prod
```

## Step 6 — Custom domain

```sh
vercel domains add app.cerniq.io
# Vercel prints a CNAME target. DNS:
# CNAME app.cerniq.io → cname.vercel-dns.com
```

Cert issues automatically in ~1 minute. Confirm with `vercel certs ls`.

## Step 7 — Configure Auth0 callback URLs

In Auth0 dashboard → Applications → your app:

- **Allowed Callback URLs**: `https://app.cerniq.io/api/auth/callback`
- **Allowed Logout URLs**: `https://app.cerniq.io`
- **Allowed Web Origins**: `https://app.cerniq.io`
- **Allowed Origins (CORS)**: `https://app.cerniq.io`

## Step 8 — Smoke

```sh
export CERNIQ_APP_BASE=https://app.cerniq.io
../../scripts/launch-smoke.sh dashboard
```

## Known gaps

1. **Auth0 v4 SDK not yet installed** — per [CLAUDE.md](../../CLAUDE.md) "Operator decisions still pending #5". Until it lands, the dashboard authenticates with `CERNIQ_DASHBOARD_API_KEY` not per-user Auth0 sessions. Plan: ship dashboard in operator-pinned mode for v1, swap to Auth0 in v2.
2. ~~**`CERNIQ_API_URL` vs `CERNIQ_API_BASE_URL`** drift~~ — **RESOLVED 2026-05-25**: canonicalized to `CERNIQ_API_BASE_URL` only. Set it **without** a trailing `/v1` (the code appends `/v1/`).

## Rollback

```sh
vercel deployments ls
vercel promote <previous-deployment-url>   # promote a previous build back to production
```

## Post-launch checks (T+15min)

- [ ] `app.cerniq.io/login` returns 200
- [ ] CSP header present (smoke covers it)
- [ ] Login redirects to Auth0 (when wired) OR shows operator-pinned dashboard (current v1)
- [ ] `/agents` page lists at least the seed-demo agent OR shows the empty state
- [ ] `/audit` shows the genesis event
