# ADR-0019 — IDP v1 selection: Clerk for Developer tier, Auth0 deferred to Enterprise

**Status**: proposed
**Date**: 2026-05-16
**Deciders**: OPERATOR-INPUT-NEEDED (Erwin)
**Supersedes**: none — refines [ADR-0009](./0009-auth0-bridge.md) § Decision #1 for v1 launch; ADR-0009's `IdpAdapter` interface and adapter set remain canonical.

## Context

`docs/LAUNCH_RUNBOOK.md` Phase 0 Gap 4 ("IDP SDK not installed in dashboard") + Gap 5 ("no admin path to create a Principal in production") are co-blockers for any customer onboarding. Neither closes without picking and installing one IDP. The wired-code reality (verified 2026-05-16 by `scripts/launch-runbook/phase-0-check.sh` + manual grep):

- Three adapters already exist with `prisma.principal.create` wired:
  `apps/api/src/modules/auth0/auth0.adapter.ts`,
  `apps/api/src/modules/idp-clerk/clerk.adapter.ts`,
  `apps/api/src/modules/idp-workos/workos.adapter.ts`.
- Neither `@auth0/nextjs-auth0`, `@clerk/nextjs`, nor `@workos-inc/*` is installed in `apps/dashboard/package.json`. The choice is purely operator-side: pick one, `pnpm add`, configure the IDP tenant.
- ADR-0009 picked Auth0 as the *design-time* default in 2026-05-02. That ADR explicitly left Clerk / Stytch / WorkOS as "slots in later" via the IdpAdapter interface.

ADR-0009 did not consider v1 unit economics because pricing was not yet locked. [ADR-0014](./0014-pricing-and-free-trial.md) (2026-05-05) then locked Developer tier at $49/mo for 50K verifies. The IDP choice now has a pricing dimension ADR-0009 did not weigh:

| IDP | Floor cost (2026 pricing) | Free-tier breakpoint |
|---|---|---|
| Auth0 (Enterprise plan) | ~$240/mo base + per-MAU add-ons | Free tier capped at 7,500 MAU + 3 SSO connections; Enterprise pricing kicks in immediately for production B2B |
| Clerk | $0/mo to 10,000 MAU, then $25/mo + $0.02/MAU | Generous free tier through entire v1 customer cohort |
| WorkOS | $125/mo per SSO connection (no per-MAU) | No free tier for production SSO; fits Enterprise-shaped customers only |

At $49 Developer-tier revenue, Auth0's $240/mo base means the *first ~5 Developer customers must subsidize the IDP line item alone*. Clerk's free-tier ceiling (10K MAU) is structurally aligned with v1's customer cohort (likely <100 paying customers in the first 12 months per `docs/spec/04_COMMERCIAL_STRATEGY.md`'s pessimistic ramp).

The decision ADR-0009 framed as "pick the right IDP" is actually two coupled choices: *which IDP for what customer segment*, and *how to defer the costlier ones until their segment exists*.

## Decision

AEGIS v1 launch uses **Clerk** as the dashboard IDP. Auth0 and WorkOS remain wired adapters; they activate per-customer-segment.

1. **Clerk for Developer-tier customers.** `pnpm --filter @aegis/dashboard add @clerk/nextjs` + wrap `apps/dashboard/app/layout.tsx` in `ClerkProvider` + add `apps/dashboard/middleware.ts` with `clerkMiddleware()` + set `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` env vars on Vercel. Wire the existing `idp-clerk/clerk.adapter.ts` webhook to Clerk's `/api/webhooks/clerk` events (`user.created` → adapter creates Principal).

2. **Auth0 activates when the first Enterprise tier customer signs.** Auth0's $240/mo base amortizes against Enterprise ACV (per ADR-0014 Enterprise is "custom" — minimum should be ≥$5K/yr for the math to work). Until then, Auth0 stays uninstalled; the adapter waits.

3. **WorkOS activates as an SSO add-on for Team+ customers requesting federated identity** (Okta / Azure AD / Google Workspace). The $125/mo per-connection cost is passed through as part of an Enterprise SSO add-on price (not bundled into the base tier).

4. **The dashboard nav and pricing page** do not mention specific IDPs to the customer. "Sign in" is opaque; AEGIS holds the IDP relationship server-side.

## Consequences

### Positive

- v1 customer-acquisition cost contains zero IDP overhead until customer #1 of the Enterprise segment exists. Marginal Developer-tier customer is profitable from $1 of revenue.
- Clerk's onboarding-flow polish (magic links, social, hosted UI) is best-in-class for a developer-focused product. Reduces "first 5 minutes" friction more than Auth0's enterprise-tour-by-default UX.
- All three adapters are already wired — switching IDP for a specific customer (e.g., promoting an Enterprise customer from Clerk to Auth0) is a config change, not a code change.

