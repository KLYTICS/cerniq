# Railway — API deploy command sequence

> Concrete commands for §4 of [LAUNCH.md](../../LAUNCH.md). The authoritative service descriptor is [`api.service.json`](../railway/api.service.json); this file is the operator's hour-by-hour playbook.

## Prerequisites
- `railway --version` ≥ 4.x — `brew install railway` if missing
- `railway login` — once
- Production keypairs generated to clipboard (see `scripts/generate-cerniq-keys.ts`); do NOT save to disk
- Stripe live keys + price IDs in hand (see [launch-env-checklist.md §A.4](launch-env-checklist.md))

## Step 1 — Link
```sh
cd /path/to/cerniq
railway link                            # pick CERNIQ project
railway service list                    # expect cerniq-api, cerniq-worker, cerniq-pg, cerniq-redis
```
If services are missing, create them via the Railway dashboard with exactly those names. Railway CLI does not auto-create services from JSON descriptors.

## Step 2 — Wire shared variables (one-time)
```sh
# Use Railway shared-var syntax so worker inherits without re-paste
railway variables --service cerniq-api --set DATABASE_URL='${{Postgres.DATABASE_URL}}'
railway variables --service cerniq-api --set REDIS_URL='${{Redis.REDIS_URL}}'
railway variables --service cerniq-worker --set DATABASE_URL='${{Postgres.DATABASE_URL}}'
railway variables --service cerniq-worker --set REDIS_URL='${{Redis.REDIS_URL}}'
```

## Step 3 — Set secrets per launch-env-checklist
Open [`launch-env-checklist.md`](launch-env-checklist.md) §A and paste each row. The minimum P0 set:
```sh
# Generate keys in a NEW terminal so the values aren't in shell history
pnpm tsx scripts/generate-cerniq-keys.ts        # prints to stdout
# Copy each KEY=VALUE pair into Railway dashboard UI (paste, don't echo)

# Or scripted (you accept that secrets briefly enter the shell env):
railway variables --service cerniq-api \
  --set NODE_ENV=production \
  --set PORT=4000 \
  --set LOG_LEVEL=info \
  --set API_BASE_URL=https://api.cerniq.io \
  --set AUTH0_DOMAIN=YOUR.us.auth0.com \
  --set AUTH0_ISSUER=https://YOUR.us.auth0.com/ \
  --set AUTH0_AUDIENCE=https://api.cerniq.io \
  --set AUTH0_REQUIRED=true \
  --set CERNIQ_KMS_PROVIDER=in-memory \
  --set API_KEY_BCRYPT_COST=12 \
  --set ENABLE_SWAGGER=false \
  --set CORS_ORIGINS='https://app.cerniq.io,https://docs.cerniq.io'
```

> **Drift note (see [launch-env-checklist.md §F.1](launch-env-checklist.md))**: the descriptor at `infra/railway/api.service.json` still references the legacy `AUDIT_ED25519_*` names. Production must set the canonical `CERNIQ_SIGNING_*` names instead — the API accepts both and logs a deprecation warning for the legacy ones.

## Step 4 — Run migrations
```sh
# One-off — applies all checked-in migrations against the live DB
railway run --service cerniq-api -- pnpm --filter @cerniq/api prisma migrate deploy
railway run --service cerniq-api -- pnpm --filter @cerniq/api prisma migrate status
```
Expected: every migration shows `applied`. If anything is `pending`, debug before continuing.

## Step 5 — Deploy
```sh
railway up --service cerniq-api --detach
railway logs --service cerniq-api --follow
```
Watch for `Listening on port 4000` and `[NestApplication] Nest application successfully started`. First boot can take 60–90s; Railway health-check timeout is 30s so the first deployment may show a yellow "deploying" state and then green up on retry.

Repeat for `cerniq-worker`:
```sh
railway up --service cerniq-worker --detach
railway logs --service cerniq-worker --follow
```

## Step 6 — Custom domain
```sh
railway domain --service cerniq-api
# Railway prints a CNAME target. Add it to DNS:
# CNAME api.cerniq.io → <railway-target>
# Wait ~2 min for cert issuance.
```

## Step 7 — Smoke
```sh
export CERNIQ_API_BASE=https://api.cerniq.io
./scripts/launch-smoke.sh api
```
Expected exit code 0. If any check fails, follow [`docs/INCIDENT_RUNBOOK.md`](../../docs/INCIDENT_RUNBOOK.md) §3 (deploy regression).

## Step 8 — Set the `cerniq-api` to non-public if internal-only OTel needed
If `CERNIQ_OTEL_ENABLED=true` and your collector is on a Railway internal address, ensure the Prometheus exporter port (default 9464) is not exposed publicly — OD-021's CVE-accept assumes internal-only exposure.

## Rollback
```sh
railway deployments list --service cerniq-api
railway rollback --service cerniq-api --deployment <previous-id>
```
Migrations are append-only and additive (per CLAUDE.md invariant) — a rollback to a previous API version is safe as long as the DB schema is at the latest applied migration. If you need to undo a migration, hand-write a corrective `DOWN` migration on a new id; never edit a deployed migration.

## Post-launch checks (T+30min)
- [ ] `/v1/health/ready` < 500ms
- [ ] `/.well-known/audit-signing-key` returns Ed25519 JWK
- [ ] No `ERROR` log lines in the last 30 minutes
- [ ] `pnpm tsx scripts/audit-verify-chain.ts --api-base "$CERNIQ_API_BASE" --api-key "$CERNIQ_PROD_API_KEY" --limit 10` reports chain intact
