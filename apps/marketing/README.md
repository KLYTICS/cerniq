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

See [`docs/LAUNCH_RUNBOOK.md`](../../docs/LAUNCH_RUNBOOK.md) for the operator-side launch sequence — including Phase 0 (the five gaps blocking self-serve onboarding).

Short version:

1. `vercel link` (separate Vercel project from the dashboard)
2. Set `NEXT_PUBLIC_SALES_EMAIL` (paid-plan CTAs all route here as mailto) and `NEXT_PUBLIC_DASHBOARD_URL`
3. `vercel --prod`
4. Point the apex domain at Vercel via DNS

## Paid-plan CTAs — mailto until Phase 0 closes

The pricing CTAs (and the hero "Get your AEGIS key" button) all open a `mailto:${NEXT_PUBLIC_SALES_EMAIL}` compose window with the plan name pre-filled in the subject. `apps/marketing/app/page.tsx`'s `planMailto` is the single source of truth.

This is **not a degradation fallback** — it is the intended v1 behavior. The previous design (Stripe Payment Links → webhook provisions account + API key) was unwired at four points in `apps/api/src/modules/billing/` plus the absent Auth0 v4 wire-up. See [`docs/LAUNCH_RUNBOOK.md`](../../docs/LAUNCH_RUNBOOK.md) § Phase 0 for the five gaps and the v1.1 plan that closes them.

**Do NOT** set `NEXT_PUBLIC_STRIPE_LINK_*` env vars — they are no longer read by the page; setting them has no effect. **Do NOT** create live-mode Stripe Payment Links in the Stripe dashboard until Phase 0 Gaps 1-3 close (`stripe.service.ts:553-559` will throw on every webhook call until then).

## Pricing source-of-truth

V1 ships with pricing **hardcoded in `app/page.tsx`** to match `docs/decisions/0014-pricing-and-free-trial.md`. Post-launch, replace the hardcoded table with an SSR fetch of `https://api.${OP_DOMAIN}/.well-known/pricing.json` so pricing tracks ADR-0014 changes without a marketing redeploy — this matches the pattern the dashboard already uses (see `apps/dashboard/CLAUDE.md`).

## What this site does NOT do

- Authentication — that lives in `@aegis/dashboard` at `app.aegis.dev` (gated on Auth0 v4 install, operator decision #5)
- API calls — no `@aegis/sdk` dependency, no fetches to AEGIS API
- User accounts — the wired path is IDP-driven: Auth0 (or Clerk / WorkOS) sends a `user.created` webhook to the AEGIS API; the matching adapter (`apps/api/src/modules/{auth0,idp-clerk,idp-workos}/*.adapter.ts`) calls `prisma.principal.create`. This site only opens a mailto for the operator to issue an Auth0 invite manually until v1.1's self-serve flow lands.