### Negative

- A future Enterprise customer demanding "we already use Auth0" requires installing the Auth0 SDK alongside Clerk in the same dashboard. This is not trivial — two SDKs in one Next.js app needs a routing strategy. Open question: is the bridge done per-tenant via subdomain (`acme.app.aegis.dev` → Auth0; `app.aegis.dev` → Clerk), or via a tenant-routing middleware?
- Clerk SOC 2 / compliance posture is strong but not identical to Auth0's regulated-finance pedigree. If the first Enterprise customer is a regulated FI, the Auth0 swap is forced earlier than amortization would prefer.
- "AEGIS dashboard uses Clerk" is a customer-visible fact (their login URL, their session cookie). Switching providers later is non-trivial customer-comms.

### Neutral

- ADR-0009's `IdpAdapter` interface remains canonical. This ADR refines *which adapter the v1 dashboard installs*, not *which adapters can exist*.
- LAUNCH_RUNBOOK Phase 0 Gap 4 check (`scripts/launch-runbook/phase-0-check.sh`) already greps for all three SDK packages; it will turn green when *any* of them is installed.

## Alternatives considered

### Alt A: Auth0 from day 1 (the ADR-0009 default)

Auth0 is the long-term right answer for AEGIS — its regulated-finance SOC 2 / ISO 27001 / HIPAA pedigree matches AEGIS's positioning. The cost is structural: $240/mo base is a fixed cost that depresses Developer-tier unit economics. **Rejected for v1** because v1 launches into the Developer segment, not Enterprise; the costlier IDP should activate when the segment that justifies it arrives.

### Alt B: WorkOS only

Considered then rejected. WorkOS is enterprise-only with no free tier. Excellent for the SSO-add-on path but cannot serve the cold-start Developer cohort. Also keeps it as a *complement* to Clerk/Auth0, not a replacement.

### Alt C: Build it ourselves (no IDP)

Considered then rejected per ADR-0009 § Context: "Building a human-identity stack ... is a 6–12 month effort with its own SOC2 implications." Off-the-shelf is correct. The choice is *which* off-the-shelf.

### Alt D: Stytch

Considered. Stytch's pricing is similar to Clerk's (free tier + usage-based) and they have a stronger embeddable-flow story. Rejected for v1 because there is no `stytch.adapter.ts` wired in `apps/api/src/modules/` — picking Stytch reopens the adapter build that's already done for Clerk. Net engineering cost is higher than the marginal UX benefit at v1 scale.

## How to reverse this decision

The reversal cost is bounded by *when* the reversal happens, scaled by customer count at that moment:

- **0–10 Developer customers (target: <90 days post-launch).** `pnpm --filter @aegis/dashboard remove @clerk/nextjs` + `pnpm --filter @aegis/dashboard add @auth0/nextjs-auth0` + swap `apps/dashboard/app/layout.tsx`'s provider + swap `middleware.ts` + reset Clerk env vars to Auth0. Existing customers re-onboard with their email (Auth0 magic-link migration); their principalId in Postgres is stable since it's already keyed on email per `prisma.principal` schema.
- **10–100 Developer customers.** Same code change + an Auth0 migration tool that imports the Clerk user list (Auth0's bulk-import API takes this directly). Customers receive a "your AEGIS login is moving" email.
- **>100 customers.** Forced dual-IDP coexistence (Clerk grandfathered; Auth0 for new signups). The "two SDKs in one Next.js" routing problem becomes load-bearing. Most expensive reversal — avoid by triggering Auth0 swap at the first Enterprise signup (per Decision #2) before Developer cohort grows past this threshold.

## References

- [ADR-0009](./0009-auth0-bridge.md) — Auth0 design-time default; this ADR refines for v1
- [ADR-0014](./0014-pricing-and-free-trial.md) — Developer-tier $49 pricing that drives the unit-economics math
- `docs/LAUNCH_RUNBOOK.md` § Phase 0 Gaps 4 + 5
- `scripts/launch-runbook/phase-0-check.sh` — turns Gap 4 from FAIL → PASS the moment any IDP SDK appears in `apps/dashboard/package.json`
- `apps/api/src/modules/idp-clerk/clerk.adapter.ts` — existing wired adapter
- Clerk pricing as of 2026-05-16: `https://clerk.com/pricing`
- Auth0 pricing as of 2026-05-16: `https://auth0.com/pricing`
- WorkOS pricing as of 2026-05-16: `https://workos.com/pricing`
