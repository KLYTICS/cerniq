---
title: AEGIS — Capacity plan
status: draft
last-reviewed: 2026-05-02
owner: operator (Erwin) — sid open
audience: SRE / platform engineering / SOC 2 Type II auditor / partner-integration capacity reviewer
companion-to: docs/ARCHITECTURE.md §11 (summary), docs/SLO.md (targets), docs/FAILURE_MODES.md (degradation), docs/RETENTION_POLICY.md (storage growth driver)
---

# AEGIS — Capacity plan

> **Purpose.** Quantitative model for sizing every load-bearing
> component of AEGIS so the SLOs in `docs/SLO.md` are demonstrably
> achievable from first principles. ARCHITECTURE.md §11 is the
> three-paragraph summary; this document is the canon a partner
> capacity reviewer or SRE-on-call references when a number needs
> defending.
>
> Closes audit finding **A-004** at depth (the §11 rollup closed it
> at the architectural level).

---

## 1. How to use this document

- **Read §2 first** to understand which workload class your concern
  falls into (verify hot path / management / async).
- **Per-component sections (§5–§11)** are independently consultable;
  each opens with a one-line summary of "what determines capacity for
  this component."
- **Numbers are budgets, not commitments.** A budget that breaks must
  produce either a config change (raise the budget with operator
  approval) or a load reduction. Never silently exceed.
- Every numeric target carries a **derivation source**: either an
  empirical measurement, a vendor-published limit, or a Little's-Law
  computation from the workload model in §2.

When in doubt about a number, the precedence is:
**measured > vendor doc > derived > assumed**, and "assumed" must be
flagged with `<!-- assumption: ... -->` so it is replaced by
measurement before Phase 1 GA.

---

## 2. Workload model

AEGIS has three workload classes with fundamentally different cost
shapes. Conflating them produces the wrong sizing call.

### 2.1 Workload classes

| Class           | Defining surface         | p99 latency budget | Read/Write mix | Peak shape           | Cache amenable? |
|-----------------|--------------------------|--------------------|----------------|----------------------|-----------------|
| **Verify hot** | `POST /v1/verify`        | 200 ms (P1) / 80 ms (P3 edge) | 95% R / 5% W (audit append) | Spiky around RP traffic peaks | Yes — `agent`, `policy`, `verify` keys |
| **Management**  | Identity / Policy / Audit / Webhook CRUD | 500 ms | 70% R / 30% W | Smooth (developer + dashboard) | Mixed |
| **Async**       | BullMQ workers (BATE, webhook deliver, audit DLQ, policy expiry) | n/a (eventual) | Write-dominant | Trails verify with 30 s–5 min lag | No |

The verify hot path is the **only** class where Phase 3 lifts the
ceiling by an order of magnitude (CF Workers); management stays
single-region by design.

### 2.2 Per-surface workload assumptions

These are the **Phase 1 GA targets**. Phase 3 numbers are the
multipliers we plan for, not what we will hit at GA.

| Surface            | Phase 1 sustained | Phase 1 burst (5 min) | Phase 3 per-region | Phase 3 global aggregate |
|--------------------|-------------------|-----------------------|--------------------|--------------------------|
| `POST /v1/verify`  | 1 000 rps          | 2 500 rps              | 10 000 rps          | 50 000 rps (5 regions)    |
| `GET /v1/agents/:id/status` | 200 rps  | 500 rps                | 2 000 rps           | 10 000 rps                |
| `POST /v1/agents/:id/report` | 50 rps  | 150 rps                | 500 rps             | 2 500 rps                 |
| Identity / Policy CRUD       | 50 rps  | 200 rps                | 50 rps              | 50 rps (single region)    |
| `GET /v1/audit/*`            | 30 rps  | 100 rps                | 30 rps              | 30 rps                    |
| `/.well-known/jwks.json`     | 5 rps   | 50 rps                 | (CDN-cached)        | (CDN-cached)              |
| Webhook outbound delivery    | 50 rps  | 200 rps                | 200 rps             | 200 rps (workers stay regional) |
| BATE signal ingestion (`/v1/agents/:id/report`) → score recompute | 50 rps in / 50 rps queued | 150 rps in | 500 rps in | 2 500 rps in |

**Burst definition:** 5-minute sustained at the burst rate before
autoscaler completes scale-out (CFO target 90 s; budget 5 min for
worst-case provider provisioning lag).

**Headroom rule:** every component is sized for **3 × peak burst**.
The factor decomposes as 1.5 × (forecast error) × 2 × (failure-domain
co-resident) — explained in §3.2.

### 2.3 Growth assumptions (12 months from Phase 1 GA)

| Metric                          | GA       | +3 months | +6 months | +12 months |
|---------------------------------|----------|-----------|-----------|------------|
| Active principals (paying)      | 5        | 25        | 100       | 400        |
| Active principals (free tier)   | 50       | 250       | 1 000     | 4 000      |
| Registered agents (P-weighted)  | 5 000    | 50 000    | 250 000   | 1 000 000  |
| Active policies                 | 1 000    | 10 000    | 50 000    | 250 000    |
| Verify rps (sustained avg)      | 50       | 200       | 500       | 1 500      |
| Verify rps (peak)               | 250      | 800       | 2 000     | 6 000      |
| Audit events appended / day     | 4 M      | 17 M      | 43 M      | 130 M      |
| Audit events appended / year    | 1.5 B    | 6 B       | 16 B      | 47 B       |

