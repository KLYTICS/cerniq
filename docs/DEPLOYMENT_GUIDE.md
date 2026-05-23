# OKORO — Production Deployment Guide

## Railway Origin + Cloudflare Workers Edge + Redis + PostgreSQL

> **Audience:** DevOps / SRE / Platform engineers deploying OKORO for the first time or managing ongoing deployments.  
> **Covers:** Railway (origin API), Cloudflare Workers (edge verify), PostgreSQL 16, Redis 7, environment configuration, secrets management, zero-downtime migration, health verification.

---

## Architecture Overview

```
Internet
    │
    ├──► Cloudflare Workers (edge verify, ~230 PoPs globally)
    │        │  KV cache hit → immediate APPROVED/DENIED (<30ms)
    │        │  Cache miss / spend ambiguity → proxy to origin
    │        ▼
    ├──► Railway (origin API, NestJS)
    │        │  Full verify algorithm execution (<200ms p99)
    │        │  Identity / Policy CRUD
    │        │  BATE signal processing (BullMQ)
    │        │  Audit chain append (PostgreSQL)
    │        ▼
    ├──► PostgreSQL 16 (Railway managed or external)
    │        Primary: writes + reads that need consistency
    │        Read replica: audit export queries
    │        Connection pooler: PgBouncer (transaction mode)
    │
    └──► Redis 7 (Railway managed or Upstash)
             Spend counters (atomic INCRBY)
             Trust score cache (30s TTL)
             Policy/agent warm cache (5min TTL)
             Replay JTI cache (token TTL + 90s)
             BullMQ job queues
```

---

## Part 1 — Prerequisites

### Required accounts

