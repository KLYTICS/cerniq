# AEGIS — Launch Runbook (Ship to First $49)

> Profit-optimized sequence. Each day is sequential, gated, and small enough to ship before EOD. Acceptance criterion: **a stranger can find aegis.dev, click Start Free, complete Stripe checkout, receive an API key by email, and make a successful `POST /v1/verify` call.**
>
> Today: 2026-05-15. Target first $49 charge: 2026-05-20.

This runbook complements — does **not** replace — `docs/PRODUCTION_CHECKLIST.md` (the security gate) and `docs/DEPLOYMENT_GUIDE.md` (the deploy mechanics). Both are prerequisites for the steps below. This file is the *sequencing layer* — what to do, in what order, today.

---

## What you already have (code-side, ready to ship)

| Surface | State |
|---|---|
| `apps/api` — NestJS 11 | Built, tested, Phase-1 GA gates G-1..G-4 closed |
| `apps/dashboard` — Next 16 internal operator console | Built; ships as `app.aegis.dev` |
| `apps/marketing` — Next 16 public landing (this PR) | Built; ships as `aegis.dev` |
| `packages/sdk-ts` — `@aegis/sdk` | Published-ready; `npm publish` blocked only on first-customer signal |
| `packages/sdk-py` — `aegis` | Scaffolded; PyPI publish optional for v1 |
| Stripe billing wiring | ADR-0014 prices locked in code; webhook handler in `apps/api/src/modules/billing/` |
| Ed25519 signing | Code wired; **prod keys not generated** |
| Railway descriptors | `railway.json` + `infra/railway/api.service.json` ready; **project not linked** |
| MCP bridge | Hardened (per-tool action scoping just landed) |
| Audit verifier | 95-test corpus walker just landed (ADR-0015 Phase 0) |

## What you need to provision (operator-side, today)

The five gates between code-complete and first-dollar:

1. **Domain.** No domain registered.
2. **Stripe live mode.** Prices not created in Stripe live; webhook endpoint not configured.
3. **Prod Ed25519 keys.** Not generated.
4. **Railway project.** Not linked.
5. **Vercel projects.** Marketing + dashboard not deployed.

---

## Day 1 — Distribution surface (target: 4 hours)

### 1.1 Buy the domain (15 min)

Recommend, in order of preference:

| Domain | Reason | Fallback if taken |
|---|---|---|
| `aegis.dev` | Developer-positioning TLD, ~$15/yr | `useaegis.com`, `aegis.security` |
| `aegis.security` | Industry alignment | `aegisid.dev` |
| `aegis.id` | Identity-positioning | `aegis.run` |

Register at Cloudflare Registrar (cheapest, no upcharge). Enable two-step verification on the registrar account immediately.

Expected env-name across this runbook: `${OP_DOMAIN}` = the domain you bought. Substitute everywhere.

### 1.2 Deploy `apps/marketing` to Vercel (60 min)

```sh
cd apps/marketing
pnpm install        # picks up the new workspace package from repo root
pnpm typecheck      # confirm clean
pnpm build          # confirm builds locally
vercel link         # create a NEW Vercel project (separate from dashboard)
vercel env add NEXT_PUBLIC_SALES_EMAIL          # value: sales@${OP_DOMAIN} or ops@klytics.io
vercel env add NEXT_PUBLIC_DASHBOARD_URL        # value: https://app.${OP_DOMAIN}
vercel env add NEXT_PUBLIC_DOCS_URL             # value: /quickstart (or https://docs.${OP_DOMAIN})
vercel --prod
```

DNS at Cloudflare:
- Apex `${OP_DOMAIN}` → Vercel (CNAME flattening or A 76.76.21.21)
- `www.${OP_DOMAIN}` → Vercel
- (later) `app.${OP_DOMAIN}` → Vercel dashboard project
- (later) `api.${OP_DOMAIN}` → Railway

Smoke test: `curl -I https://${OP_DOMAIN}` → 200, content-type text/html.

### 1.3 Deploy `apps/dashboard` to Vercel (60 min, parallel)

```sh
cd apps/dashboard
vercel link         # separate Vercel project — DO NOT reuse marketing's project
vercel env add NEXT_PUBLIC_API_BASE_URL         # value: https://api.${OP_DOMAIN}
vercel env add AEGIS_DASHBOARD_API_KEY          # admin API key from the API deploy (Day 3)
vercel --prod
```

DNS: `app.${OP_DOMAIN}` → Vercel dashboard project.

Note: the dashboard renders empty until the API is live (Day 3). That's fine — visitors who try to log in will see a graceful empty state per `apps/dashboard/app/page.tsx`'s `AegisAuthMissingError` handling.