The Phase 1 sustained budget (1 000 rps) covers the **+12-month peak**
with 6× headroom, which is intentional — Phase 3 lift to CF Workers
is meant to land **before** the 6× headroom erodes (i.e. when
sustained crosses ~150 rps in production).

### 2.4 Per-RP workload mix (per `AEGIS_AS_BACKBONE.md`)

| RP                       | Verify rps GA | Verify rps +12mo | Audit/day GA | Notes                                         |
|--------------------------|---------------|-------------------|--------------|-----------------------------------------------|
| FORGE                    | 10            | 200               | 800 K         | 6 RBAC-v11 transition gates per shift × 100 ops |
| CerniQ                   | 5             | 80                | 400 K         | Agent-layer ingress + close cockpit actions    |
| Apex                     | 2             | 50                | 150 K         | Reconcile-workflow gates only at GA            |
| Bimba                    | 0 (post-stab) | 30                | 100 K         | Mission analyst agents post Phase-1 baseline   |
| External pilot customers | 33            | 1 140             | 2.55 M        | Aggregate of remaining capacity                |
| **Total**                | **50**        | **1 500**         | **~4 M GA, 130 M +12mo** |                                          |

Per-RP `principalId` filter on every query (CLAUDE.md invariant 5)
makes the per-RP partition the **dominant capacity unit** for
Postgres index scan cost — see §6.2.

---

## 3. Sizing methodology

### 3.1 Little's Law as the core

For every queue (HTTP request queue, BullMQ queue, DB connection
pool):

```
L = λ × W
```

where `L` is in-flight items, `λ` is arrival rate (rps), `W` is mean
time-in-system (latency including queue wait).

We size each pool at `L_max = λ_burst × W_target × headroom_factor`,
then **verify with k6 / autocannon** in `test/load/`.

Worked example for the verify hot path Phase 1:

```
λ_burst = 2 500 rps
W_target = 0.150 s (p99 budget 0.200 s, target 0.150 s mean)
headroom_factor = 3
L_max = 2 500 × 0.150 × 3 = 1 125 in-flight requests across all pods

Per-pod concurrency = 25 (fastify event-loop sweet spot)
Pods needed = ceil(1 125 / 25) = 45

But Phase 1 single-region Railway: cap pods at autoscale max = 12.
Therefore Phase 1 burst is artificially capped at:
λ_burst_actual = (12 × 25) / (0.150 × 3) = 666 rps

This is below the 2 500 burst target → Phase 1 burst will degrade.
Mitigation: 429 RATE_LIMITED on overage (per OD-006), no fail-open.
Phase 3 (CF Workers) lifts the ceiling.
```

This is **the** worked example developers should consult to understand
why a number is what it is.

### 3.2 Headroom factor decomposition

`headroom_factor = forecast_error × failure_domain_factor`

- `forecast_error = 1.5` — empirical: workload forecasts in early SaaS
  are off by ~50% in either direction. Reset on quarterly capacity
  review with measured error.
- `failure_domain_factor = 2.0` — survive the loss of 50% of
  fail-over-eligible capacity (one of two AZs, half the pod fleet
  during a deploy roll, one of two BullMQ workers) without breaching
  budget.

Multiplied: `1.5 × 2.0 = 3.0`. Same factor used across all
components for consistency. **A component requesting a different
factor must justify it in this document with a `<!-- headroom: ... -->`
comment.**

### 3.3 Latency budget decomposition (verify hot path)

Phase 1 200 ms p99 budget, decomposed:

| Hop                                         | Budget | Cumulative |
|---------------------------------------------|--------|------------|
| Network (RP → Railway TLS handshake reuse)  | 20 ms  | 20 ms      |
| API request parse + validate (Zod)          | 5 ms   | 25 ms      |
| Auth (verify-key lookup, cached)            | 2 ms   | 27 ms      |
| Cache lookup (`agent`, `policy`, `verify`)   | 5 ms   | 32 ms      |
| Postgres on cache miss (worst case)         | 30 ms  | 62 ms      |
| Crypto verify (Ed25519, in-process)         | 1 ms   | 63 ms      |
| Spend counter INCRBY + check                | 5 ms   | 68 ms      |
| Audit append to outbox (async write-behind) | 5 ms   | 73 ms      |
| Response serialization + TLS                | 10 ms  | 83 ms      |
| **Subtotal computed**                       |        | **83 ms**  |
| Headroom (jitter, GC, slow event-loop tick) | 117 ms | **200 ms** |

The 117 ms headroom is large because Node + libuv tail latency is
dominated by GC pauses and event-loop blocking from neighbour
requests, not by the steady-state work. Reducing the headroom is a
Phase 3 lever (CF Workers eliminate the GC pause class entirely;
budget collapses to ~80 ms total, the Phase 3 target).

---

## 4. Per-pod sizing — `apps/api` (NestJS)

Determines capacity for: all non-async surfaces (verify, identity,
policy, audit read, dashboard backend).

### 4.1 Pod shape

