# @aegis/marketing

Public marketing site for AEGIS. Deployed at `https://aegis.dev` (or operator domain) as a standalone Vercel project, separate from `@aegis/dashboard`.

## Stack

- Next.js 16 (App Router, static-first)
- React 19
- Zero auth, zero SDK, zero external runtime dependencies
- Self-contained CSS — design tokens live in `app/globals.css`, mirror the dashboard's brand-foundation ramp (slate-cool surfaces, indigo accent ladder, color-mix washes)

## Local dev

```sh
pnpm --filter @aegis/marketing dev   # serves on http://localhost:3001
```

Port 3001 is intentional so you can run the dashboard (port 3000) and marketing (3001) concurrently while iterating on the signup CTA → dashboard handoff.

## Deploying

See [`docs/LAUNCH_RUNBOOK.md`](../../docs/LAUNCH_RUNBOOK.md) for the operator-side launch sequence.

Short version:

1. `vercel link` (separate Vercel project from the dashboard)
2. Set the four `NEXT_PUBLIC_STRIPE_LINK_*` env vars to the live-mode Stripe Payment Link URLs
3. `vercel --prod`
4. Point the apex domain at Vercel via DNS

## Stripe Payment Links

The pricing CTAs link to Stripe Payment Links — operator-created URLs that take the customer through Stripe's hosted checkout and fire a webhook back to the AEGIS API on success. No backend integration required for v1; Stripe handles the entire checkout.

The four links to create in Stripe's live dashboard:

| Plan | Env var | Stripe price |
|---|---|---|
| Developer | `NEXT_PUBLIC_STRIPE_LINK_DEVELOPER` | `$49/mo, 50K verifies` |
| Team | `NEXT_PUBLIC_STRIPE_LINK_TEAM` | `$299/mo, 500K verifies` |
| Scale | `NEXT_PUBLIC_STRIPE_LINK_SCALE` | `$1,499/mo, 5M verifies` |
| Enterprise | `NEXT_PUBLIC_STRIPE_LINK_ENTERPRISE` | `mailto:sales@<domain>` (or HubSpot form URL) |

If env vars are unset, the buttons fall back to a `mailto:` for manual provisioning — site never breaks, just degrades.

## Pricing source-of-truth

V1 ships with pricing **hardcoded in `app/page.tsx`** to match `docs/decisions/0014-pricing-and-free-trial.md`. Post-launch, replace the hardcoded table with an SSR fetch of `https://api.${OP_DOMAIN}/.well-known/pricing.json` so pricing tracks ADR-0014 changes without a marketing redeploy — this matches the pattern the dashboard already uses (see `apps/dashboard/CLAUDE.md`).

## What this site does NOT do

- Authentication — that lives in `@aegis/dashboard` at `app.aegis.dev`
- API calls — no `@aegis/sdk` dependency, no fetches to AEGIS API
- User accounts — Stripe checkout creates the account via webhook to the API; this site only routes the user there