---

## Day 2 — Stripe live mode (target: 3 hours)

### 2.1 Stripe products + prices (60 min)

In Stripe dashboard → live mode (NOT test):

| Product | Price | Lookup key | Env var receives the Price ID |
|---|---|---|---|
| AEGIS Developer | $49 / month recurring | `aegis_developer` | `STRIPE_PRICE_DEVELOPER` |
| AEGIS Team | $299 / month recurring | `aegis_team` | `STRIPE_PRICE_GROWTH` ⚠️ |
| AEGIS Overage | $0.0008 / verify, metered, monthly | `aegis_overage_verify` | `STRIPE_PRICE_OVERAGE_VERIFY` |
| AEGIS Enterprise | Custom — set as $0 placeholder, invoice direct | `aegis_enterprise` | `STRIPE_PRICE_ENTERPRISE` |

⚠️ **Env var name footgun:** The Prisma enum is still `GROWTH` so the env var is `STRIPE_PRICE_GROWTH` even though the customer-facing plan name is "Team" (per ADR-0014). The comment in `apps/api/src/modules/billing/plans.ts:149` saying `STRIPE_PRICE_ID_TEAM` is wrong — ignore it. Source of truth is `apps/api/src/config/config.schema.ts`.

**DO NOT** create `STRIPE_PRICE_SCALE` yet. The Scale tier ($1,499) requires a Prisma `PlanTier` enum migration that hasn't shipped (Round 18 territory). The marketing page already routes "Contact for Scale" → sales mailto.

### 2.2 Stripe Payment Links (45 min)

For each price above (Developer + Team only — Scale + Enterprise stay sales-driven), create a Stripe Payment Link in live mode:

1. Stripe → Payment Links → "+ New" → select the price → check "Collect billing address"
2. After-payment: redirect to `https://app.${OP_DOMAIN}/welcome?session_id={CHECKOUT_SESSION_ID}`
3. Copy the link URL — looks like `https://buy.stripe.com/live_xxx`

Add to Vercel marketing env vars:

```sh
cd apps/marketing
vercel env add NEXT_PUBLIC_STRIPE_LINK_DEVELOPER   # value: the buy.stripe.com URL
vercel env add NEXT_PUBLIC_STRIPE_LINK_TEAM        # value: the buy.stripe.com URL
vercel --prod    # redeploy with new env vars
```

### 2.3 Stripe webhook endpoint (30 min, but blocked until Day 3 API is live)

In Stripe → Developers → Webhooks → "+ Add endpoint":
- URL: `https://api.${OP_DOMAIN}/v1/billing/webhooks/stripe`
- Events to listen for: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`
- Copy the signing secret → `STRIPE_WEBHOOK_SECRET` on Railway

### 2.4 Verify webhook handler does the right thing

Before going live, confirm `apps/api/src/modules/billing/` handles `checkout.session.completed` by:
1. Creating the account
2. Provisioning an initial API key with FULL scope
3. Emailing the API key to the customer

```sh
cd ~/Desktop/aegis
grep -rn "checkout.session.completed\|provisionApiKey\|sendApiKeyEmail" apps/api/src/modules/billing/
```

If any of these are missing, that's a Day 2.5 task — write the missing handler before Day 3 deploy.

---

## Day 3 — Production API on Railway (target: 4 hours)

Full procedure: `infra/railway/README.md`. Quickref below.

### 3.1 Generate prod Ed25519 keys (5 min)

```sh
cd ~/Desktop/aegis
apps/api/node_modules/.bin/tsx scripts/generate-aegis-keys.ts --format both --out ./.local/keys --force
```

(Memory note: the `#!/usr/bin/env -S node --import=tsx` hashbang form in `PRODUCTION_CHECKLIST.md` is broken because `tsx` isn't in PATH from repo root. The invocation above is the working one — smoke-tested 2026-05-09.)

Output: `.local/keys/aegis-prod.env` (mode 0600) — pipe to Railway, then shred.

### 3.2 Railway project + 4 services (60 min)

Follow `infra/railway/README.md` § 1 to link. Then provision four services in `us-east`:
- `aegis-api` (NestJS, public ingress)
- `aegis-worker` (BATE / webhook / audit queue)
- `aegis-pg` OR external Neon (recommended: Neon — better for cold-storage of audit chain)
- `aegis-redis` OR external Upstash

### 3.3 Push env vars (45 min)

Per `infra/railway/api.service.json` `envVars` list:

```sh
# 1. The audit + JWT keys from step 3.1 (don't forget shred at the end)
while IFS='=' read -r key value; do
  railway variables set --service aegis-api "$key=$value"
done < .local/keys/aegis-prod.env

# 2. Stripe live secrets from step 2.1
railway variables set --service aegis-api "STRIPE_SECRET_KEY=sk_live_..."
railway variables set --service aegis-api "STRIPE_WEBHOOK_SECRET=whsec_..."
railway variables set --service aegis-api "STRIPE_PRICE_DEVELOPER=price_..."
railway variables set --service aegis-api "STRIPE_PRICE_GROWTH=price_..."
railway variables set --service aegis-api "STRIPE_PRICE_OVERAGE_VERIFY=price_..."
railway variables set --service aegis-api "STRIPE_PRICE_ENTERPRISE=price_..."

# 3. Security hardening (memory: feedback_klytics_billing + project_aegis P0s)
railway variables set --service aegis-api "API_KEY_BCRYPT_COST=12"
railway variables set --service aegis-api "AEGIS_ADMIN_TOKEN=$(openssl rand -hex 32)"
railway variables set --service aegis-api "AEGIS_VERIFY_RATE_LIMIT_FREE=10"
railway variables set --service aegis-api "TRUSTED_PROXY_CIDRS=..."  # Cloudflare's published ranges

# 4. App-level
railway variables set --service aegis-api "NODE_ENV=production"
railway variables set --service aegis-api "AEGIS_ENV=production"
railway variables set --service aegis-api "API_BASE_URL=https://api.${OP_DOMAIN}"
railway variables set --service aegis-api "ENABLE_SWAGGER=false"

# 5. Shred the key file
shred -u .local/keys/aegis-prod.env || rm -P .local/keys/aegis-prod.env
```

Mirror the **AUDIT_** keys to `aegis-worker` (the worker writes audit events too; same signing key keeps the chain intact). JWT keys do NOT go on the worker.

### 3.4 Deploy + custom domain (45 min)

```sh
railway up --service aegis-api
railway up --service aegis-worker
```

Railway dashboard → `aegis-api` → Settings → Domains → add `api.${OP_DOMAIN}`.
Cloudflare DNS → `api.${OP_DOMAIN}` CNAME → `<service>.up.railway.app`.

### 3.5 Smoke test the API (15 min)

```sh
curl https://api.${OP_DOMAIN}/v1/health/ready
# expect: 200 { "status": "ready", ... }

curl https://api.${OP_DOMAIN}/.well-known/jwks.json
# expect: 200 { "keys": [ { "kty": "OKP", "crv": "Ed25519", ... } ] }

curl https://api.${OP_DOMAIN}/.well-known/audit-signing-key
# expect: 200 (audit JWKS)
```

### 3.6 Issue your own dashboard admin key + drop into Vercel

```sh
# From a local terminal with Railway DB URL temporarily exposed
# Or via the Railway shell:
railway run --service aegis-api node -e "..."
# OR use the seed script if one exists:
pnpm --filter @aegis/api run seed:admin
```

Copy the resulting API key → `vercel env add AEGIS_DASHBOARD_API_KEY` for the dashboard project → `vercel --prod` to redeploy.

---

## Day 4 — End-to-end signup test (target: 2 hours)

The hardest part. Pretend you're a stranger.

1. Open an incognito window, no cookies.
2. Navigate to `https://${OP_DOMAIN}`. Confirm landing renders. Click "Start free — 10K verifies".
3. Confirm you land on the Stripe Payment Link for Developer.
4. Complete checkout with a real card (use your own; refund after if needed).
5. Stripe redirects to `https://app.${OP_DOMAIN}/welcome?session_id=...`.
6. Confirm the dashboard processes the session, shows your API key, and an email arrives at the checkout email address.
7. Use the API key in a quickstart locally:

```sh
export AEGIS_KEY="<your-aegis-key>"
pnpm --filter @aegis/sdk exec node ./examples/verify.js
# expect: { valid: true, trustScore: 500, ... }
```

If any step fails, the gating bug is identified. Fix forward — don't accept partial flows.

### Known follow-ups (already accepted)

