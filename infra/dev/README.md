# AEGIS — dev stack

> One-command local environment: Postgres + Redis + API + worker + Prometheus + Grafana + OTel collector.
> Pinned Docker images, healthchecks on every service, no `latest` tags.

## Quick start

```sh
# from repo root
cp infra/dev/.env.example infra/dev/.env
# (optional) generate the AEGIS audit-signing keypair and wire its public half
pnpm --filter @aegis/scripts run keys
# then copy the AEGIS_SIGNING_PUBLIC_KEY value into infra/dev/.env

docker compose -f infra/dev/docker-compose.dev.yml --env-file infra/dev/.env up -d --build
```

Recommended (operator's call) — add a root convenience script:

```jsonc
// package.json (root)
"scripts": {
  "dev:up":   "docker compose -f infra/dev/docker-compose.dev.yml --env-file infra/dev/.env up -d --build",
  "dev:down": "docker compose -f infra/dev/docker-compose.dev.yml down"
}
```

## After up — smoke test in 30 seconds

```sh
# 1. API alive?
curl -s http://localhost:4000/v1/health/ready
# expect {"status":"ok",...}

# 2. Metrics flowing?
curl -s http://localhost:4000/metrics | grep ^aegis_

# 3. Prometheus targets healthy?
open http://localhost:9090/targets
# every row should be UP

# 4. Grafana
open http://localhost:3000
# login: admin / admin (or whatever you set GF_SECURITY_ADMIN_PASSWORD to)
# AEGIS folder → "Verify path" dashboard provisioned
```

The full 12-step golden path lives in `docs/SMOKE_TEST.md`.

## Ports

| Service       | Host port | Purpose                          |
| ------------- | --------- | -------------------------------- |
| API           | 4000      | NestJS (`/v1/...`, `/metrics`)   |
| Worker        | 4001      | BullMQ workers + `/metrics`      |
| Postgres      | 5432      | Primary database                 |
| Redis         | 6379      | Cache + queue + replay store     |
| Prometheus    | 9090      | Metrics + recording + alerts     |
| Grafana       | 3000      | Provisioned datasource + dashboard |
| OTel collector | 4317/4318 | OTLP gRPC + HTTP receivers       |

## Image versions (pinned)

| Image                                              | Version   |
| -------------------------------------------------- | --------- |
| `postgres`                                         | `16.4-alpine` |
| `redis`                                            | `7.4-alpine`  |
| `prom/prometheus`                                  | `v2.55.1` |
| `grafana/grafana`                                  | `11.3.1`  |
| `otel/opentelemetry-collector-contrib`             | `0.110.0` |

The `api` and `worker` services build from `infra/docker/Dockerfile.api` and
`Dockerfile.worker` — the same images Railway runs in production. Dev catches
build issues before they hit a deploy.

## Dashboard drift caveat (read this)

The Grafana dashboard mounted at `infra/dev/grafana/dashboards/aegis-verify.json`
is a copy of the production dashboard `infra/observability/grafana-dashboards/aegis-verify-latency.json`.
Per `docs/SESSION_HANDOFF.md` (entry 2026-05-02), **5 panels reference metric
names that are not currently emitted by `apps/api/src/common/observability/metrics.service.ts`**:

- `aegis_verify_denials_total`
- `aegis_bate_recompute_lag_seconds_bucket`
- `aegis_bullmq_waiting_jobs`
- `aegis_cache_hits_total`
- `aegis_cache_misses_total`

Until that drift is resolved (rewrite the panels OR extend `metrics.service.ts`),
expect those panels in dev Grafana to render "No data". The other panels —
`aegis_verify_total{decision,denial_reason}`, `aegis_bate_score_delta`,
`aegis_audit_append_total`, `aegis_webhook_delivery_total`,
`aegis_http_requests_total`, default Node metrics — render correctly.

This is the same drift production has. Documented here so dev users don't
chase a phantom configuration bug.

## Failure modes

| Symptom                                          | Likely cause                                      | Mitigation                                                                 |
| ------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `api` container crash-loops with Prisma errors  | Migrations not applied                            | `pnpm --filter @aegis/api exec prisma migrate deploy` against this DB.     |
| `api` boot fails on `AEGIS_SIGNING_PUBLIC_KEY`   | Public key env var unset                          | `pnpm --filter @aegis/scripts run keys`, copy `AEGIS_SIGNING_PUBLIC_KEY` into `infra/dev/.env`, restart. |
| Prometheus targets all DOWN                      | API/worker not exposing `/metrics` on the network | Confirm `api`, `worker` are healthy: `docker compose ps`. Check inside the container with `wget -qO- http://api:4000/metrics`. |
| Grafana shows "No data" on every panel           | Dashboard drift (see above) OR Prometheus down    | Check `http://localhost:9090/targets`. If targets are UP, drift is the cause. |

## What's intentionally missing

- **Alertmanager.** The `aegis.rules.yml` rules file is mounted into Prometheus
  and parsed; alerts will fire and be visible at `http://localhost:9090/alerts`,
  but they have nowhere to go. Production Alertmanager lives in a separate
  stack. We don't pretend to test paging in dev.
- **TLS.** Everything is plain HTTP. Internal networks only.
- **Real KMS.** `AEGIS_SIGNING_PUBLIC_KEY` is read from the `.env` file in dev.
  Production injects it from KMS at deploy time per
  `infra/kms/rotation-runbook.md`.

## Teardown

```sh
docker compose -f infra/dev/docker-compose.dev.yml down -v
```

`-v` wipes the four named volumes (`pgdata`, `redisdata`, `prometheusdata`,
`grafanadata`). Drop the flag to retain Postgres and Redis state across restarts.

## Don't run this and the root compose at the same time

The root `docker-compose.yml` runs Postgres on `5432` and Redis on `6379` for
purely-app development. This stack also binds those ports. Pick one:

- App-only dev: `docker compose -f docker-compose.yml up -d` then `pnpm dev`.
- Full stack with metrics: this file, as documented above.
