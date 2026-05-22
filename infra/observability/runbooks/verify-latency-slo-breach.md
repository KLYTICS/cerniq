# Runbook — Verify latency SLO breach

## Alert

- **Names**: `VerifyLatencyP99SLOBreach` (critical),
  `VerifyLatencyP99SLOWarning` (warning), `EventLoopLagHigh` (warning,
  same root-cause tree)
- **Group**: `okoro.verify.slo` (latency alerts), `okoro.platform`
  (event-loop alert)
- **File**: `infra/observability/alerts/okoro.rules.yml`

## Symptom

Customer-facing `POST /v1/verify` p99 is over the 200 ms origin SLO
(or over the 150 ms warning threshold for 10 min). Relying-party agents
are seeing slow responses; some are timing out and retrying, which
amplifies the load.

## Impact

- **SLO**: every minute over 200 ms p99 burns the 30-day error budget.
  43 min/30d at 99.9% means ~1.4 min/day allowance. Sustained breach
  forces a release freeze (`docs/SLO.md` § 3).
- **Revenue**: enterprise contracts include verify p99 SLAs with
  service credits. Sustained breach = bill credits at the next cycle.
- **Cascading**: if relying parties retry, our load doubles, latency
  worsens, more retries — classic congestion collapse. Mitigate fast.

## Diagnose

Run these in order — each one rules out a category of causes.

1. **Confirm the breach is real and current** (Prometheus expression
   browser or `curl -s`):

   ```promql
   histogram_quantile(0.99, sum by (le) (rate(okoro_verify_latency_seconds_bucket[5m])))
   ```

   If this is < 0.2, the alert has cleared and you can downgrade.

2. **Decide: is this global, per-decision, or per-route?**

   ```promql
   # By decision label (approved vs denied — denials should be faster)
   histogram_quantile(0.99, sum by (le, decision) (rate(okoro_verify_latency_seconds_bucket[5m])))

   # By route (drift to non-verify routes implies platform-level issue)
   histogram_quantile(0.99, sum by (le, route) (rate(okoro_http_requests_total[5m])))
   ```

3. **Open the verify SLO Grafana dashboard.**
   `https://grafana.internal/d/okoro-verify-slo` — panel 1 (latency)
   and panel 3 (BATE recompute lag). If BATE lag is also climbing,
   skip to step 6.

4. **Event loop lag — the leading indicator.**

   ```promql
   okoro_nodejs_eventloop_lag_seconds
   ```

   If `quantile="0.99"` is over 100 ms, sync work (crypto, JSON parse
   on giant payloads, GC pauses) is starving the loop. This always
   manifests as latency before it manifests as 5xx.

5. **Postgres + Redis health.**

   ```bash
   # Postgres connection pool saturation
   railway logs -s okoro-api | rg "PrismaClientKnownRequestError|Pool" | tail -20

   # Postgres slow queries (init.sql sets log_min_duration_statement=500ms)
   railway run -s okoro-postgres -- psql -c "SELECT pid, now()-query_start AS dur, state, substring(query, 1, 80) FROM pg_stat_activity WHERE state='active' AND now()-query_start > interval '500ms' ORDER BY dur DESC LIMIT 10;"

   # Redis latency (verify path reads agent: / policy: / trust: keys)
   railway run -s okoro-redis -- redis-cli --latency-history -i 1
   ```

6. **Recent deploys.**

   ```bash
   railway deployments -s okoro-api --json | jq '.[0:3] | .[] | {createdAt, status, meta}'
   ```

   If a deploy landed within the breach window, suspect it first.

7. **OTel traces.** In your trace backend (Tempo/Jaeger), filter:
   `service.name="okoro-api" span.name="POST /v1/verify" duration > 200ms`
   Look at the longest span — usually one of: `prisma.query`,
   `noble-ed25519.verify`, `redis.get`, or `bate.evaluate`.

## Mitigate

Pick the path matching what you found in Diagnose:

- **Recent deploy regression** → `railway rollback -s okoro-api <prev-deploy-id>`.
  Confirm latency drops within 2 min.
- **Postgres slow query** (one repeat offender in step 5):
  `railway run -s okoro-postgres -- psql -c "SELECT pg_terminate_backend(<pid>);"`
  for the offender; queue an index in `apps/api/prisma/schema.prisma`
  if it's structural.
- **Redis latency spike** (>5 ms p99 sustained in step 5): scale Redis
  vertically — `railway service scale okoro-redis --memory 2GB` — and
  watch latency drop. If it doesn't, the issue is network/AZ; failover
  via Railway dashboard.
- **Pool exhaustion**: scale the API horizontally —
  `railway service scale okoro-api --replicas <n+1>`. Each replica
  carries its own Prisma pool (default 10 connections); confirm
  `DATABASE_CONNECTION_LIMIT` isn't capped low.
- **Event loop lag from sync work**: take a heap snapshot and a
  CPU profile via `railway run -s okoro-api -- node --prof` on a
  sacrificial replica; ship the result to the on-call channel.
- **Cascading retries**: temporarily raise the rate limit's penalty
  TTL via `THROTTLE_TTL=30` env var; this slows retry storms enough
  to stabilise.

## Eradicate

- File a follow-up ticket in the issue tracker (project: OKORO, label:
  `incident:postmortem`) within 24 h. Use `docs/templates/postmortem.md`
  if/when it lands; until then, the SLO doc § 7 has the change-control
  template.
- If the cause was a regression, add a verify-path benchmark to
  `apps/api/test/load/verify.load.test.ts` that would have caught it.
  The load gate (`pnpm --filter @okoro/api test:load`) runs before
  each release.
- If the cause was Postgres, confirm the new index lands in the next
  Prisma migration and update the verify-path query plan annotation
  in `docs/ARCHITECTURE.md`.

## Verify recovery

```promql
histogram_quantile(0.99, sum by (le) (rate(okoro_verify_latency_seconds_bucket[5m])))
```

Must return < 0.15 sustained over 10 min before declaring recovery —
< 0.2 only clears the alert; we want margin before we say it's safe.

Also confirm:

```promql
okoro_nodejs_eventloop_lag_seconds{quantile="0.99"} < 0.05
```

## Escalate

- **Not resolved in 15 min** → page the second-on-call via PagerDuty.
- **Not resolved in 30 min** → page `${ESCALATION_CONTACT}`
  (TBD — operator decision OD-007).
- **Customer reports impact** → page status-page owner; post
  acknowledgment at https://status.okorolabs.io within 5 min of report.

## Postmortem trigger

**Yes** if the breach lasted > 30 min, was customer-reported, or
caused a release freeze. **No** for warning-threshold-only events
that resolved themselves in < 30 min, but file a brown-bag note in
`#okoro-ops` so the pattern is visible.