| Resource    | Phase 1 prod (Railway)      | Dev / staging | Notes                                       |
|-------------|------------------------------|---------------|---------------------------------------------|
| vCPU        | 2                            | 1             | Fastify event loop is single-thread-bound; second core covers GC + V8 background |
| Memory      | 2 GiB                        | 1 GiB          | NestJS + Prisma client baseline ≈ 350 MiB; remainder for connection pool buffers, JWT verification scratch |
| Concurrency | 25 in-flight req / pod       | 10            | Empirical sweet spot before tail latency knee on `/v1/verify`; revisit after k6 in `test/load/` |
| Pod count   | min 3 / max 12 (autoscale)   | 1             | min 3 = survive 1-pod loss + 1-pod deploy roll without budget breach |

### 4.2 Autoscale triggers (Railway)

| Trigger                                           | Threshold       | Action          | Cooldown |
|---------------------------------------------------|-----------------|-----------------|----------|
| CPU (1-min avg)                                   | > 65 %          | scale-out +1    | 60 s     |
| CPU (1-min avg)                                   | < 30 %          | scale-in −1     | 300 s    |
| `verify_latency_seconds` p95 (1-min)              | > 0.150 s       | scale-out +2    | 60 s     |
| `verify_latency_seconds` p99 (1-min)              | > 0.180 s       | page operator   | n/a      |
| Event-loop lag (1-min p99 from `prom-client`)     | > 50 ms         | scale-out +1    | 60 s     |
| Postgres pool waiters (1-min mean)                | > 5             | **do not** scale-out (would amplify DB pressure); page DBA |

Scale-in is asymmetric (5 × longer cooldown than scale-out) to avoid
oscillation under bursty load.

### 4.3 Why not Bun?

Considered. Rejected for Phase 1 because (a) Prisma's Bun support
was experimental at the spec freeze, and (b) NestJS's reflect-metadata
DI relies on V8 internals that occasionally surface Bun edge cases.
Reconsider at Phase 3 if Workers prove insufficient for any subset of
verify traffic.

---

## 5. Postgres capacity

Determines capacity for: every persistent write (audit append, agent
register, policy issue), every cache miss read.

### 5.1 Connection pool

```
Pool per app instance = min(2 × cores, 20)
                     = min(4, 20) = 4 connections per pod
Phase 1 max pods    = 12
Phase 1 max app conns = 12 × 4 = 48

Plus async workers: 4 BullMQ worker pods × 2 conns = 8
Plus dashboard backend: 1 dedicated pod × 4 conns = 4
Plus migrations + cron + admin = 5
                                  ─────
Total Postgres frontend pool = 65 connections
```

PgBouncer transaction-mode pooling sits in front:

| PgBouncer parameter        | Value          | Why                                                |
|----------------------------|----------------|----------------------------------------------------|
| `pool_mode`                | `transaction`  | Frees connections after each TX; required for our pool math |
| `default_pool_size`        | 30             | Backend Postgres capacity (see §5.2)               |
| `max_client_conn`          | 200            | Frontend ceiling — caps the headroom case where every pod opens its full pool |
| `reserve_pool_size`        | 5              | Burst safety; do not exceed default_pool_size      |
| `server_idle_timeout`      | 300 s          | Reclaim idle backends without thrash               |
| `query_wait_timeout`       | 5 s            | Fail fast if backend pool exhausted; pairs with API 503 |

**Important:** Prisma's prepared statements break under PgBouncer
transaction mode unless `pgbouncer=true` is on the connection string
(disables prepared statements). Documented in `apps/api/src/common/`
prisma module init.

### 5.2 Postgres instance sizing (Railway managed)

| Phase | Plan                  | vCPU | RAM    | Storage | Max conns | Notes                                       |
|-------|-----------------------|------|--------|---------|-----------|---------------------------------------------|
| Dev   | Railway hobby         | 1    | 1 GiB  | 20 GiB  | 100       | Local equivalent: docker-compose            |
| Phase 1 GA | Railway pro tier 4 | 4    | 16 GiB | 200 GiB | 200       | Headroom for 65 frontend × 3                |
| Phase 1 +12mo | Railway pro tier 8 | 8 | 32 GiB | 1 TiB   | 400       | Triggered when audit table > 100 GiB        |
| Phase 3   | Railway pro tier 16 + read replica | 16 + 16 | 64 GiB | 4 TiB | 800 | Read replica serves audit GET, JWKS publishing |

### 5.3 Slow query budget per surface

| Surface                       | Slow query budget       | Action on breach                          |
|-------------------------------|-------------------------|-------------------------------------------|
| Verify path (cache miss read) | 95% < 50 ms             | Index review + EXPLAIN ANALYZE in PR      |
| Management read               | 95% < 200 ms            | Same                                      |
| Management write              | 95% < 100 ms            | Same                                      |
| Audit GET (paginated)         | 95% < 300 ms            | Partition pruning check; reindex if needed |
| Audit append (outbox drain)   | 95% < 30 ms (per row)   | Outbox `SELECT … FOR UPDATE SKIP LOCKED` per ADR-0007 |
| Background cron (partition mgmt, BATE recompute) | n/a (off hours) | Move to maintenance window                 |

`pg_stat_statements` enabled in prod with retention of 7 days, scraped
nightly into `s3://aegis-perf/pg-stat/<date>.csv` for trend tracking.

### 5.4 AuditEvent partition strategy

Drives capacity for the **dominant write rate** of the system.