- [Railway](https://railway.app) account (Hobby or Pro plan)
- [Cloudflare](https://cloudflare.com) account (Workers Paid plan — $5/month, needed for KV storage)
- Domain (e.g., `okoroapp.com`) with DNS on Cloudflare

### Required tools

```bash
# Node.js 20+ and pnpm
node --version   # ≥ 20.0.0
pnpm --version   # ≥ 8.0.0

# Railway CLI
npm install -g @railway/cli
railway login

# Wrangler (Cloudflare Workers)
npm install -g wrangler
wrangler login

# Prisma CLI (for migrations)
pnpm add -g prisma
```

---

## Part 2 — Database Setup

### 2.1 PostgreSQL on Railway

```bash
# Create a new Railway project
railway init okoro-production

# Add PostgreSQL plugin
railway add postgresql

# Get the connection string
railway variables | grep DATABASE_URL
# DATABASE_URL=postgresql://postgres:xxx@containers-us-west-xxx.railway.app:5432/railway
```

### 2.2 Run Migrations

```bash
# From repo root
cd apps/api

# Set the production DATABASE_URL
export DATABASE_URL="postgresql://postgres:xxx@.../railway"

# Apply all migrations (idempotent)
pnpm prisma migrate deploy

# Verify migrations applied
pnpm prisma migrate status
# Migrations applied:
#   ✓ 20260502000000_init
#   ✓ 20260502000100_audit_append_only
#   ✓ 20260502000200_row_level_security
#   ✓ 20260502000300_audit_redact_session_var
#   ✓ 20260502000400_idp_federation_and_rp_ownership
#   ✓ 20260502000500_enterprise_backbone
#   ✓ 20260502000600_principal_onboarding
```

### 2.3 Row-Level Security Setup

RLS is applied via migrations. Verify it's active:

```sql
-- Connect to your database and run:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('AgentIdentity', 'AgentPolicy', 'AuditEvent', 'BateSignal');

-- Expected output:
-- tablename    | rowsecurity
-- AgentIdentity | t
-- AgentPolicy   | t
-- AuditEvent    | t
-- BateSignal    | t
```

### 2.4 Connection Pooling (PgBouncer)

For production workloads >100 req/s, add PgBouncer as a Railway service:

```bash
# Railway PgBouncer template
railway add pgbouncer

# Set PgBouncer env
PGBOUNCER_DATABASE_URL=$DATABASE_URL
PGBOUNCER_POOL_MODE=transaction        # Critical: transaction mode for Prisma
PGBOUNCER_MAX_CLIENT_CONN=1000
PGBOUNCER_DEFAULT_POOL_SIZE=20

# Update app DATABASE_URL to point to PgBouncer
DATABASE_URL=postgresql://postgres:xxx@pgbouncer-host:6432/railway?pgbouncer=true
```

**Prisma with PgBouncer:** Add `?pgbouncer=true&connection_limit=1` to DATABASE_URL in Prisma config (disables prepared statements which don't work with PgBouncer in transaction mode).

---

## Part 3 — Redis Setup

### 3.1 Redis on Railway

```bash
railway add redis

# Get Redis URL
railway variables | grep REDIS_URL
# REDIS_URL=redis://:password@containers-us-west-xxx.railway.app:6379
```

### 3.2 Redis Configuration

Connect to Redis and apply production settings:

```bash
redis-cli -u $REDIS_URL

# Memory policy: evict least-recently-used keys when memory full
CONFIG SET maxmemory-policy allkeys-lru

# Memory limit (adjust to your plan)
CONFIG SET maxmemory 1gb       # Development / Starter
# CONFIG SET maxmemory 8gb    # Production

# Persistence: AOF for durability on spend counters
CONFIG SET appendonly yes
CONFIG SET appendfsync everysec

# Verify
CONFIG GET maxmemory-policy
CONFIG GET appendonly
```

### 3.3 Redis Key Taxonomy

Understanding the Redis keyspace is critical for debugging and capacity planning:

| Key pattern                                   | TTL                | Purpose                                          |
| --------------------------------------------- | ------------------ | ------------------------------------------------ |
| `agent:{agentId}`                             | 300s               | Cached agent record (status, trustScore, pubkey) |
| `policy:{policyId}`                           | 300s               | Cached policy record                             |
| `verify:{jti}`                                | token TTL + 90s    | Replay prevention (JTI seen)                     |
| `spend:day:{agentId}:{policyId}:{dateKey}`    | 90000s (25h)       | Per-day spend counter                            |
| `spend:month:{agentId}:{policyId}:{monthKey}` | 35 days            | Per-month spend counter                          |
| `bate:score:{agentId}`                        | 30s                | Trust score hot cache                            |
| `idp:session:{sessionId}`                     | 900s               | IDP session cache (Auth0/Clerk)                  |
| `jti:{jti}`                                   | token residual TTL | Replay cache                                     |

---

## Part 4 — Environment Variables

Complete reference for all `apps/api` environment variables. Set these in Railway → Variables.

### 4.1 Required (API will not start without these)

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Redis
REDIS_URL=redis://:password@host:6379

# OKORO signing keys (Ed25519, base64url-encoded)
# Generate with: npx tsx scripts/generate-okoro-keys.ts
OKORO_AUDIT_PRIVATE_KEY=<base64url-encoded 32-byte Ed25519 private key>
OKORO_AUDIT_PUBLIC_KEY=<base64url-encoded 32-byte Ed25519 public key>
OKORO_JWT_SIGNING_KEY=<base64url-encoded 32-byte Ed25519 private key>
OKORO_JWT_VERIFICATION_KEY=<base64url-encoded 32-byte Ed25519 public key>

# API key encryption
OKORO_API_KEY_BCRYPT_COST=12       # 4 in test, 12 in prod

# Admin token (for internal admin endpoints)
OKORO_ADMIN_TOKEN=<random 32-byte hex>

# Application
NODE_ENV=production
PORT=3000
LOG_LEVEL=info                       # debug | info | warn | error
```

### 4.2 Optional — Feature Flags

```bash
# DPoP (RFC 9449) — require DPoP proofs on verify calls
OKORO_DPOP_REQUIRED=false            # default: false (v1.0 optional, v1.1 will require)

# Post-quantum hybrid signatures
OKORO_HYBRID_PQ_ENABLED=false        # default: false (see OD-014)

# Policy engines available to principals
OKORO_POLICY_ENGINES=builtin         # builtin | builtin,cedar | builtin,cedar,opa

# BATE feature flag
OKORO_BATE_ENABLED=true              # default: true

# Edge Worker feature flag (shadows origin when SHADOW, serves edge when LIVE)
OKORO_EDGE_VERIFY_ENABLED=false      # default: false until shadow validation passes

# Onboarding backfill cron schedule
OKORO_ONBOARDING_BACKFILL_CRON="*/5 * * * *"  # default: every 5 minutes
```

### 4.3 Optional — Observability

```bash
# OpenTelemetry
OKORO_OTEL_ENABLED=true
OKORO_OTEL_SERVICE_NAME=okoro-api
OKORO_OTEL_EXPORTER=otlp            # otlp | jaeger | zipkin | console
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-collector:4318
OKORO_OTEL_TRACE_SAMPLE_RATE=0.1    # 10% sampling in prod

# Prometheus metrics endpoint
OKORO_METRICS_ENABLED=true
OKORO_METRICS_PATH=/metrics         # default
OKORO_METRICS_AUTH_TOKEN=<token>    # optional bearer token for /metrics
```

### 4.4 Optional — KMS (Enterprise)

```bash
# Choose ONE provider: local | aws | gcp | vault
OKORO_KMS_PROVIDER=local            # default (uses env keys above)

# --- AWS KMS ---
OKORO_KMS_PROVIDER=aws
OKORO_AWS_KMS_AUDIT_KID=kid-audit-v1
OKORO_AWS_KMS_AUDIT_WRAPPED=<base64-envelope-encrypted-privkey>
OKORO_AWS_KMS_AUDIT_PUB=<base64url-pubkey>
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>

# --- GCP Cloud KMS ---
OKORO_KMS_PROVIDER=gcp
OKORO_GCP_KMS_KEY_VERSION_NAME=projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# --- HashiCorp Vault ---
OKORO_KMS_PROVIDER=vault
VAULT_ADDR=https://vault.internal:8200
VAULT_TOKEN=<vault-token>
OKORO_VAULT_AUDIT_KEY_NAME=okoro-audit
```

### 4.5 Optional — Identity Providers

```bash
# Default IdP (auth0 | clerk | workos)
OKORO_IDP_PROVIDER=auth0

# Auth0
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.okoroapp.com/v1
AUTH0_CLIENT_ID=<client-id>
AUTH0_CLIENT_SECRET=<client-secret>

# Clerk
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...

# WorkOS
WORKOS_API_KEY=sk_...
WORKOS_CLIENT_ID=client_...
```

### 4.6 Optional — Webhooks + Billing

```bash
# Stripe (billing module)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_DEVELOPER=price_...
STRIPE_PRICE_ID_GROWTH=price_...

# Webhook signing secret (for outbound webhooks to customers)
OKORO_WEBHOOK_SIGNING_SECRET=<random 32-byte hex>

# Webhook delivery config
OKORO_WEBHOOK_MAX_ATTEMPTS=8        # default: 8
OKORO_WEBHOOK_INITIAL_DELAY_MS=1000 # default: 1s, doubles each retry
```

---

## Part 5 — Railway Deployment

### 5.1 Initial Deploy

```bash
# Link local repo to Railway project
railway link okoro-production

# Deploy the API service
railway up \
  --service api \
  --detach

# Monitor logs
railway logs --service api --tail

# Get the service URL
railway status
# API URL: https://okoro-production-api.up.railway.app
```

### 5.2 Railway Configuration (`railway.json`)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pnpm install --frozen-lockfile && pnpm -F @okoro/api build"
  },
  "deploy": {
    "startCommand": "node apps/api/dist/main.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 10,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

### 5.3 Railway Service Configuration

In Railway dashboard → Service → Settings:

```
Memory: 512 MB (starter) | 2 GB (production)
CPU: 1 vCPU (starter) | 4 vCPU (production)
Replicas: 1 (starter) | 3 (production, with load balancing)
Region: US West (or closest to your users)
Deployment trigger: main branch (auto-deploy on push)
```

### 5.4 Zero-Downtime Deploys

Railway supports rolling deploys. To enable:

1. Set replicas > 1 in Railway dashboard
2. Add health check: `GET /health` returns 200 within 10s
3. Railway will deploy to new instances, wait for health checks, then drain old instances

---

## Part 6 — Cloudflare Workers Edge Deployment

### 6.1 Create KV Namespaces

```bash
# Create KV namespaces for edge cache
wrangler kv:namespace create "OKORO_AGENT_CACHE"
wrangler kv:namespace create "OKORO_POLICY_CACHE"
wrangler kv:namespace create "OKORO_SPEND_CACHE"

# Note the IDs output by each command
# OKORO_AGENT_CACHE: id = "abc123..."
# OKORO_POLICY_CACHE: id = "def456..."
# OKORO_SPEND_CACHE: id = "ghi789..."
```

### 6.2 Configure `wrangler.toml`

```toml
# workers/cf-verify/wrangler.toml
name = "okoro-verify"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[env.production]
name = "okoro-verify-production"
routes = [
  { pattern = "api.okoroapp.com/v1/verify", zone_name = "okoroapp.com" }
]

[[kv_namespaces]]
binding = "AGENT_CACHE"
id = "abc123..."     # From step 6.1

[[kv_namespaces]]
binding = "POLICY_CACHE"
id = "def456..."

[[kv_namespaces]]
binding = "SPEND_CACHE"
id = "ghi789..."

[vars]
OKORO_ORIGIN_URL = "https://okoro-production-api.up.railway.app"
OKORO_EDGE_VERIFY_MODE = "shadow"   # shadow | live | off
                                     # Start with shadow to validate parity
```

### 6.3 Deploy

```bash
cd workers/cf-verify

# Install deps
pnpm install

# Deploy to production
wrangler deploy --env production

# Verify deployment
curl -X POST https://api.okoroapp.com/v1/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "test"}' \
  -v
# Should see: X-OKORO-Edge-Divergence: edge-forward:no-edge-decision (shadow mode)
```

### 6.4 Shadow Mode → Live Promotion

The edge Worker starts in `shadow` mode: it runs BOTH the edge algorithm AND forwards to origin, then compares results. Monitor divergence for 48–72 hours before promoting to `live`:

```bash
# Monitor divergence rate via Cloudflare Analytics
wrangler tail --env production 2>&1 | grep "Divergence"

# When divergence < 0.1% over 48h, promote to live:
# In wrangler.toml:
# OKORO_EDGE_VERIFY_MODE = "live"
wrangler deploy --env production

# Live mode: edge serves <30ms responses; only forwards on cache miss
```

---

## Part 7 — Generating Production Keys

Never use development keys in production. Generate fresh keys:

```bash
cd apps/api

# Generate all OKORO signing keys
pnpm tsx scripts/generate-okoro-keys.ts

# Output:
# ══════════════════════════════════════════════════════
# OKORO Production Key Generation
# Generated: 2026-05-04T14:32:00Z
# ══════════════════════════════════════════════════════
#
# JWT Signing Key (Ed25519)
# Private: 4a3bf...  ← SET AS OKORO_JWT_SIGNING_KEY
# Public:  9f2cd...  ← SET AS OKORO_JWT_VERIFICATION_KEY
#
# Audit Signing Key (Ed25519)
# Private: 7e1ad...  ← SET AS OKORO_AUDIT_PRIVATE_KEY
# Public:  3c8fg...  ← SET AS OKORO_AUDIT_PUBLIC_KEY
#
# ⚠️  These keys are shown ONCE. Store in a secrets manager.
# ⚠️  The audit key determines chain verifiability — rotate carefully.
# ══════════════════════════════════════════════════════
```

**Store in:** Railway Variables (for Railway) or a secrets manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault). Never commit to git.

---

## Part 8 — Health Verification

After deployment, run through this checklist:

```bash
export BASE=https://api.okoroapp.com/v1

# 1. Liveness check (no auth)
curl $BASE/../health
# { "status": "ok", "timestamp": "..." }

# 2. Readiness check (DB + Redis ping)
curl $BASE/../ready \
  -H "X-OKORO-Admin: $OKORO_ADMIN_TOKEN"
# { "status": "ready", "db": "ok", "redis": "ok" }

# 3. Metrics endpoint
curl $BASE/../metrics \
  -H "Authorization: Bearer $OKORO_METRICS_AUTH_TOKEN" | head -30

# 4. Full E2E smoke test
cd tests/e2e
OKORO_API_BASE=$BASE \
OKORO_API_KEY=sk_live_... \
pnpm vitest run 01_health 02_principal 03_agent

# 5. Verify audit chain integrity
pnpm tsx scripts/audit-verify-chain.ts \
  --api-base $BASE \
  --api-key $OKORO_API_KEY \
  --principal-id <your-principal-id> \
  --limit 100

# 6. Edge Worker health
curl -X POST https://api.okoroapp.com/v1/verify \
  -H "Content-Type: application/json" \
  -H "X-OKORO-Verify-Key: vk_live_..." \
  -d '{"token": "eyJhbGciOiJFZERTQSJ9.test.sig"}' \
# Should return 403 with denialReason: INVALID_SIGNATURE (not a 500)
```

---

## Part 9 — Custom Domain + TLS

```bash
# 1. In Cloudflare DNS, add CNAME:
# api.okoroapp.com → okoro-production-api.up.railway.app

# 2. Railway: add custom domain
railway domain add api.okoroapp.com --service api

# 3. Cloudflare: SSL mode = Full (strict)
# Cloudflare → okoroapp.com → SSL/TLS → Full (strict)

# 4. Verify TLS
curl -v https://api.okoroapp.com/health 2>&1 | grep "SSL connection"
# * SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384
```

---

## Part 10 — Rollback Procedure

```bash
# Railway: roll back to previous deployment
railway rollback --service api

# Or deploy a specific commit
git checkout <safe-commit>
railway up --service api

# Cloudflare Workers: roll back
wrangler rollback --env production

# Database: migrations are forward-only (append-only audit log invariant)
# If a migration causes issues:
# 1. Deploy previous app version (compatible with current schema)
# 2. Write a FORWARD migration to fix the issue
# NEVER run `prisma migrate reset` in production
```

---

## Part 11 — Monitoring & Alerting Setup

See `docs/MONITORING_OBSERVABILITY.md` for full OTel + Prometheus setup.

**Minimum alerts to configure before GA:**

| Alert                                        | Condition                | Severity |
| -------------------------------------------- | ------------------------ | -------- |
| Verify p99 latency                           | >200ms for 5 minutes     | P1       |
| Error rate on /v1/verify                     | >1% for 2 minutes        | P1       |
| Redis connection errors                      | any                      | P1       |
| DB connection pool exhausted                 | >90% for 5 minutes       | P1       |
| Audit chain integrity check failure          | any                      | P0       |
| Spend counter divergence (Redis vs Postgres) | >$10                     | P1       |
| Free tier rate limit hit rate                | >30% of all verify calls | P2       |

---

_Last updated: 2026-05-04 | Stack: NestJS 11 · PostgreSQL 16 · Redis 7 · CF Workers_
