# infra/railway — Production deploy runbook

Phase 1 production target. CERNIQ runs as four Railway services in a single
project, all in `us-east`:

| Service         | Descriptor              | Public ingress | Notes                            |
| --------------- | ----------------------- | -------------- | -------------------------------- |
| `cerniq-api`    | `api.service.json`      | yes (HTTPS)    | NestJS, attaches a custom domain |
| `cerniq-worker` | `worker.service.json`   | no             | BATE / webhook / audit queues    |
| `cerniq-pg`     | `postgres.service.json` | no             | Or external Neon                 |
| `cerniq-redis`  | `redis.service.json`    | no             | Or external Upstash              |

The legacy `cerniq-api.json` in this directory predates the Phase-1 split and
is kept only so Railway's old service link resolves. **New deploys use
`api.service.json`.**

---

## 1. Pre-flight (do this once per Railway project)

1. Install the CLI: `brew install railway` (or curl the install script).
2. `railway login` — opens a browser, returns a session token.
3. From the repo root: `railway link` — pick the CERNIQ project; if it
   doesn't exist yet, create it in the Railway dashboard first (the CLI's
   `railway init` defaults are noisy).
4. Confirm the four services exist:
   ```sh
   railway service list
   ```
   Expected: `cerniq-api`, `cerniq-worker`, `cerniq-pg`, `cerniq-redis`.
   If a service is missing, create it from the Railway dashboard with the
   matching name — the CLI will not auto-create services from these JSON
   files (Railway's IaC is dashboard-driven for service topology; per-
   service deploy config is what these files express).

---

## 2. Generate production keys (one-time)

```sh
pnpm tsx scripts/generate-cerniq-keys.ts --env > /tmp/cerniq-prod-keys
```

The script prints two Ed25519 keypairs as base64 env-var lines:
`JWT_ED25519_*` and `AUDIT_ED25519_*`. **Treat `/tmp/cerniq-prod-keys` like
the master key it is** — pipe it directly into Railway:

```sh
while IFS='=' read -r key value; do
  railway variables set --service cerniq-api "$key=$value"
done < /tmp/cerniq-prod-keys
shred -u /tmp/cerniq-prod-keys   # or `rm -P` on macOS
```

Mirror the **AUDIT\_** keys to `cerniq-worker` (the worker writes audit
events too — same signing key keeps the chain intact). The **JWT\_** keys
do **not** go on the worker.

If `shred` exits non-zero (e.g. tmpfs without secure-delete), unmount the
tmpfs or write the keys directly into the Railway dashboard via the web
UI and skip the file step entirely.

---

## 3. Wire the env-var matrix

Each service's `envVars` array in its JSON is the source of truth. For
each entry where `secret: true`, the `_provision` note tells you where the
value comes from. The CLI reads from the dashboard at deploy time — these
JSONs do **not** push variables.

Practical recipe:

```sh
# After provisioning Postgres + Redis plugins:
railway variables set --service cerniq-api \
  "DATABASE_URL=$(railway variables get --service cerniq-pg DATABASE_URL)"
railway variables set --service cerniq-worker \
  "DATABASE_URL=$(railway variables get --service cerniq-pg DATABASE_URL)"
railway variables set --service cerniq-api \
  "REDIS_URL=$(railway variables get --service cerniq-redis REDIS_URL)"
railway variables set --service cerniq-worker \
  "REDIS_URL=$(railway variables get --service cerniq-redis REDIS_URL)"
```

(Railway also supports reference variables — `${{ cerniq-pg.DATABASE_URL }}`
— in the dashboard, which is the preferred long-term form.)

---

## 4. Deploy

```sh
# API first (runs prisma migrate deploy on boot — see startCommand)
railway up --service cerniq-api

# Then the worker
railway up --service cerniq-worker
```

Postgres + Redis are managed plugins; they don't need `railway up`.

---

## 5. Verify deployment

Run these from your laptop after the deploy reports `SUCCESS`. Fail-mode
notes inline.

```sh
API="https://api.cerniq.<your-domain>"

# 1. Liveness — must return 200 within 200ms
curl -fsS -o /dev/null -w "live=%{http_code} t=%{time_total}s\n" "$API/v1/health/live"
# Failure: process is crashlooping. Check `railway logs --service cerniq-api`.

# 2. Readiness — must return 200; depends on Postgres + Redis
curl -fsS -o /dev/null -w "ready=%{http_code} t=%{time_total}s\n" "$API/v1/health/ready"
# Failure: DB or Redis env var wrong, or the plugin isn't running.
# Diagnose with `railway run --service cerniq-api -- env | grep -E 'DATABASE|REDIS'`.

# 3. JWKS endpoint — public key must round-trip
curl -fsS "$API/.well-known/jwks.json" | jq '.keys | length'
# Failure: JWT_ED25519_PUBLIC_KEY_B64 missing or malformed.

# 4. Audit signing key — published for chain verifiers
curl -fsS "$API/.well-known/audit-signing-key" | jq '.kty'
# Expected: "OKP". Failure: AUDIT_ED25519_PUBLIC_KEY_B64 missing.

# 5. Swagger MUST be off in production
curl -fsS -o /dev/null -w "%{http_code}\n" "$API/docs"
# Expected: 404. If 200, set ENABLE_SWAGGER=false and redeploy.

# 6. Worker is processing the heartbeat queue
railway logs --service cerniq-worker --lines 50 | grep -i "queue.*ready\|worker.*started"
# Failure: missing AUDIT_ED25519_PRIVATE_KEY_B64 on the worker, or REDIS_URL drift.
```

---

## 6. Roll forward / roll back

- **Forward**: `railway up --service cerniq-api` from a clean tree.
- **Rollback**: `railway redeploy <previous-deployment-id> --service cerniq-api`.
  Get IDs with `railway deployments list --service cerniq-api`.

If the rollback target predates a Prisma migration, **the database is
forward-only** — you cannot un-run a migration by redeploying old code.
Either restore from a Postgres backup or write a forward-fix migration.

---

## 7. Known sharp edges

- **`pnpm` resolution drift**: NIXPACKS picks `pnpm` from the lockfile by
  default, but if the build log says `npm install` instead of `pnpm
install`, NIXPACKS misdetected the package manager. Fix: set the
  `NIXPACKS_PKG_MGR=pnpm` build env var.
- **Prisma engine on alpine**: `nixpacks` defaults to a debian base, so
  this is fine. If you switch to the Dockerfile builder + alpine, you
  need `binaryTargets = ["linux-musl-openssl-3.0.x"]` in the schema.
- **Region drift**: changing the API region without also moving Postgres
  is an immediate latency regression. Move both or neither.
- **Healthcheck path**: `/v1/health/ready` MUST exist before first deploy.
  If the M-002 health module hasn't shipped, temporarily point
  `healthcheckPath` at `/v1/health/live` (also defined by the platform
  module) — a missing path makes Railway report the service as
  unhealthy regardless of actual app state.