```
Audit row size (current) = ~1 KB (incl. signed payload + prev_hash)
Partition rate at +12 months = 130 M rows/day = ~1.5 K rows/sec sustained, 5 K rps burst
Per-month partition = ~4 B rows × 1 KB = ~4 TB at +12mo scale
```

This is **bigger than any single Postgres tier we will subscribe to**
at +12mo. Mitigation:

1. **Monthly RANGE partitions** so individual partition size stays
   bounded.
2. **Detach + archive at 18 months** → partitions older than 18mo are
   detached, exported to S3+GCS NDJSON (per RETENTION_POLICY.md §4),
   then `DROP TABLE`. Postgres only ever holds 18 months of hot data
   = ~24 partitions × ~1 TB = manageable.
3. **Partition pruning enforced** by always including a `timestamp >=
   $start AND timestamp < $end` in audit reads (`audit.service`
   defaults to last 30 days; longer ranges require explicit operator
   approval).
4. **Index strategy:** each partition has a composite index on
   `(principalId, timestamp DESC, eventType)` for the dominant
   read pattern (per-tenant time-bound search). No GIN/JSONB
   indexing on `policy_snapshot` — operational queries don't justify
   the write amplification.

Partition cron lives in `infra/postgres/partition-cron.sql` (per
ARCHITECTURE.md §12.1). Capacity-relevant invariant: **partition for
month N+1 must exist before second 0 of month N+1**. Cron runs
24h-ahead at 02:00 UTC on the 1st of each month; detached + archived
partitions roll off at 04:00 UTC same day, after archive integrity
check.

### 5.5 Replication & read scaling

- **Phase 1:** no replicas. Single-writer is sufficient at GA workload
  (sustained 50 rps writes, peak ~250 rps). Latency budget for audit
  append (30 ms) leaves headroom.
- **Phase 1 +6 months:** add a streaming replica for the audit GET
  path, sized 1:1 with primary. Replication lag SLO: p99 < 5 s.
  Audit reads accept replica reads (per `READ_REPLICA_OK` cookie /
  header on the audit module).
- **Phase 3:** logical replication for cross-region read replicas in
  EU + APAC (per EU residency, see §10).

---

## 6. Redis capacity

Determines capacity for: cache reads (`agent:*`, `policy:*`,
`verify:*`), DPoP nonce store, spend counters, BullMQ queues.

### 6.1 Memory model

Three logical databases on the same Redis cluster (separate DBs to
allow distinct eviction policies):

| Logical DB | Purpose                        | Eviction policy          | Persistence            | Memory budget Phase 1 |
|------------|--------------------------------|--------------------------|------------------------|-----------------------|
| 0          | Caches: `agent:*`, `policy:*`, `verify:*` | `allkeys-lru` | AOF `everysec`         | 4 GiB                 |
| 1          | Spend counters (`spend:*`)     | `noeviction` (load-bearing) | AOF `always` (durability) | 1 GiB                 |
| 2          | DPoP nonce set + jti dedup     | `volatile-ttl`            | AOF `everysec`         | 2 GiB                 |
| 3          | BullMQ queues + delayed jobs   | `noeviction`              | AOF `everysec`         | 1 GiB                 |

**Total Phase 1 prod Redis memory: 8 GiB minimum**, sized to 16 GiB
Railway plan to give 2× headroom.

### 6.2 Per-key budgets

| Key prefix              | Max key count Phase 1 | Avg value size | Total       | Notes                                   |
|-------------------------|------------------------|----------------|-------------|-----------------------------------------|
| `agent:{id}`            | 1 M (12mo agents)      | 512 B           | 500 MiB     | TTL 60 s; LRU evictable                 |
| `agent:{id}:trust`      | 1 M                    | 64 B            | 64 MiB      | TTL 60 s                                |
| `agent:{id}:notfound`   | 100 K (DoS attack budget) | 32 B          | 3 MiB       | TTL 60 s                                |
| `policy:{id}`           | 250 K                  | 2 KiB           | 500 MiB     | TTL 30 s                                |
| `verify:{tokenHash}:{action}` | 500 K            | 256 B           | 128 MiB     | TTL 30 s; key includes `jti` per A-016  |
| `spend:{policyId}:day:{YYYY-MM-DD}` | 250 K        | 32 B            | 8 MiB       | TTL until midnight UTC                  |
| `spend:{policyId}:month:{YYYY-MM}` | 250 K         | 32 B            | 8 MiB       | TTL until next month                    |
| `dpop:nonce:{nonce}`    | 5 M (5-min TTL × 16K rps DPoP issuance peak) | 16 B | 80 MiB | TTL 300 s; per ADR-0010 |
| `jti:{jti}`             | 500 K (window TTL)     | 16 B            | 8 MiB       | TTL = max policy TTL + 60 s slack       |
| BullMQ overhead         | n/a                    | n/a             | 500 MiB     | Queue keys, delayed sets, completed sets |

Sum at +12mo headroom: **~1.8 GiB working set** out of 8 GiB budget,
leaving 4× evictable headroom.

### 6.3 Why DB 1 (spend) is `noeviction`

Spend counter loss = silent re-grant of spend after the day's first
read. Eviction of a spend counter would be a correctness bug, not a
performance loss. So `noeviction` and `appendfsync always` (slower
write but no fsync gap on hard kill).