- **Scale tier checkout**: routed to sales until Round 18 ships the Prisma `PlanTier` enum migration. Don't worry about it.
- **Enterprise tier**: sales-only by design.
- **PyPI publish**: defer until first Python customer asks.
- **Cloudflare Workers verify edge**: Phase 3, post-$500 MRR (per `project_aegis` memory).
- **Marketing pricing pulls from hardcoded table** v1, should swap to SSR-fetch of `/.well-known/pricing.json` (matching dashboard) post-launch — keeps marketing in sync with ADR-0014 changes without a redeploy.
- **Auth0 v4 SDK install** is required before the dashboard login receiver is live (per `CLAUDE.md` operator decision #5). The marketing CTA → Stripe → `app.${OP_DOMAIN}/welcome` flow works without it, but `app.${OP_DOMAIN}/login` will not until Auth0 v4 is wired.

---

## Day 5 — First customer reach (target: 4 hours)

Hand-deliver to 3–5 candidates in your network. Watch them sign up. Fix what breaks.

Three things to watch for, ordered by signal strength:

1. **The Aha moment lands or it doesn't.** Per `apps/dashboard/app/quickstart/`: "my agent sent a request, and the relying party got back `{ valid: true, trustScore: 500 }`". If a candidate hits that within 10 minutes of signup, your funnel works. If they bounce on docs, copy is the bug, not the product.
2. **Pricing objections.** $49 / $299 / $1,499 was ADR-0014's locked decision. If 3+ candidates push back on $49 as too high for the 50K tier, that's data — note it for ADR-0014 v2.
3. **Surprise denials.** The denial precedence chain (`AGENT_NOT_FOUND` → ... → `ANOMALY_FLAGGED`) is deterministic. If a candidate hits a denial they didn't expect, the error message is unclear, not the decision.

---

## Acceptance criteria — what "shipped" means

You can stop the launch sprint when **all five** of the following are true:

| # | Acceptance | How to verify |
|---|---|---|
| 1 | `https://${OP_DOMAIN}` returns 200 with the landing page | `curl -I https://${OP_DOMAIN}` |
| 2 | `https://app.${OP_DOMAIN}/login` returns the dashboard login | Visit in incognito |
| 3 | `https://api.${OP_DOMAIN}/v1/health/ready` returns 200 | `curl https://api.${OP_DOMAIN}/v1/health/ready` |
| 4 | A Stripe Payment Link → webhook → API-key-email flow completes end-to-end | Day 4 smoke test |
| 5 | At least one paying customer (you count if no one external signs up in week 1) | Stripe dashboard → live mode → recent payments |

Anything beyond this list — SOC 2, status page, GDPR DPA template, CF Workers — is **post-launch hardening**. Do not gate launch on it.

---

## Rollback plan

If any step goes sideways:

| Failure mode | Recovery |
|---|---|
| Vercel marketing deploy breaks live site | `vercel rollback` (one command, idempotent) |
| Railway API deploy breaks `/verify` | `railway redeploy --prev` from the deployments tab |
| Stripe live mode misconfigured (charging wrong amount) | **Refund via Stripe dashboard immediately, then disable Payment Links, fix, re-enable.** Customer-facing trust > internal speed. |
| Prod Ed25519 keys leaked | **Hard rotation:** generate new keys, JWKS gets a new kid, OLD agent tokens are invalidated by next verify call (memory note: see OD-017 for legacy kid handling). Customer comms within 24h. |
| First customer hits a denial bug | Treat as P0. Hotfix forward; don't accept "we'll fix it" via support email. |

---

## What this runbook deliberately does not include

- **SOC 2 evidence collection** — post-launch. Trust pages can claim "in progress."
- **Marketing copy variations / A-B testing** — first customers come from your network anyway; copy iteration is post-launch signal.
- **Auth0 / Clerk wiring** — the dashboard already has these per ADR-0009 / Round 7. If a candidate wants SSO, point them at Auth0 docs and configure manually for now.
- **The audit-compression Phase 1-3 work** — peer 115e12ee's Phase 0 bundle lands the manifest verifier; Phases 1-3 are blocked on OD-017 operator decision. None of this is on the critical path to first $49.

The dependency this runbook *creates* on the engineering swarm: it assumes the in-flight peer commits (audit-compression bundle, review-findings hardening, ADR-0015 Phase 0 hardening) land before Day 3 deploy. If they don't, deploy from `main` instead of `feat/sdk-verify-gateway-hardening`. Both branches have the billing wiring; the SDK gateway hardening isn't a launch blocker.

---

**Reference docs (already exist):**
- `docs/PRODUCTION_CHECKLIST.md` — security gate (HSTS, CSP, CORS, RLS) — must be green before public traffic
- `docs/DEPLOYMENT_GUIDE.md` — deploy mechanics
- `infra/railway/README.md` — Railway-specific procedure
- `OPERATOR_DECISIONS.md` — open ODs that should be resolved before launch (OD-009..017)
- `docs/decisions/0014-pricing-and-free-trial.md` — pricing source of truth
