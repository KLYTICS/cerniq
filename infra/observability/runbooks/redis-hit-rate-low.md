# Runbook — Redis cache hit rate low

## Alert

- **Name**: `RedisHitRateLow` (info, **disabled** pending exporter)
- **Group**: `aegis.cache`
- **File**: `infra/observability/alerts/aegis.rules.yml`

> **Status**: ships as `expr: vector(0) > 1` — disabled until the
> `redis_exporter` sidecar (oliver006/redis_exporter) is deployed.
> Tracked: M-019.
>
> Drift note: the Grafana dashboard panel 4 references
> `aegis_cache_hits_total` / `aegis_cache_misses_total`, which the
> API does **not** emit either. Both the dashboard panel and this
> alert depend on the same M-019 fix.

## Symptom

Verify-path Redis cache hit rate is below 85% sustained for 15 min.
Either the cache is undersized, the TTL is too short, or invalidation
is over-aggressive.

## Impact

- **Latency**: every cache miss on the verify path is a Postgres
  round-trip — typically 5–15 ms vs Redis's < 1 ms. A hit rate below
  85% sustained will eventually surface as a `VerifyLatencyP99SLOWarning`.
- **Cost**: Postgres read load scales linearly with the miss rate.
  At AEGIS's traffic shape, a sustained drop from 95% → 70% hit
  rate roughly 6x's Postgres read RPS.
- **Not customer-facing in itself** — this is an info-severity alert,
  designed to catch the issue before it becomes a latency SLO breach.

## Diagnose

1. **Confirm the hit rate** (when exporter ships):

   ```promql
   sum(rate(redis_keyspace_hits_total[5m]))
   /
   clamp_min(sum(rate(redis_keyspace_hits_total[5m]) + rate(redis_keyspace_misses_total[5m])), 0.001)
   ```

   Until then, query Redis directly:

   ```bash
   railway run -s aegis-redis -- redis-cli INFO stats | rg -F 'keyspace_hits|keyspace_misses'
   railway run -s aegis-redis -- redis-cli INFO memory | rg -F 'used_memory_human|maxmemory_human|evicted_keys'
   ```

2. **Check the per-key-prefix hit rate.**
   The verify path uses three prefixes (`agent:`, `policy:`, `trust:`)
   per `apps/api/src/common/cache/cache.service.ts`. If one prefix
   dominates the misses, that's the broken cohort.

   ```bash
   railway run -s aegis-redis -- redis-cli --scan --pattern 'agent:*' | wc -l
   railway run -s aegis-redis -- redis-cli --scan --pattern 'policy:*' | wc -l
   railway run -s aegis-redis -- redis-cli --scan --pattern 'trust:*' | wc -l
   ```

3. **Eviction check.** If `evicted_keys` is increasing, the cache is
   memory-bound and evicting under pressure → undersized.

   ```bash
   railway run -s aegis-redis -- redis-cli CONFIG GET maxmemory
   railway run -s aegis-redis -- redis-cli CONFIG GET maxmemory-policy
   ```

   Expected: `allkeys-lru` policy (per `infra/redis/redis.conf`),
   non-zero `maxmemory` (Railway sets via memory limit).

4. **Recent invalidation churn.** A deploy that introduced over-eager
   invalidation will manifest as a sudden hit-rate drop right after
   the deploy.

   ```bash
   railway deployments -s aegis-api --json | jq '.[0:3] | .[] | {createdAt, status}'
   railway logs -s aegis-api | rg -F 'cache.invalidate' | tail -50
   ```

5. **TTL inspection** for a sample key:

   ```bash
   railway run -s aegis-redis -- redis-cli RANDOMKEY
   # take the returned key, then:
   railway run -s aegis-redis -- redis-cli TTL '<key>'
   ```

   Compare to the expected TTL for that prefix from
   `apps/api/src/common/cache/cache.service.ts`.

## Mitigate

- **Memory-bound (eviction-driven)**: scale Redis vertically —
  `railway service scale aegis-redis --memory 2GB` (or appropriate
  tier). LRU eviction means warming back to a healthy hit rate
  takes ~minutes.
- **Over-eager invalidation from a recent deploy**: rollback the
  API: `railway rollback -s aegis-api <prev-deploy-id>`. The cache
  itself is fine; the writes are too aggressive.
- **TTL too short**: increase `CACHE_*_TTL_SECONDS` env vars
  (defaults in `apps/api/src/config/`). Bounce the API service to
  pick up. Document the new TTL in `docs/ARCHITECTURE.md` § caching.
- **Single principal hot key**: if one principal is causing thrashing
  on `agent:<theirAgentId>`, that's a normal hot-spot — Redis handles
  it. If many keys for one principal are missing constantly, suspect
  a logic bug (e.g. caching with the wrong key shape).

## Eradicate

- For memory-bound scaling: update the default Railway memory setting
  in `infra/railway/aegis-redis.json` and document in
  `docs/ARCHITECTURE.md`.
- For invalidation bugs: add a unit test in
  `cache.service.spec.ts` covering the case the deploy broke.
- For TTL changes: capture the rationale in `docs/ARCHITECTURE.md`
  § "caching strategy with TTLs". TTLs are a contract — bumping
  them changes consistency guarantees relying parties may depend on.

## Verify recovery

```bash
# Manually until exporter ships
railway run -s aegis-redis -- redis-cli INFO stats | rg -F 'keyspace_hits|keyspace_misses'
# Compute hits / (hits + misses); must be > 0.90 sustained over 15 min
```

When the exporter ships:

```promql
sum(rate(redis_keyspace_hits_total[15m]))
/
clamp_min(sum(rate(redis_keyspace_hits_total[15m]) + rate(redis_keyspace_misses_total[15m])), 0.001)
> 0.90
```

Also verify no rising eviction count over 15 min:

```bash
railway run -s aegis-redis -- redis-cli INFO stats | rg -F 'evicted_keys'
# Run twice 15 min apart; values should match.
```

## Escalate

- **Not resolved by next business day** → notify `#aegis-oncall`
  lead. This is info-severity; no out-of-hours page.
- **If it escalates to a latency warning** → switch to the
  `verify-latency-slo-breach.md` runbook.
- **Suspected cache poisoning / unexpected key shape** → page
  `${ESCALATION_CONTACT}` (OD-007 pending) treating as security incident.

## Postmortem trigger

**No** for resolved info-severity events under 30 min — log in
`#aegis-ops`. **Yes** if the cache health degradation cascaded into a
latency SLO breach (then the postmortem is for the latency event, with
this as the root cause).
