# infra/ — CERNIQ infrastructure

Deploy descriptors, container builds, datastore tuning, and observability
config. Application code lives in `apps/`; this directory is the
production wrapper around it.

## Layout

| Directory        | Purpose                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker/`        | Production Dockerfiles (`Dockerfile.api`, `Dockerfile.worker`), `.dockerignore`, container healthcheck. The legacy `postgres-init.sql` for local-only docker-compose also lives here.  |
| `railway/`       | Per-service Railway descriptors: `api.service.json`, `worker.service.json`, `postgres.service.json`, `redis.service.json`. README has the deploy runbook + verify-deployment commands. |
| `cloudflare/`    | Phase-3-only edge wrangler template and runbook. NO code (peer owns `workers/cf-verify`).                                                                                              |
| `postgres/`      | Production-only init.sql (extensions + roles) and postgresql.conf tuning notes.                                                                                                        |
| `redis/`         | Hardened production redis.conf. CONFIG-via-network disabled, requirepass placeholder.                                                                                                  |
| `observability/` | OpenTelemetry collector pipeline + Grafana dashboard skeletons (real PromQL, datasource bound at provisioning).                                                                        |

## Phase 1 deploy topology (current)

```
                 Cloudflare (DNS only — Phase 1)
                            │
                            ▼
                Railway "cerniq-api"          (NestJS, public ingress)
                            │
                            ├── Railway/Neon Postgres   (DATABASE_URL)
                            └── Railway/Upstash Redis   (REDIS_URL, BullMQ)
                                          ▲
                                          │
                Railway "cerniq-worker"      (BATE, webhooks, audit DLQ)
```

Both services use the same Postgres + Redis. Splitting them onto separate
Railway services lets us scale the worker independently of the API and
makes per-deploy rollback granular.

## Phase 3 target (post $5K MRR)

```
        Cloudflare Workers — cerniq-verify-edge   (verify hot path < 80ms p99)
              │
              ├── Workers KV: TRUST_SCORE_CACHE, POLICY_CACHE
              └── Durable Objects: SPEND_COUNTER (per-API-key)
                                   │
                                   └─ origin Railway cerniq-api (management surface)
```

Phase 3 is gated on the entry checklist in `cloudflare/README.md`.

## Bootstrap

### Local (docker-compose)

```sh
docker compose up -d         # postgres + redis from the repo root file
pnpm install
pnpm --filter @cerniq/api prisma:migrate
pnpm tsx scripts/generate-cerniq-keys.ts --env > .env.keys
cat .env.keys >> .env
shred -u .env.keys 2>/dev/null || rm -P .env.keys 2>/dev/null || rm .env.keys
pnpm dev
```

### Production (Railway)

Follow the runbook in `railway/README.md`. Short version:

```sh
railway login
railway link                     # pick the CERNIQ project
# Provision Postgres + Redis plugins from the dashboard.
# Wire env vars per the matrix in api.service.json + worker.service.json.
railway up --service cerniq-api
railway up --service cerniq-worker
```

### Phase 3 edge (Cloudflare)

Follow `cloudflare/README.md`. Do NOT start before the gate criteria are
green.

## What does NOT live here

- Application code → `apps/`
- Build artifacts → each app's `dist/`
- Secrets → Railway dashboard, Cloudflare Workers secrets, KMS. **Never
  commit secrets to this directory.**
- Schema migrations → `apps/api/prisma/migrations/`
- Worker source code → `workers/cf-verify/` (peer scope)

## Verify deployment

The fastest "is anything broken" pass after a deploy:

```sh
API="https://api.cerniq.<your-domain>"
EDGE="https://cerniq.<your-domain>"   # Phase 3 only

curl -fsS -o /dev/null -w "live=%{http_code} t=%{time_total}s\n"  "$API/v1/health/live"
curl -fsS -o /dev/null -w "ready=%{http_code} t=%{time_total}s\n" "$API/v1/health/ready"
curl -fsS "$API/.well-known/jwks.json"            | jq '.keys | length'
curl -fsS "$API/.well-known/audit-signing-key"    | jq '.kty'

# Swagger MUST be 404 in prod:
curl -fsS -o /dev/null -w "%{http_code}\n" "$API/docs"
```

If any of those returns the wrong code, jump to the failure-mode notes
in the relevant service's README (`railway/README.md` § 5,
`cloudflare/README.md` § Verify deployment).
