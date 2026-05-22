# Runbook — BATE recompute lag / anomaly signal spike

## Alert

- **Names**: `BateRecomputeLag` (warning, **disabled** pending
  metric), `BateAnomalySignalSpike` (warning, **disabled** pending
  metric)
- **Group**: `okoro.bate`
- **File**: `infra/observability/alerts/okoro.rules.yml`

> **Status**: both alerts ship as `expr: vector(0) > 1` — they cannot
> fire today. The runbook is correct as written; only the trigger is
> stubbed. Tracked: M-007 follow-up.
>
> Required emitters (when M-007 follow-up lands):
> - `okoro_bate_queue_oldest_job_age_seconds` — gauge from
>   `apps/api/src/modules/bate/bate.worker.ts` exposing the BullMQ
>   `bate-signals` queue's oldest waiting job age.
> - `okoro_bate_signals_total{severity, signal_type}` — counter from
>   `BateService.ingestSignal`. Severity is `info|warning|critical`
>   per `docs/BATE_ALGORITHM.md` § anomaly rules R-1..R-5.

## Symptom

- `BateRecomputeLag` — the BATE BullMQ queue has a job older than 60 s
  waiting to process. New trust signals are landing but the score
  isn't being updated.
- `BateAnomalySignalSpike` — critical-severity BATE signals (fraud,
  velocity anomaly, spend-pattern anomaly) are arriving > 1/s for
  some `signal_type`. Could be a real attack or a misconfigured
  relying party reporting too aggressively.

## Impact

- **Trust accuracy**: an agent's score is stale → relying parties may
  approve actions for an agent that should already be in a lower band,
  or deny for one that's recovered. Stale scores undermine the BATE
  contract (`docs/BATE_ALGORITHM.md` § Trust bands).
- **Webhook delivery**: `okoro.agent.trust_score_changed` fires on
  band crossings (round-2 handoff). Lag means delayed webhooks →
  delayed customer-side response to a high-risk agent.
- **SLO**: BATE recompute lag SLO is < 60 s at p99
  (`docs/SLO.md` § 1).

## Diagnose

1. **Confirm the queue depth and oldest-job age** (once the metric
   ships):

   ```promql
   okoro_bate_queue_oldest_job_age_seconds
   ```

   Until then, query BullMQ directly via Redis:

   ```bash
   railway run -s okoro-redis -- redis-cli LLEN bull:bate-signals:wait
   railway run -s okoro-redis -- redis-cli ZRANGE bull:bate-signals:delayed 0 5 WITHSCORES
   railway run -s okoro-redis -- redis-cli LLEN bull:bate-signals:active
   ```

   `wait` length > 100 sustained = the worker is not keeping up.
   `active` count near zero with non-zero `wait` = the worker is
   paused or crashed.

2. **Check worker health.**

   ```bash
   railway logs -s okoro-worker | rg -F 'bate.worker' | tail -30
   railway logs -s okoro-worker | rg -iF 'redis connection|bullmq.*error|prisma' | tail -20
   ```

   Common failure modes:
   - Worker process crashed / OOM (look for SIGKILL / restart).
   - Postgres lock contention: BATE recompute writes to
     `TrustScoreHistory` and reads `BateSignal`; long-running migrations
     can stall.
   - Redis connection drop: BullMQ surfaces as
     `MaxRetriesPerRequestError`.

3. **Per-signal-type breakdown** (anomaly spike):

   Once `okoro_bate_signals_total` ships:
   ```promql
   sum by (signal_type) (rate(okoro_bate_signals_total{severity="critical"}[5m]))
   ```

   Until then, query Postgres:

   ```sql
   SELECT "signalType", COUNT(*), MAX("occurredAt") FROM "BateSignal"
   WHERE "occurredAt" > NOW() - INTERVAL '15 minutes'
     AND severity = 'critical'
   GROUP BY 1 ORDER BY 2 DESC;
   ```

4. **Per-relying-party check** — is one customer flooding signals?

   ```sql
   SELECT "relyingPartyId", COUNT(*) FROM "BateSignal"
   WHERE "occurredAt" > NOW() - INTERVAL '15 minutes'
   GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
   ```

   A single relying party dominating ≥ 80% of signals = either an
   incident on their side (fraud event we're correctly observing) or
   a SDK bug spamming reports.

5. **Postgres lock check** for `TrustScoreHistory`:

   ```bash
   railway run -s okoro-postgres -- psql -c "SELECT pid, locktype, mode, relation::regclass, granted FROM pg_locks WHERE relation = 'TrustScoreHistory'::regclass;"
   ```

## Mitigate

- **Worker crashed**: `railway service restart -s okoro-worker`.
  Confirm `wait` queue drains within 5 min.
- **Worker keeping up but lag growing**: scale horizontally —
  `railway service scale okoro-worker --replicas <n+1>`. The 1 s
  per-agent debounce (`jobId = bate:recompute:<agentId>`) means
  multiple workers are safe; they coalesce on the same job id.
- **Single relying party flooding signals**: reach the customer
  immediately. Do NOT throttle their signals on our side without
  their awareness — silently dropping signals breaks the BATE
  contract. If unreachable and the load is destabilising the worker,
  put their `relyingPartyId` on a temporary `IGNORE_RP_IDS` env-var
  allowlist (worker reads at startup), restart the worker, and notify
  the customer in writing.
- **Postgres lock**: identify the blocker via step 5;
  `pg_terminate_backend(<pid>)` if it's safe to kill (a stuck
  migration or runaway query).
- **Critical-severity spike, real attack pattern**: this is the
  product working. Don't mitigate the alert — communicate to the
  affected principals via the security mailing list and let BATE do
  its job.

## Eradicate

- For worker scaling needs that recur: bump the default replica
  count in `infra/railway/okoro-worker.json`.
- For single-RP flooding: file an issue under the customer's
  account; their integration may need rate limiting on their side.
  Document in their runbook.
- For Postgres lock contention from `TrustScoreHistory`: if it's
  recurring, add a partitioning strategy (by `agentId` hash) in a
  Prisma migration. Update `docs/ARCHITECTURE.md` data-model section.

## Verify recovery

Once the metric ships:

```promql
okoro_bate_queue_oldest_job_age_seconds < 30
```

Until then (manual):

```bash
railway run -s okoro-redis -- redis-cli LLEN bull:bate-signals:wait
# must be < 50 sustained over 10 min
```

And:

```sql
-- Recompute throughput in the last 5 min
SELECT COUNT(*) FROM "TrustScoreHistory" WHERE "createdAt" > NOW() - INTERVAL '5 minutes';
-- Compare to BateSignal arrival rate over the same window
SELECT COUNT(*) FROM "BateSignal" WHERE "occurredAt" > NOW() - INTERVAL '5 minutes';
```

The two counts should be within 10% of each other (signals coalesce
1:N into recomputes via the per-agent debounce, so recompute count is
usually lower).

## Escalate

- **Not resolved in 30 min** → notify `#okoro-oncall` lead.
- **Not resolved in 1 h** → page `${ESCALATION_CONTACT}` (OD-007 pending).
- **Real-attack signal pattern** detected (step 3/4 shows a
  coordinated burst across many agents) → page security on-call
  alongside engineering on-call; do not wait.

## Postmortem trigger

**Yes** if recompute lag exceeded the 60 s SLO for > 30 min, or if
the trigger was an upstream worker crash that lost in-flight jobs.
**No** for self-resolving anomaly-signal spikes that turned out to be
correct fraud detection — log in `#okoro-ops` instead.
