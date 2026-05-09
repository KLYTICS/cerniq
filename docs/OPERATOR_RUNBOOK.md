# AEGIS — Operator Runbook

> **Audience:** the operator (Erwin) and any contractor with full repo access.
> **Goal:** every step from `git clone` to first paying customer, with exact commands.
> **Status:** authoritative. If a section drifts from reality, fix this file in the same PR.

---

## 0. Prerequisites

```
node ≥ 20.11    pnpm ≥ 9      docker (for local Postgres + Redis)
git              gh (optional, for PR + issue ops)
```

A Stripe test account if you want to walk the billing flow end-to-end.

---

## 1. Local bootstrap (~3 minutes)

```sh
git clone <repo> aegis && cd aegis
cp .env.example .env
pnpm install
pnpm db:up                   # Postgres 16 + Redis 7 via docker-compose
pnpm tsx scripts/generate-aegis-keys.ts > .keys.local
# Paste AEGIS_SIGNING_*, JWT_ED25519_*, and AEGIS_WEBHOOK_SECRET_DEK_B64 into .env
pnpm db:migrate              # Apply all Prisma migrations
pnpm seed:dev                # Idempotent dev fixtures (principal + agent + policy)
pnpm dev                     # API on http://localhost:4000  +  /docs
```

In another terminal:

```sh
pnpm dev:dashboard           # Dashboard on http://localhost:3000
```

`.aegis-dev-key.txt` (mode 0600) holds the seeded agent's private key.
The seed prints the API key to use as `AEGIS_DASHBOARD_API_KEY`.

### Smoke test

```sh
curl -s http://localhost:4000/health/live  | jq        # → {"status":"ok"}
curl -s http://localhost:4000/health/ready | jq        # → status: 'ok' if DB+Redis+KMS up
curl -s http://localhost:4000/.well-known/audit-signing-key | jq
curl -s http://localhost:4000/.well-known/aegis-configuration | jq    # full discovery doc
curl -s http://localhost:4000/.well-known/security.txt
curl -s http://localhost:4000/.well-known/llms.txt
```

A successful `aegis-configuration` fetch is the fastest way to confirm
the public discovery surface is live. Every relying party integrating
AEGIS will hit this URL first.

---

## 2. The everything-green gate

Before pushing or opening a PR:

```sh
pnpm check
```

Runs typecheck → lint → unit tests → OpenAPI↔Zod parity → OpenAPI↔Prisma parity → migration immutability.
Same gate CI enforces. Fix locally; never disable.

---

## 3. Adding a schema change (immutability discipline)

```sh
# 1. Edit apps/api/prisma/schema.prisma
# 2. Generate migration (note --create-only — review SQL before applying)
pnpm --filter @aegis/api exec prisma migrate dev --name <descriptive_snake_case> --create-only
# 3. Review apps/api/prisma/migrations/<timestamp>_<name>/migration.sql
# 4. Apply locally
pnpm db:migrate
# 5. Add tests for the new shape if it's a public surface (DTO, service method)
# 6. Commit. Once committed, this migration's bytes are FROZEN.
#    Any further correction = a NEW migration, never an edit.
```

The pre-commit hook + CI both run `pnpm check:migrations` to enforce this.
Forward-only is non-negotiable — see `docs/IMMUTABILITY.md` § "Migrations".

---

## 4. Production deploy (Railway)

### 4.1 First-time setup

```sh
# Install Railway CLI:  brew install railway
railway login
railway init                    # Link this repo to a Railway project
railway add postgresql          # Provision Postgres
railway add redis               # Provision Redis
```

### 4.2 Set production environment

For each entry in `.env.example` marked `[REQUIRED-PROD]`:

```sh
# Crypto: do NOT generate prod keys on a developer laptop. Use the KMS
# adapter — set AEGIS_KMS_PROVIDER=aws (or gcp/vault) and provide:
railway variables set AEGIS_KMS_PROVIDER=aws
railway variables set AWS_REGION=us-east-1
railway variables set AEGIS_AWS_KMS_AUDIT_KID=<from KMS>
railway variables set AEGIS_AWS_KMS_AUDIT_WRAPPED=<wrapped private key>
railway variables set AEGIS_AWS_KMS_AUDIT_PUB=<public key b64url>

# Webhook secret-at-rest DEK (32 bytes b64):
railway variables set AEGIS_WEBHOOK_SECRET_DEK_B64=$(openssl rand -base64 32)

# Stripe (after setting up products + prices in dashboard.stripe.com):
railway variables set STRIPE_SECRET_KEY=sk_live_...
railway variables set STRIPE_WEBHOOK_SECRET=whsec_...
railway variables set STRIPE_PRICE_DEVELOPER=price_...
railway variables set STRIPE_PRICE_GROWTH=price_...
railway variables set STRIPE_PRICE_ENTERPRISE=price_...
railway variables set STRIPE_CHECKOUT_SUCCESS_URL=https://app.aegislabs.io/billing/success
railway variables set STRIPE_CHECKOUT_CANCEL_URL=https://app.aegislabs.io/billing/cancel
railway variables set STRIPE_PORTAL_RETURN_URL=https://app.aegislabs.io/settings/billing

# Observability:
railway variables set AEGIS_OTEL_ENABLED=true
railway variables set OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.your-collector
railway variables set SENTRY_DSN=https://...@sentry.io/...
railway variables set AEGIS_REGION=us-east-1

# CORS — restrict to your dashboard origins in prod:
railway variables set CORS_ORIGINS=https://app.aegislabs.io,https://docs.aegislabs.io

# Required prod posture:
railway variables set NODE_ENV=production
railway variables set ENABLE_SWAGGER=false      # don't expose internal docs
railway variables set API_KEY_BCRYPT_COST=12
```