If memory pressure hits DB 1 budget, the explicit operator action is
to **add more memory**, not to evict. Page on `redis_memory_used_bytes
{db="1"} > 0.8 × max`.

### 6.4 Redis instance sizing

| Phase | Plan                       | Memory | Persistence backups | Notes |
|-------|----------------------------|--------|---------------------|-------|
| Dev   | docker-compose redis:7-alpine | 256 MiB | none              | local |
| Phase 1 GA | Railway Redis 8 GiB    | 8 GiB  | snapshot every 1h to S3 | DB 1 noeviction; rest LRU |
| Phase 1 +12mo | Railway Redis 16 GiB | 16 GiB | snapshot every 1h    |       |
| Phase 3   | Railway Redis 32 GiB + replica | 32 GiB | snapshot 30min      | replica for read fan-out, primary still authoritative for spend |

### 6.5 Redis cluster vs single-node

Phase 1 = single-node primary + standby replica (Railway managed).
Cluster mode is **deferred** because:
- Multi-key ops on `spend:` (read + INCRBY + write back on Postgres
  reconciliation) are simpler when keys land on one node.
- AEGIS workload at +12mo (1.5 K rps reads + 50 rps writes) fits
  comfortably on a single 32-GiB node.
- BullMQ + cluster has historical sharp edges (delayed jobs across
  shards).

Re-evaluate at Phase 3 if regional sharding is required.

---

## 7. BullMQ worker capacity

Determines capacity for: webhook delivery, BATE signal scoring, audit
DLQ drain, policy expiry sweep, BATE webhook emit.

### 7.1 Per-queue concurrency

| Queue                | Concurrency / pod | Pods | Aggregate Phase 1 throughput | Bottleneck                                  |
|----------------------|-------------------|------|-------------------------------|---------------------------------------------|
| `webhook:deliver`    | 5                 | 2    | 10 × HMAC sign + POST = ~50 rps with p95 200 ms | Customer endpoint latency (we do not control) |
| `bate:signal`        | 3                 | 2    | 6 × score recompute = ~30 rps with p95 100 ms | Postgres write contention if > 30 rps    |
| `audit:dlq`          | 1                 | 2    | 2 × outbox drain (batched 100/round) = ~200 events/sec | Postgres write IOPS                  |
| `policy:expiry-sweep`| 1                 | 1    | cron every 5 min, batch UPDATE | Negligible                                 |
| `bate:webhook-emit`  | 2                 | 2    | 4 × trust-band notifications  | webhook deliver queue (downstream)          |

Total worker pods: 4 (two pods cover all queues, deployed in two
worker-instance Railway services for failover).

### 7.2 Backpressure & DLQ thresholds

| Queue              | Healthy depth | Warning depth | Page depth | DLQ trigger                        |
|--------------------|----------------|----------------|------------|------------------------------------|
| `webhook:deliver`  | < 100          | 500            | 5 000      | 8 attempts (per OD-005)            |
| `bate:signal`      | < 50           | 200            | 1 000      | 5 attempts                         |
| `audit:dlq`        | < 1 000 (transient by design) | 10 000  | 50 000  | n/a — this *is* the DLQ            |

`audit:dlq` deserves special call-out: it is the outbox drain for
ADR-0007 transactional outbox. A growing depth means Postgres is
behind on write throughput, not that webhooks are failing.

### 7.3 Webhook customer-side budget

Per OD-005, 8 attempts over ~3 days. Capacity-relevant: per-customer
delivery worker reservation is **soft** — a slow customer cannot
starve a fast customer because we use BullMQ priority queues with
per-subscription rate cap (1 in-flight per subscription, configurable
per Enterprise plan).

---

## 8. Cloudflare Worker capacity (Phase 3)

Determines capacity for: the lifted `/v1/verify` hot path. Targets
listed for forward planning; Phase 1 capacity is bound by §4–§6.

### 8.1 Per-region throughput

| Region             | Target rps | Verify CPU per req | KV reads per req | Sub-request budget |
|--------------------|------------|---------------------|------------------|--------------------|
| Each of 5 regions  | 10 000     | < 1 ms              | 2 (agent + policy, KV-cached) | 2 (KV reads only — no D1 in hot path) |

CF Worker per-invocation budget: 50 ms CPU, 50 ms wall (free) /
30 s wall (paid). Our 80 ms p99 fits both.

### 8.2 KV size budget (per region)

| Key prefix | Size | Count at Phase 3 | Total per region |
|------------|------|------------------|------------------|
| `agent:{id}` | 512 B | 1 M (mirror of Postgres) | 500 MiB |
| `policy:{id}` | 2 KiB | 250 K | 500 MiB |
| Audit signing key (latest) | 1 KiB | 1 | 1 KiB |
| **Total** | | | **~1 GiB / region** |

CF KV per-namespace soft cap: 1 GB free, 50 GB on Workers Paid Plan.
Phase 3 lands on Paid Plan; budget headroom is 50×.

### 8.3 D1 budget (audit append from edge)

D1 is the **edge audit outbox** for the Phase 3 KV-cache-hit
verify-without-management-region scenario (per ARCHITECTURE.md
§10.5). Each region's D1 holds at most 24 hours of audit overflow,
replicated back to Postgres on management-plane recovery.

