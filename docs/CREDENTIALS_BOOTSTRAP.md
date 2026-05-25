---
title: CERNIQ Credentials Bootstrap
last-reviewed: 2026-05-23
owner: operator (Erwin)
audience: operator + any future contributor provisioning a CERNIQ environment
---

# CERNIQ — Credentials Bootstrap

A sequenced runbook for provisioning every external account and credential
CERNIQ depends on, from "fresh laptop" to "production-shippable." Pair with:

- `OPERATOR_DECISIONS.md` — the locked product/architectural decisions each
  credential implements (e.g. OD-003 Stripe pricing, OD-015 Auth0 default IdP,
  OD-009 CLI device-code OAuth).
- `.env.example` — the contract for what each variable holds; the schema is
  authoritative in `apps/api/src/config/config.schema.ts`.
- `apps/api/CLAUDE.md` — the hard rules each credentialed surface must respect
  (tenant isolation, no silent failures in security/billing/policy paths).

> **Sequencing principle:** acquire credentials in dependency order so the
> first runnable demo of CERNIQ is reachable as early as possible. Tier 0
> is "you already have it." Tier 1 is "you can run CERNIQ locally with real
> signing keys." Tier 2 is "you can deploy a preview that takes payment."
> Tier 3 is "production-ready with observability." Tier 4 is hygiene.

---

## Tier 0 — already provisioned

| Surface | Verification | Notes |
| --- | --- | --- |
| GitHub repo `KLYTICS/cerniq` | `gh repo view KLYTICS/cerniq` | `monykiss` has admin |
| Radicle canonical | `rad sync status` | RID `rad:z3JUSaS2iRrV1raoSaqXxowLDHq6b`, replicated to ≥4 community seeders |
| Domain `cerniq.io` | DNS lookup | Registered via Spaceship per project memory |
| Local Radicle node (`anakin`) | `rad self` | DID `did:key:z6MktaWRHDt…JkN3EA`; private key currently UNENCRYPTED — see Tier 4 §1 |

---

## Tier 1 — required for a real local demo

Goal: a local boot of `pnpm dev` against real, non-stub signing keys with a
real federated identity. No money yet.

### 1.1 — Generate Ed25519 signing keypairs

CLAUDE.md invariant 1: private keys never leave the operator's machine in
production; in dev these env vars are the fallback.

```bash
pnpm tsx scripts/generate-cerniq-keys.ts
# Writes to stdout: copy each block into .env
```

Three independent keypairs are produced:

| Env var | Purpose |
| --- | --- |
| `CERNIQ_SIGNING_PRIVATE_KEY` / `CERNIQ_SIGNING_PUBLIC_KEY` | Audit-chain signing (publishes pub at `/.well-known/audit-signing-key`) |
| `JWT_ED25519_PRIVATE_KEY_B64` / `JWT_ED25519_PUBLIC_KEY_B64` | Agent capability JWT signing |
| `AUDIT_ED25519_*_B64` | Deprecated alias for `CERNIQ_SIGNING_*`; keep until v0.2 |

Also set `CERNIQ_SIGNING_KEY_ROTATED_AT` to today's ISO timestamp.

### 1.2 — Generate the webhook secret DEK

```bash
echo "CERNIQ_WEBHOOK_SECRET_DEK_B64=$(openssl rand -base64 32)" >> .env
```

This wraps every `WebhookSubscription.secret` at rest. In dev the cipher
falls back to an ephemeral key with a warning; in production the API
boot fails-loud without it.

### 1.3 — Auth0 tenant + application (OD-015 default)

Per `OPERATOR_DECISIONS.md` OD-015, Auth0 is the locked default IdP for
the dashboard. Clerk and WorkOS are swappable adapters per `IdpAdapter`.

Steps:

1. Sign up at https://auth0.com (free tier is enough through early beta).
2. Create a tenant — name it `cerniq` (region: US-East matches the
   `OTEL_RESOURCE_ATTRIBUTES`-style telemetry stamping in `.env.example`).
3. Create a **Regular Web Application** named `cerniq-dashboard`.
4. Note the Auth0 domain (`<tenant>.us.auth0.com`) → this is the issuer.
5. In APIs, create an audience identifier (e.g. `https://api.cerniq.io`)
   for the dashboard's API calls.
6. Create an Action (Post-Login flow) that signs an HS256 JWT with a
   shared secret — that secret becomes `AUTH0_ACTION_SECRET`.

Env vars:

```bash
AUTH0_ISSUER=https://<tenant>.us.auth0.com/
AUTH0_AUDIENCE=https://api.cerniq.io
AUTH0_ACTION_SECRET=<the-HS256-secret-you-set-in-the-action>
AUTH0_REQUIRED=false   # leave false until the dashboard is wired
```

Verification: `pnpm --filter @cerniq/api test -- --testPathPattern auth0`.

### 1.4 — Run the local boot

```bash
pnpm db:up           # Postgres + Redis via docker-compose
pnpm db:migrate      # applies all migrations
pnpm db:generate     # produces Prisma client (also runs via pnpm doctor)
pnpm dev             # boots @cerniq/api on http://localhost:4000
```

Verification: `curl localhost:4000/.well-known/audit-signing-key | jq` returns the public key you generated in 1.1.

---

## Tier 2 — required to take a paying customer

### 2.1 — Stripe (OD-003 — DECIDED 2026-05-05)

The pricing model is **locked**: see `docs/decisions/0014-pricing-and-free-trial.md`.

| Product | Stripe price ID env var | Locked price | Wired today? |
| --- | --- | --- | --- |
| Developer | `STRIPE_PRICE_DEVELOPER` | $49 / mo — 50K verifies | ✓ |
| Team | `STRIPE_PRICE_GROWTH` | $299 / mo — 500K verifies | ✓ (enum value is still `GROWTH`; "Team" is the ADR-0014 display name) |
| Scale | *(none)* | $1,499 / mo — 5M verifies | ✗ **not wired** — see note below |
| Enterprise | `STRIPE_PRICE_ENTERPRISE` | custom | ✓ |
| Overage | `STRIPE_PRICE_OVERAGE_VERIFY` | $0.0008 / verify (metered) | ✓ |

> **Var-name reality (verified against code 2026-05-25):** `stripe.service.ts`
> resolves the Team price via `config.stripePriceGrowth` → the env var the
> code actually reads is **`STRIPE_PRICE_GROWTH`**, not `STRIPE_PRICE_TEAM`.
> `STRIPE_PRICE_TEAM` is not in the Zod schema, so it is silently dropped —
> setting it leaves Team checkout returning 503. Use `STRIPE_PRICE_GROWTH`.
>
> **SCALE is a remaining gap.** ADR-0014 specced a SCALE tier ($1,499/mo, 5M
> verifies) but `plans.ts` defines only FREE / DEVELOPER / GROWTH / ENTERPRISE.
> There is no SCALE plan and no `STRIPE_PRICE_SCALE` the code reads. Shipping
> SCALE requires a `PlanTier` enum migration (the Round-18 GROWTH→TEAM +
> SCALE rename), a `plans.ts` definition, parity tests, and the new price var —
> it is **not** a credential you can provision today. Going live with the four
> wired tiers is fully supported; treat SCALE as planned product work.

Steps:

1. Create a Stripe account (https://dashboard.stripe.com/register).
2. Create **4 wired products** (Developer, Team, Enterprise, metered overage)
   with the prices above (subscription + metered overage). Defer the SCALE
   product until the tier is wired in code.
3. Note each price's `price_xxxxx` ID and set the env vars.
4. From **Developers → API keys**, copy the live secret key → `STRIPE_SECRET_KEY`.
5. From **Developers → Webhooks**, add an endpoint:
   - URL: `https://api.cerniq.io/v1/billing/stripe/webhook` (replace with your deploy URL)
   - Events: `customer.subscription.{created,updated,deleted}`, `invoice.paid`, `checkout.session.completed`
   - Signing secret → `STRIPE_WEBHOOK_SECRET`
6. Set the three redirect URLs in `.env`:
   - `STRIPE_CHECKOUT_SUCCESS_URL=https://app.cerniq.io/billing/success`
   - `STRIPE_CHECKOUT_CANCEL_URL=https://app.cerniq.io/pricing`
   - `STRIPE_PORTAL_RETURN_URL=https://app.cerniq.io/billing`

Verification: `pnpm --filter @cerniq/api test -- --testPathPattern stripe`.

> When `STRIPE_SECRET_KEY` is unset, `BillingService` is a no-op (manual
> plan-tier admin still works). The boot is non-fatal.

### 2.2 — KMS provider (pick one; AWS recommended per OD-014 trigger logic)

`CERNIQ_KMS_PROVIDER=in-memory` refuses to boot in `NODE_ENV=production`.
Pick one of three adapters:

**AWS KMS (recommended)** — see OD-014 trigger 2: AWS KMS GAing EdDSA Sign
is one of the PQ-hybrid migration triggers, so it's already in the
forward-architecture surface.

1. AWS account, IAM user with KMS permissions.
2. Create a customer-managed key (CMK) in us-east-1 (or your chosen region):
   - Key spec: `ECC_NIST_P256` (envelope encryption — Ed25519 isn't yet a
     native KMS key spec, hence the wrapped-key pattern in the env vars).
3. Generate an Ed25519 keypair locally (Tier 1 §1.1 already did this);
   wrap the private key bytes with the CMK using `aws kms encrypt`.
4. Env vars:
   ```bash
   CERNIQ_KMS_PROVIDER=aws
   AWS_REGION=us-east-1
   CERNIQ_AWS_KMS_AUDIT_KID=<CMK-arn-or-alias>
   CERNIQ_AWS_KMS_AUDIT_WRAPPED=<base64-encoded-wrapped-private-key>
   CERNIQ_AWS_KMS_AUDIT_PUB=<base64-encoded-public-key>
   ```

**GCP KMS** — native EdDSA support, simpler shape:

1. GCP project, service account with `roles/cloudkms.cryptoKeyEncrypterDecrypter`.
2. Create a key ring + asymmetric signing key (algorithm: `EC_SIGN_ED25519`).
3. Env vars:
   ```bash
   CERNIQ_KMS_PROVIDER=gcp
   CERNIQ_GCP_KMS_AUDIT_KID=<short-key-id>
   CERNIQ_GCP_KMS_AUDIT_RESOURCE=projects/.../locations/.../keyRings/.../cryptoKeys/.../cryptoKeyVersions/1
   CERNIQ_GCP_KMS_AUDIT_PUB=<base64-encoded-public-key>
   ```
4. `GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json` for local dev; on a
   GCP runtime, workload identity is automatic.

**Vault Transit** — for shops with on-prem HashiCorp infrastructure:

1. Vault Transit secrets engine enabled with an Ed25519 key.
2. Env vars: `CERNIQ_VAULT_{ADDR,TOKEN,AUDIT_KID,AUDIT_TRANSIT_NAME,AUDIT_VERSION,AUDIT_PUB}`.

Verification: `pnpm --filter @cerniq/api test -- --testPathPattern kms`.

### 2.3 — Postgres + Redis hosting

CERNIQ uses Postgres 16 and Redis 7. Hosting options:

| Provider | Postgres | Redis | Notes |
| --- | --- | --- | --- |
| **Supabase** | ✓ | — | Add Upstash for Redis |
| **Neon + Upstash** | ✓ | ✓ | Cheapest serverless starter |
| **Render** | ✓ | ✓ | Same-vendor managed both |
| **AWS RDS + ElastiCache** | ✓ | ✓ | Enterprise standard |
| **GCP Cloud SQL + Memorystore** | ✓ | ✓ | Pairs with GCP KMS in §2.2 |

Set `DATABASE_URL` and `REDIS_URL` once provisioned. Run
`pnpm db:migrate` against the new DB to apply the migration chain
(13 migrations including the AEGIS → OKORO → CERNIQ rename pair).

### 2.4 — Vercel (dashboard deploy)

The rename branch added Vercel monorepo deploy support (commit `037c841`).

1. Create a Vercel account.
2. Import the `KLYTICS/cerniq` GitHub repo.
3. Project root: `apps/dashboard`.
4. Required env vars in the Vercel project:
   - `CERNIQ_API_BASE_URL=https://api.cerniq.io` (or your API deploy URL)
   - `NEXT_PUBLIC_API_URL=https://api.cerniq.io`
   - `CERNIQ_DASHBOARD_API_KEY=<a key minted via the operator CLI>`
   - `CERNIQ_DASHBOARD_PRINCIPAL_ID=<the principal that owns the key>`
   - All AUTH0_* from Tier 1 §1.3.

> Per `apps/dashboard/CLAUDE.md` (read it before deploying), the Phase 1
> dashboard reads the API server-side with an operator-pinned key until
> per-user Auth0 sessions land (M-020).

### 2.5 — Cloudflare (workers/cf-verify edge)

Per OD-008 vibes the edge surface is phase-gated. When you ship it:

1. Cloudflare account.
2. `cd workers/cf-verify && wrangler login`.
3. `wrangler deploy` — uses `wrangler.toml` already in the workspace.
4. CDN-bind the worker to a route like `verify.cerniq.io/*`.

### 2.6 — DNS records at Spaceship

Point the records at the chosen deploy targets:

| Record | Points to |
| --- | --- |
| `cerniq.io` | Vercel apex (`A 76.76.21.21` + `AAAA 2606:4700:0:0:0:0:0:0`) |
| `app.cerniq.io` | Vercel CNAME |
| `api.cerniq.io` | API host (Render / Fly / your choice) |
| `verify.cerniq.io` | Cloudflare worker route |
| `status.cerniq.io` | Same as `app` (OD-007 self-hosted on dashboard) |
| `seed.cerniq.io` *(future)* | Self-hosted Radicle seed node (Tier 4 §2) |

### 2.7 — GitHub Actions secrets

For every Tier 2 deploy to work in CI, the same env vars must be in
the repo's GitHub Actions secrets:

```bash
gh secret set STRIPE_SECRET_KEY < /dev/stdin   # paste, then Ctrl-D
gh secret set STRIPE_WEBHOOK_SECRET
# ...repeat for every REQUIRED-PROD var in .env.example
```

The `Release` workflow that currently fails is failing because these
aren't set. Once Tier 2 is provisioned, set them and the Release
workflow goes green.

---

## Tier 3 — observability + ops hygiene

### 3.1 — OpenTelemetry endpoint

Pick a backend; honeycomb.io and grafana.com both have free tiers
generous enough for early-stage usage.

```bash
CERNIQ_OTEL_ENABLED=true
CERNIQ_OTEL_EXPORTER=otlp-http
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io/v1/traces
OTEL_RESOURCE_ATTRIBUTES=service.name=cerniq-api,deployment.environment=production
CERNIQ_REGION=us-east-1
```

Verification: trigger a `/v1/verify` call and confirm a trace appears in
your OTel backend within 30 seconds.

### 3.2 — Sentry (optional but expected for SOC2)

```bash
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
```

### 3.3 — Status page (OD-007 — self-hosted on dashboard)

No new credentials. The route `apps/dashboard/app/status/page.tsx` reads
`incidents.{open,history}.json` published from the management API.
Once dashboard is deployed (Tier 2 §2.4), point DNS for
`status.cerniq.io` to the same Vercel deployment.

### 3.4 — `sales@cerniq.io` mailbox

Google Workspace ($6/user/mo) or Microsoft 365. Required because
`AUTH0_ACTION_SECRET` is shared with a real org email for the customer
sales flow per `docs/spec/04_COMMERCIAL_STRATEGY.md`. Not gating any
code path.

---

## Tier 4 — hygiene

### 4.1 — Re-encrypt the local Radicle node key

The bootstrap left the local Radicle key unencrypted at
`~/.radicle/keys/radicle` for setup convenience (see SESSION_HANDOFF
2026-05-23). Production-grade hygiene wants a passphrase:

```bash
rad auth   # walks you through setting a passphrase on the existing identity
```

No DID change, no project re-init. Passphrase belongs in your password
manager.

### 4.2 — (Optional) Self-hosted Radicle seed node

Right now the canonical is held by 4–6 public community seeders. For
brand-aligned sovereignty (you eat what you ship), spin up your own
seed node on a small VPS:

| Provider | Spec | Monthly |
| --- | --- | --- |
| Fly.io shared-cpu-1x | 256 MB | ~$2 |
| Hetzner CX11 | 1 vCPU / 4 GB | €4.51 |
| DigitalOcean Basic Droplet | 1 vCPU / 1 GB | $6 |

Install steps (Ubuntu 24.04):

```bash
curl -fsSL https://files.radicle.xyz/releases/1.9.1/radicle-1.9.1-x86_64-unknown-linux-musl.tar.xz \
  | tar -xJ -C /usr/local/
sudo cp /usr/local/radicle-*/bin/* /usr/local/bin/
sudo useradd -r -m -s /bin/bash radicle
sudo -u radicle bash -c 'RAD_PASSPHRASE="" rad auth --alias cerniq-seed && rad node start --listen 0.0.0.0:8776'
# Optional: systemd unit for restart-on-reboot
```

Add a DNS record `seed.cerniq.io → <VPS IP>`. Then add the seed's node
ID to the project's preferred seed list via `rad seed add`.

### 4.3 — Dependabot vuln triage

Current: 1 critical + 5 high + 14 moderate + 1 low. Listed at
https://github.com/KLYTICS/cerniq/security/dependabot. Each alert
either patches via an override (pattern: `>=PATCHED <NEXT_MAJOR`, see
the `brace-expansion` precedent in `package.json`) or via direct dep
bump.

### 4.4 — Resolve open `OPERATOR_DECISIONS.md` rows

13 rows (OD-001, OD-002, OD-004 through OD-016 minus the DECIDED ones).
The register encodes silent-consent-by-default for each — if you don't
respond by the due date, the default ships. Re-read weekly.

---

## Appendix — env var → consumer file map

| Env var | Consumer file | Behavior if absent |
| --- | --- | --- |
| `CERNIQ_SIGNING_PRIVATE_KEY` | `apps/api/src/modules/audit/audit-signing.service.ts` | Boot fails-loud in prod |
| `JWT_ED25519_PRIVATE_KEY_B64` | `apps/api/src/modules/auth/jwt.service.ts` | Boot fails-loud in prod |
| `CERNIQ_WEBHOOK_SECRET_DEK_B64` | `apps/api/src/common/crypto/webhook-secret-cipher.ts` | Ephemeral DEK in dev; boot fails in prod |
| `CERNIQ_KMS_PROVIDER` + KMS_* | `apps/api/src/modules/kms/kms.module.ts` | `in-memory` refuses prod boot |
| `AUTH0_ISSUER` / `AUTH0_AUDIENCE` | `apps/api/src/modules/auth/auth0-bridge.guard.ts` | `AUTH0_REQUIRED=false` defaults open |
| `STRIPE_SECRET_KEY` | `apps/api/src/modules/billing/stripe.client.ts` | `BillingService` becomes no-op |
| `STRIPE_PRICE_DEVELOPER` / `STRIPE_PRICE_GROWTH` / `STRIPE_PRICE_ENTERPRISE` | `apps/api/src/modules/billing/stripe.service.ts` (via `config.service.ts` getters) | `/v1/billing/checkout` returns 503 for that tier |
| `STRIPE_PRICE_OVERAGE_VERIFY` | `apps/api/src/modules/billing/stripe.service.ts` | Paid overage NOT metered (warn-logged) |
| `WORKOS_API_KEY` / `WORKOS_COOKIE_PASSWORD` | `apps/api/src/modules/idp-workos/idp-workos.module.ts` | Factory throws iff WorkOS adapter is bound; Auth0 default unaffected |
| `CERNIQ_ADMIN_TOKEN` | `apps/api/src/modules/onboarding/onboarding.controller.ts` (raw `process.env`) | **Fail-closed** — admin backfill endpoints 403 |
| `CERNIQ_ONBOARDING_BACKFILL_CRON` | `apps/api/src/modules/onboarding/onboarding.backfill.ts` (raw, `@Cron`) | Defaults to `*/5 * * * *` |
| `CERNIQ_AUDIT_RETENTION_INTERVAL_MS` | `apps/api/src/modules/compliance/audit-retention.service.ts` (raw) | Built-in default cadence |
| `DATABASE_URL` / `REDIS_URL` | `apps/api/src/config/config.service.ts` | Boot fails immediately |
| `SENTRY_DSN` | `apps/api/src/common/observability/sentry.bootstrap.ts` | Silent (errors not reported) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `apps/api/src/common/observability/tracing.bootstrap.ts` | Tracing disabled with stderr note |
| `CERNIQ_API_URL` | `scripts/benchmark-verify.ts`, `apps/api/test/load/verify.load.test.ts` (bench/load only — dashboard now uses `CERNIQ_API_BASE_URL`) | Bench/load default localhost |
| `CERNIQ_DASHBOARD_EMAIL` | `apps/dashboard/lib/auth.ts` | Defaults to `developer@local` |
| `NEXT_PUBLIC_DOCS_URL` | `apps/docs/app/{layout,sitemap,robots}.ts` | Defaults to `https://docs.cerniq.io` |
| `CERNIQ_API_KEY` / `CERNIQ_BASE_URL` | `packages/cli/src/credentials.ts`, `packages/mcp-server/src/server.ts` | CLI/MCP throw if key absent; base defaults to `https://api.cerniq.dev` |
| `CERNIQ_VERIFY_KEY` | `packages/mcp-bridge/src/index.ts` | Bridge verify disabled / errors per config |

---

*Last updated 2026-05-23. Pair with `OPERATOR_DECISIONS.md` for the
decisions each credentialed surface implements. Each Tier is a coherent
unit; the next Tier becomes meaningful only once the current one is
green.*