### 4.3 Stripe webhook endpoint

In the Stripe dashboard → Developers → Webhooks, add an endpoint:

```
URL:     https://api.aegislabs.io/v1/billing/webhook
Events:  checkout.session.completed,
         customer.subscription.created,
         customer.subscription.updated,
         customer.subscription.deleted,
         invoice.payment_failed
```

Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.

### 4.4 Deploy

```sh
railway up                      # Builds + deploys
railway run pnpm db:deploy      # Apply migrations against production DB
```

### 4.5 Production smoke test

```sh
PROD=https://api.aegislabs.io
curl -s $PROD/health/live  | jq                  # Must return status: ok
curl -s $PROD/health/ready | jq                  # All checks: ok
curl -s $PROD/.well-known/audit-signing-key | jq # JWKS-style key surface

# Authenticated:
KEY=<your full-scope api key>
curl -s -H "X-AEGIS-API-Key: $KEY" $PROD/v1/agents | jq
```

---

## 5. First customer flow

```
1. Customer signs up (Auth0 — once M-020 lands; stub flow until then).
2. AEGIS provisions Principal + ApiKey.
3. Customer redirected to dashboard /billing.
4. Customer clicks "Subscribe to Developer ($49/mo)".
5. POST /v1/billing/checkout returns Stripe Checkout URL.
6. Customer completes payment in Stripe-hosted Checkout.
7. Stripe POSTs `checkout.session.completed` to /v1/billing/webhook.
8. StripeService.handleWebhookEvent → Principal.planTier = DEVELOPER + invalidate UsageGuard cache.
9. Audit row written: action='billing.subscription.created'.
10. Customer's verify quota lifts from 1k/mo (FREE) to 50k/mo (DEVELOPER).
```

If something breaks mid-flow, check:
- `GET /v1/billing/plan` for current state per principal
- `GET /v1/audit-events/export` filtered by `action='billing.*'`
- Stripe dashboard → Webhooks → recent deliveries (Stripe retries 5xx)

---

## 6. Common ops

| Need | Command / endpoint |
| --- | --- |
| Tail an agent's events | `aegis events tail --agent-id <id>` |
| Revoke an agent | `aegis agents revoke <id>` (or `DELETE /v1/agents/:id`) |
| Force a plan change | `UPDATE Principal SET planTier='DEVELOPER' WHERE id='...'` then `DEL aegis:plan:<principalId>` in Redis |
| Rotate audit-signing key | Add new key to KMS, update `AEGIS_SIGNING_KEY_ROTATED_AT`, restart pods. JWKS surfaces both for 24h. |
| Replay a Stripe webhook | Stripe dashboard → Events → "Resend" — handler is idempotent on `event.id` |
| Verify the audit chain offline | `pnpm tsx scripts/audit-verify-chain.ts <tenant.ndjson> <pubkey>` |
| Trigger BATE recompute | `POST /v1/agents/:id/bate/recompute` (admin) |
| Dump a tenant's audit trail | `GET /v1/audit-events/export?from=<iso>&to=<iso>` (NDJSON streaming) |

---

## 7. Rollback

Railway keeps the previous deployment alive while the new one warms. To roll back:

```sh
railway down --service api      # Roll back the API
# OR via dashboard: Project → Deployments → Promote previous
```

Database rollback: forward-only migrations preclude automated rollback.
For genuine emergencies, `pnpm --filter @aegis/api exec prisma migrate resolve --rolled-back <migration>` and write a new forward migration.
**Do not edit the offending migration in place** — the immutability check will block your next commit.

---

## 8. Incident triage

```
Symptom                              First diagnostic
─────────────────────────────────────────────────────────────────────────
Verify p99 spiking                   /metrics → aegis_verify_latency_seconds
                                     Trace span: aegis.verify.algorithm
Audit append failing                 /metrics → aegis_audit_append_total{decision="error"}
                                     Trace span: aegis.audit.chain.append
KMS round-trip slow                  Trace span: aegis.kms.{aws|gcp|vault}.sign
Webhook deliveries piling up         WebhookDelivery table → status='failed'
                                     Span: aegis.webhook.delivery.attempt
Stripe customer plan stuck           BillingEvent table (peer Redis SETNX log)
                                     /v1/billing/plan vs DB Principal.planTier
Dashboard returns 401 everywhere     AEGIS_DASHBOARD_API_KEY rotated/revoked
Silent verify denials                Audit trail: GET /v1/audit-events/export
                                     Filter decision='DENIED' — denialReason tells you which step
```

---

## 9. Where to look for what

| Concern | File |
| --- | --- |
| Architectural invariants | `CLAUDE.md` |
| Threat model | `docs/THREAT_MODEL.md` |
| Capacity + sizing | `docs/CAPACITY_PLAN.md` |
| Failure mode analysis | `docs/FAILURE_MODES.md` |
| Retention policy | `docs/RETENTION_POLICY.md` |
| Decision register | `docs/decisions/` (ADRs 0001–0013+) |
| Active operator decisions | `OPERATOR_DECISIONS.md` |
| Active claims + open work | `WORK_BOARD.md` |
| Session-by-session log | `docs/SESSION_HANDOFF.md` |
| Concurrent-session protocol | `docs/PARALLEL_SESSIONS.md` |
| Immutability invariants | `docs/IMMUTABILITY.md` |