| Metric                 | Budget                      | Notes |
|------------------------|------------------------------|-------|
| Outbox row size        | ~1 KiB (signed payload)      |       |
| Max retention in D1    | 24 hours                     | Hard delete after replay confirmed |
| Storage / region / 24h | ~10 K rps × 86400 = 870 M rows × 1 KiB = ~900 GiB | Exceeds D1 free tier; sized for Workers Paid Plan |
| Replication target     | 100% within 5 min of mgmt-plane recovery | enforced by replay job |

**Caveat:** D1 was GA at the time of writing but the storage budget
above assumes pricing parity with paid SQLite hosts. Re-validate at
Phase 3 contract signing.

---

## 9. KMS capacity (per ADR-0011, M-023)

Determines capacity for: every audit-chain signature, every policy
JWT issuance.

### 9.1 Sign rate budget

| Operation             | Rate Phase 1 | Rate Phase 3 | Provider latency budget |
|-----------------------|--------------|--------------|-------------------------|
| Audit-chain sign      | 50 rps       | 1 500 rps    | < 30 ms                 |
| Policy JWT issue      | 50 rps       | 50 rps (mgmt-plane only) | < 30 ms       |

### 9.2 Per-provider headroom

| Provider                    | Vendor sign rate cap (per key) | Phase 1 utilization | Phase 3 utilization | Notes |
|-----------------------------|--------------------------------|---------------------|---------------------|-------|
| In-memory (dev only)        | n/a                             | n/a                 | n/a                 | Not for prod |
| AWS KMS (RSA fallback at Phase 1 GA, see ADR-0011) | 5 500 rps shared per region | 100 / 5 500 = 1.8 % | 1 550 / 5 500 = 28 % | Multi-region key replication requires KMS multi-Region keys |
| GCP Cloud KMS (native EdDSA) | 6 000 rps per key version       | 100 / 6 000 = 1.7 % | 1 550 / 6 000 = 26 % | Plenty of headroom |
| HashiCorp Vault Transit     | configurable; default 10 000 rps | 100 / 10 000 = 1 % | 1 550 / 10 000 = 16 % | Self-hosted Vault sizing depends on operator infra |

All within 1-cap headroom even at Phase 3. **The real KMS bottleneck
is per-request latency, not throughput**. Operator must provision
in-region KMS endpoints for any Phase 3 region (Workers cannot wait
50 ms for cross-region KMS).

### 9.3 KMS rotation capacity

Per ADR-0011, **annual** key rotation. Rotation event:
1. New KMS key version provisioned 30 days ahead.
2. Both old + new key valid for 30-day overlap window.
3. JWKS publishes both during overlap; verifiers tolerate either.
4. Old key disabled after overlap; cryptographic destroy 7 years later
   per RETENTION_POLICY.md §6.

The overlap window means **no capacity dip** during rotation.

---

## 10. Multi-region capacity (Phase 3 + EU residency)

Per `docs/EU_RESIDENCY.md`, EU customers' data must remain in EU
region. Capacity-relevant interactions:

### 10.1 Per-region resource model

| Resource              | Multi-region scope             | Notes                                           |
|-----------------------|--------------------------------|-------------------------------------------------|
| CF Workers            | All regions                    | Verify hot path, KV-cached identity + policy    |
| CF KV                 | Replicated to all regions       | Cache layer; tolerates eventual consistency     |
| CF D1                 | Per-region                     | Audit overflow; replicates back to home region   |
| Postgres (mgmt)       | Single home region per Principal | EU principal → Postgres in EU; US principal → US |
| Redis (mgmt)          | Co-located with Postgres        |                                                 |
| BullMQ workers        | Co-located with Postgres        |                                                 |
| KMS                   | Per-region replica for sign     | Cross-region only for rotation events           |

### 10.2 EU principal segregation

- A `Principal` row carries `dataResidency: 'us' | 'eu' | 'ap'`.
- Routing layer (CF Worker → Postgres) honours the residency tag —
  EU principal traffic never reaches a US Postgres.
- Capacity sizing per region uses §2.2 multipliers scaled by the
  EU/US/AP traffic split (default at GA: 70/25/5 → EU sized at 25%
  of US baseline).

### 10.3 Cross-region failover capacity

- Each region is sized for **2 × its own steady traffic** to absorb
  one peer region's traffic during failover.
- Failover is *not* automatic across data-residency boundaries — EU
  failover stays inside EU.

---

## 11. Cost envelope

Order-of-magnitude estimates at Phase 1 GA → Phase 3. Numbers in USD,
exclude the Phase 1 single Railway dev environment (~$50/mo).

### 11.1 Per-component monthly cost

| Component               | Phase 1 GA   | Phase 1 +12mo | Phase 3 (5 regions) |
|-------------------------|--------------|----------------|----------------------|
| Railway API pods (3-12) | $80–$300     | $200–$700      | $300 (mgmt only)     |
| Railway Postgres        | $250         | $700           | $1 200 + replicas    |
| Railway Redis           | $100         | $200           | $400                 |
| Railway worker pods (4) | $100         | $200           | $300                 |
| Cloudflare Workers Paid | n/a          | n/a            | $5 + $0.30 per M req |
| Cloudflare KV           | n/a          | n/a            | $5 + storage         |
| Cloudflare D1           | n/a          | n/a            | $5 + storage         |
| KMS (AWS or GCP)        | $5–$20       | $50            | $200 cross-region    |
| Auth0 (B2B Essentials)  | $130         | $130           | $240 (more orgs)     |
| Sentry (Team plan)      | $26          | $80            | $80                  |
| Datadog / Grafana Cloud | $200         | $400           | $600                 |
| S3 + GCS audit archive  | $50          | $200           | $1 500               |
| Status page             | $0 (self-hosted) | $0          | $0                   |
| **Total / month**       | **~$1 000**  | **~$3 000**    | **~$10 000+ traffic** |

### 11.2 Per-1M-verify marginal cost (Phase 3)

```
CF Workers + KV reads:                        $0.30 + 2×$0.50 = $1.30 / M
KMS audit signature (GCP):                    $0.03 / 10K = $3.00 / M  (dominant)
Postgres audit insert (replicated):           ~$0.50 / M
S3 + GCS archive write (after 18 months):     $0.04 / M
Sentry, Datadog incremental:                  $0.20 / M
                                               ────────
Total marginal cost / M verifies:             ~$5.00 / M
```

This is the **floor for pricing tier OD-003**. The current OD-003
proposal (Free 1K/mo, Developer $49/50K, Growth $299/500K) charges
$5.98/M to Growth — gross margin is positive but slim. Operator
should revisit pricing once measured cost lands.

KMS sign cost is the dominant marginal item. Pre-aggregating multiple
audit events into a single signed batch (M-038, peer-territory)
would drop the dominant term by ~10×.

### 11.3 Storage cost growth

| Year | Audit hot (Postgres) | Audit warm (S3+GCS) | Audit cold (Glacier+Coldline) | Total / mo |
|------|----------------------|---------------------|--------------------------------|-------------|
| GA   | 4 M × $0.10/GB = $0.40 | $0                  | $0                              | $0.40       |
| +12mo | 130 M × $0.10/GB = $13 | $0                | $0                              | $13         |
| +3yr (post first 18mo cycle) | 100 GB × $0.10 = $10 | 1 TB × $0.023 = $23 | $0 | $33         |
| +7yr | 100 GB × $0.10 = $10 | 1 TB × $0.023 = $23 | 5 TB × $0.004 = $20 | $53        |

Storage is **not** the dominant cost; signing is. This justifies
keeping the audit chain Ed25519 + 1 KB rows rather than pursuing
column-store optimization that complicates redaction (per
RETENTION_POLICY.md §3).

---

## 12. Headroom + scaling triggers (consolidated)

| Layer       | Metric                              | Healthy | Scale-out trigger | Page operator |
|-------------|--------------------------------------|---------|-------------------|---------------|
| API pod     | CPU 1-min                            | < 50%   | > 65%             | n/a           |
| API pod     | Event-loop lag p99 1-min             | < 20 ms | > 50 ms           | > 100 ms      |
| API pod     | Verify p95 1-min                     | < 100 ms| > 150 ms          | > 180 ms      |
| Postgres    | Pool waiters mean 1-min              | 0       | n/a (do not autoscale; alert) | > 5 |
| Postgres    | Replication lag p99                  | < 2 s   | n/a (alert)        | > 10 s        |
| Postgres    | Slow query rate (> 200ms)            | < 1%    | n/a                | > 5%          |
| Redis       | Memory used % of max                 | < 50%   | n/a (provision)   | > 80%         |
| Redis       | Evictions / sec on DB 0 (cache)     | < 10    | n/a                | > 100         |
| Redis       | Evictions / sec on DB 1 (spend)     | 0       | n/a (page immediately) | any > 0   |
| BullMQ      | `webhook:deliver` queue depth       | < 100   | n/a (not queue-bound) | > 5 000   |
| BullMQ      | `audit:dlq` depth                   | < 1 000 | n/a                | > 50 000      |
| KMS         | sign p99                             | < 20 ms | n/a (provider)    | > 50 ms       |
| KMS         | sign error rate                      | 0       | n/a                | > 0.1%        |

**No layer autoscales on a metric that, when it spikes, would worsen
the upstream pressure** (e.g. Postgres pool waiters: scaling the API
adds connections, not capacity). Those layers page the operator
instead.

---

## 13. Load test plan

Lives at `apps/api/test/load/` (per WORK_BOARD M-005 acceptance).

### 13.1 Required scenarios

| Scenario                  | Tool          | Profile                                | Pass criterion                                    |
|---------------------------|---------------|-----------------------------------------|---------------------------------------------------|
| `verify-steady`           | k6            | 1 000 rps for 15 min                    | p99 < 200 ms, error rate < 0.1%                   |
| `verify-burst`            | k6            | 0 → 2 500 rps over 60 s, hold 5 min     | autoscaler engages, no 500s, ≤ 5% 429s            |
| `verify-cache-cold`       | autocannon    | 500 rps with cache pre-flush            | DB pool not exhausted, p99 < 250 ms during warm-up |
| `redis-failover`          | k6 + chaos    | kill primary mid-test, observe failover | Spend counters: zero increment loss; cache: ≤ 30s of LRU re-warming |
| `postgres-pause`          | k6 + chaos    | pause primary 60 s during steady-state  | Outbox absorbs writes; no audit-chain break       |
| `audit-archive-roll`      | controlled    | trigger 18mo partition detach + S3 export | < 30s detach, archive Merkle root verifies        |

### 13.2 Cadence

- **Pre-merge:** `verify-steady` (5-min variant) on every PR that
  touches verify path or Prisma schema.
- **Pre-release:** full suite, Friday before each Railway production
  deploy.
- **Quarterly:** chaos suite (`redis-failover`, `postgres-pause`).

### 13.3 Capacity-test environment

A dedicated Railway environment (`aegis-capacity`) sized **at the
production budgets in this document**. Re-provisioned monthly to
reflect any sizing changes ratified in the §15 review.

---

## 14. Capacity reservations for sister-project rollouts

Per `AEGIS_AS_BACKBONE.md` §3 and §7 roll-out order, each sister
project triggers a step-function in workload. Pre-allocated:

| Project | Trigger event                  | Capacity bump                                       |
|---------|--------------------------------|------------------------------------------------------|
| Apex    | Reconcile-workflow shadow → enforce | +5 verify rps sustained, +50 audit/day; absorbed in current sizing |
| CerniQ  | Agent-layer ingress shadow     | +5 verify rps; absorbed                              |
| CerniQ  | Agent-layer enforce            | +20 verify rps sustained; **trigger: review §4 pod cap** |
| FORGE   | 6-RBAC-v11 transition shadow   | +30 verify rps sustained; **trigger: provision Phase 1 +6mo Postgres tier** |
| FORGE   | Enforce                        | +200 verify rps sustained; **trigger: provision read replica** |
| Bimba   | post-stabilization             | +30 verify rps sustained; absorbed if FORGE replica online |

Each "trigger" maps to a §12 scaling action that **must be completed
before the project flips its enforcement gate**. Per-project
adoption owner confirms via `claude-peers msg` to the AEGIS owner.

---

## 15. Capacity review cadence

| Review                   | Frequency        | Owner            | Output                                     |
|--------------------------|------------------|------------------|--------------------------------------------|
| Per-PR perf check        | every PR         | reviewer         | k6 `verify-steady` short variant green     |
| Weekly metrics digest    | Friday           | on-call          | Trend report from Datadog dashboards       |
| Quarterly capacity review| 1st week of Q    | operator + SRE   | Updated §2.3 growth assumptions, §11 cost projection, §12 thresholds |
| Annual sizing audit      | Q1               | operator         | Provider re-shopping; budget revision      |

The quarterly review is the canonical time to **edit the assumed
numbers in this document with measurements**, removing
`<!-- assumption: ... -->` markers.

---

## 16. Cross-references

| Topic                          | Source                                                       |
|--------------------------------|---------------------------------------------------------------|
| Architecture summary           | `docs/ARCHITECTURE.md` §11                                    |
| Failure modes (degradation)    | `docs/FAILURE_MODES.md`                                       |
| Storage growth driver          | `docs/RETENTION_POLICY.md`                                    |
| SLOs / SLIs                    | `docs/SLO.md`                                                 |
| Disaster recovery + DR runbook | `docs/DR_RUNBOOK.md`                                          |
| EU residency                   | `docs/EU_RESIDENCY.md`                                        |
| KMS architecture               | `docs/decisions/0011-key-rotation-kms.md` + M-023             |
| Outbox + audit append          | `docs/decisions/0007-transactional-outbox.md`                 |
| Rate-limit dimensions          | `docs/SECURITY.md` §7 + `OPERATOR_DECISIONS.md` OD-006       |
| Webhook DLQ                    | `OPERATOR_DECISIONS.md` OD-005                                |
| Pricing-tier capacity          | `OPERATOR_DECISIONS.md` OD-003                                |
| Audit retention horizon        | `OPERATOR_DECISIONS.md` OD-004                                |
| Multi-project capacity bumps   | `docs/AEGIS_AS_BACKBONE.md` §3 + §7                           |

---

## Appendix A — open assumptions (resolve before GA)

These are the `<!-- assumption: ... -->` markers extracted into one
place for the §15 quarterly review.

1. <!-- assumption: §2.2 RP traffic mix is operator's best estimate; FORGE/CerniQ/Apex/Bimba teams should confirm verify rps targets per their own SLO docs. -->
2. <!-- assumption: §4.1 NestJS per-pod concurrency 25 is empirically defensible from prior projects but not yet measured on AEGIS itself. Replace after k6 in apps/api/test/load/. -->
3. <!-- assumption: §6.4 Railway Redis 8 GiB plan exists at the cited price; confirm against Railway pricing page at quarterly review. -->
4. <!-- assumption: §8.3 D1 storage budget at Phase 3 assumes generous CF pricing; risk that 5-region 24h overflow exceeds D1 economics. Re-evaluate in Phase 3 design phase. -->
5. <!-- assumption: §9.2 GCP KMS EdDSA sign rate 6 000 rps per key version is the documented figure; AWS RSA fallback rate 5 500 rps is per-region shared which makes hot-key fanout the real bottleneck — sized assuming AEGIS is one of several KMS consumers in the AWS account. -->
6. <!-- assumption: §11.3 Glacier + Coldline pricing $0.004/GB-mo combines AWS and GCP; check parity at Phase 3 procurement. -->
7. <!-- assumption: §10.1 Workers KV global replication has < 1 min staleness — Cloudflare publishes ~60 s p99 globally; verify before Phase 3 commits to KV-as-source for verify cache. -->
