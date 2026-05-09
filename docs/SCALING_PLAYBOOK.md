# AEGIS — Scaling Playbook
## Traffic Surge Handling, Connection Pools, Redis Tuning, CF Workers Rollout

> **Owner:** Engineering Lead  
> **Updated:** 2026-05-04  
> **Baseline:** Phase 1 target — 500 RPS, p99 < 200ms  
> **Phase 2 target:** 5,000 RPS, p99 < 100ms  
> **Phase 3 target:** 50,000+ RPS via Cloudflare Workers edge

---

## 1. Scaling Overview

AEGIS has a clear architectural scaling path. Each phase requires specific work:

```
Phase 1 (now):    500 RPS    → Railway origin, 2 replicas, PG + Redis
Phase 2 (~$10K MRR): 5K RPS → PgBouncer, Redis cluster, read replica
Phase 3 (~$100K MRR): 50K+  → CF Workers edge verify, KV cache, origin as backstop
```

The verify hot path was designed from day one for edge portability (CLAUDE.md Invariant #2). That investment pays off in Phase 3.

---

## 2. Phase 1 — Railway Scaling (Current)

### 2.1 Vertical Scaling (Immediate)

When p99 > 200ms and the bottleneck is CPU/memory:

```bash
# Railway: Service → Settings → Resources
# Phase 1 targets:
# API: 1 vCPU, 2GB RAM per replica
# PostgreSQL: 1 vCPU, 4GB RAM, 50GB SSD
# Redis: 512MB RAM

# Check current resource usage:
railway status --service api
```

Memory breakdown per API instance:
- NestJS process: ~200MB base
- Prisma client connection pool (20 connections): ~100MB
- Redis client: ~20MB
- In-flight requests (at 500 RPS): ~200MB
- Total: ~520MB → recommend 1GB minimum, 2GB for headroom

### 2.2 Horizontal Scaling (Standard)

Add replicas when CPU > 70% sustained or you need HA:

```bash
# Railway: Service → Settings → Replicas → 2 (minimum for HA)
# Each replica is independent — Railway load balances automatically

# Verify both replicas are healthy
curl -s https://api.aegislabs.io/health | jq .status
# Check from multiple IPs to hit different replicas
```

**State that must be external (not per-replica):**
- Session data: none (stateless JWT verify)
- Spend counters: Redis (shared)
- JTI replay cache: Redis (shared)
- Rate limiting: Redis (shared)
- Audit events: PostgreSQL (shared)

All state is already external. Horizontal scaling is safe.

### 2.3 Auto-Scaling Configuration

```yaml
# Railway Pro: configure auto-scaling
# Min replicas: 2 (HA requirement)
# Max replicas: 10
# Scale trigger: CPU > 70% for 3 minutes
# Scale down: CPU < 30% for 10 minutes (conservative — avoid thrashing)
```

---

## 3. Database Scaling

### 3.1 Identify the Bottleneck First

Before scaling, confirm DB is actually the bottleneck:

```bash
# Check OTel traces: are db.query spans > 50ms?
# Check Railway metrics: is DB CPU > 80%?

# Quick check from psql:
psql $DATABASE_URL -c "
  SELECT count(*) as active_connections, state
  FROM pg_stat_activity 
  WHERE datname = 'aegis'
  GROUP BY state;
"
# If active_connections near max_connections (100 default): need pooling
# If CPU high: need read replica or query optimization
```

### 3.2 Read Replica for Audit Queries

Audit export queries (long date ranges, no time limit) can saturate the write DB. Add a read replica for these:

```bash
# Railway: PostgreSQL → Add Read Replica
# Cost: ~$10/month for Railway starter replica

# Configure in app:
DIRECT_DATABASE_URL=postgresql://...  # write path (primary)
DATABASE_URL=postgresql://...          # read path (replica, via PgBouncer)

# In PrismaService, route reads to replica:
const prismaRead = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_READ } } });
```

Queries to route to read replica:
- `GET /v1/audit` (export queries)
- `GET /v1/agents` (listing, not hot path)
- `GET /v1/policies` (listing)
- BATE signal aggregation queries

Queries that MUST use primary:
- `POST /v1/verify` (reads are part of transaction)
- `POST /v1/agents` (writes)
- Any mutation

### 3.3 Connection Pooling with PgBouncer

At > 100 sustained RPS, PostgreSQL's max_connections (100 by default) becomes the bottleneck. Deploy PgBouncer:

```bash
# Railway: deploy PgBouncer service
# PgBouncer config (see DATABASE_OPERATIONS.md §5.2)

# After PgBouncer:
DATABASE_URL="postgresql://user:pass@pgbouncer:6432/aegis?pgbouncer=true"
DIRECT_DATABASE_URL="postgresql://user:pass@postgres:5432/aegis"

# Prisma requires DIRECT_DATABASE_URL for migrations
# Regular DATABASE_URL goes through PgBouncer
```

Expected improvement: from ~100 concurrent DB connections to ~2000 client connections multiplexed through 20 server connections.

### 3.4 Query Optimization Checklist

Before scaling hardware, optimize queries:

```sql
-- Find the slowest queries
SELECT 
  LEFT(query, 80) as query,
  calls,
  ROUND(mean_exec_time::numeric, 1) as avg_ms,
  ROUND(total_exec_time::numeric, 0) as total_ms
FROM pg_stat_statements
WHERE calls > 1000 AND mean_exec_time > 5
ORDER BY mean_exec_time DESC LIMIT 10;

-- Missing indexes? Check for seq scans on large tables
SELECT schemaname, tablename, seq_scan, seq_tup_read, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > 0 AND seq_tup_read > 10000
ORDER BY seq_tup_read DESC;
```

---

## 4. Redis Scaling

### 4.1 Redis Memory Budget

Key categories and TTLs:

| Key Pattern | Purpose | TTL | Size Estimate |
|-------------|---------|-----|---------------|
| `aegis:jti:{jti}` | Replay prevention | 30s (token TTL) | 50 bytes × active_rps |
| `aegis:spend:{agentId}:{date}` | Daily spend counter | 24h | 100 bytes × agents |
| `aegis:revoke:{agentId}` | Revocation cache | 5min (CDN-like) | 50 bytes × revoked_agents |
| `aegis:rl:{ip}:{window}` | Rate limiting | 1 min | 50 bytes × unique_ips |
| `aegis:bate:signals:{agentId}` | BATE signal buffer | 1h | 1KB × active_agents |

Memory calculation for 10K agents at 100 RPS:
- JTI cache: 100 req/s × 30s TTL × 50 bytes = ~150KB
- Spend counters: 10K agents × 100 bytes = 1MB
- Revocation cache: ~1K revoked agents × 50 bytes = 50KB
- Rate limiting: ~10K unique IPs × 50 bytes = 500KB
- BATE signal buffer: 10K agents × 1KB = 10MB
- **Total: ~12MB** — well within 512MB

At 1M agents: scale to ~1.2GB → upgrade to Redis Pro (8GB).

### 4.2 Redis Configuration Tuning

```bash
# Required production settings (verify before GA)
redis-cli -u $REDIS_URL CONFIG SET maxmemory-policy allkeys-lru
redis-cli -u $REDIS_URL CONFIG SET appendonly yes          # AOF persistence
redis-cli -u $REDIS_URL CONFIG SET appendfsync everysec    # 1s durability window

# Monitor slow operations
redis-cli -u $REDIS_URL CONFIG SET slowlog-log-slower-than 10000  # 10ms
redis-cli -u $REDIS_URL SLOWLOG GET 10

# Check memory
redis-cli -u $REDIS_URL INFO memory | grep -E "used_memory_human|maxmemory_human|mem_fragmentation"
```

### 4.3 Redis Failure Modes

AEGIS is designed to fail closed on Redis unavailability:

| Redis Down | Behavior | User Impact |
|-----------|---------|------------|
| JTI cache unavailable | ANOMALY_FLAGGED (fail-closed) | Verify denied until Redis recovers |
| Spend counter unavailable | ANOMALY_FLAGGED (fail-closed) | Verify denied |
| Rate limit cache unavailable | Rate limiting disabled | Potential abuse window |
| Revocation cache unavailable | Falls through to DB | Slight latency increase, correct behavior |

The fail-closed behavior for JTI and spend is intentional (CLAUDE.md Invariant: no silent failures). 

### 4.4 Redis Sentinel / Cluster (Phase 2+)

At >10K agents or >1K RPS with spend tracking, single Redis is a SPOF:

```bash
# Upstash Redis Pro: built-in replication + failover
REDIS_URL=redis://default:password@your-upstash-endpoint:6379

# OR Railway Redis Pro with Redis Sentinel
# Requires updating connection string format for sentinel
REDIS_SENTINEL_URL=redis+sentinel://sentinel1:26379,sentinel2:26379/aegis
```

---

## 5. Cloudflare Workers Edge Rollout (Phase 3)

### 5.1 Architecture

```
Client request
  ↓
Cloudflare Edge (100+ PoPs worldwide)
  → Edge verify (sub-50ms for most requests)
  → KV cache: agent public keys, policies, spend counters
  → If SUSPENDED agent or complex policy: forward to origin
  ↓
Railway Origin (as fallback / write path)
```

### 5.2 Shadow Mode Deployment

Before moving traffic to edge, run in shadow mode:

```bash
# wrangler.toml: enable shadow mode
[vars]
AEGIS_EDGE_MODE = "shadow"
# In shadow mode: edge evaluates but origin makes the authoritative decision
# X-AEGIS-Edge-Divergence header shows when edge and origin disagree

# Deploy shadow mode worker
wrangler deploy --env production

# Monitor divergence rate:
curl https://api.aegislabs.io/metrics | grep edge_divergence
# Target: <0.1% divergence before promoting to live
```

### 5.3 KV Cache Warm-Up

```bash
# Populate KV with all active agent public keys before routing traffic to edge
pnpm tsx scripts/warm-edge-kv.ts \
  --agents all \
  --policies active \
  --namespace AEGIS_AGENTS

# This pushes to Cloudflare KV:
# KV: aegis:agent:{agentId} → { publicKey, status, trustBand, policyIds }
# KV: aegis:policy:{policyId} → { type, scopes, limits }
# KV: aegis:spend:{agentId}:{date} → current counter (synced from Redis)
```

### 5.4 Traffic Promotion Steps

```
Week 1:  Shadow mode, 0% edge traffic, measure divergence
Week 2:  5% canary to edge, measure latency + correctness
Week 3:  25% to edge, monitor spend counter sync accuracy
Week 4:  75% to edge, origin becomes backstop only
Week 5:  95% to edge, origin handles writes + complex cases
```

Rollback at any step: update Cloudflare page rule to bypass Worker.

### 5.5 Spend Counter Sync

The tricky part: spend counters live in Redis (origin), but edge decisions need them.

Strategy:
1. Edge checks KV for approximate spend counter (synced every 1 second).
2. If within 20% of limit: forward to origin for precise check.
3. If clearly under limit: approve at edge without origin call.
4. If clearly over limit: deny at edge without origin call.

```typescript
// workers/cf-verify/src/edge-verify.ts — spend handling
const edgeSpend = await env.AEGIS_SPEND.get(spendKey);
const current = parseInt(edgeSpend ?? '0', 10);

if (current > limit * 1.2) {
  // Clearly over limit — deny at edge
  return { outcome: 'decided', result: deny('SPEND_LIMIT_EXCEEDED') };
}

if (current > limit * 0.8) {
  // In the 80-120% range — need precise check at origin
  return { outcome: 'forward', reason: 'spend_boundary' };
}

// Clearly under limit — approve (optimistically)
// Origin will catch any race conditions
```

---

## 6. Traffic Surge Response Playbook

### 6.1 Symptoms of a Traffic Surge

```
- Railway CPU suddenly > 80%
- Verify p99 climbing (50ms → 100ms → 200ms)
- DB connection pool approaching saturation
- Redis latency spiking
- Error rate beginning to increase
```

### 6.2 Immediate Response (< 5 minutes)

```bash
# Step 1: Quantify the surge
curl -s "https://api.aegislabs.io/metrics" | grep "aegis_http_requests_total"
# Baseline is ~N req/min. If 10x: real surge.

# Step 2: Is it legitimate or abuse?
# Check top principals by request volume:
psql $DATABASE_URL -c "
  SELECT \"principalId\", COUNT(*) as req_count
  FROM \"AuditEvent\"
  WHERE \"createdAt\" > NOW() - INTERVAL '5 minutes'
  GROUP BY \"principalId\"
  ORDER BY req_count DESC
  LIMIT 10;
"
# If one principal is 90% of traffic → rate limit them (see Step 5)
# If distributed → legitimate surge, scale up

# Step 3: Scale up Railway replicas immediately
# Railway dashboard → API service → Scale replicas to 4-6

# Step 4: Check DB — is it keeping up?
psql $DATABASE_URL -c "SELECT count(*), state FROM pg_stat_activity WHERE datname='aegis' GROUP BY state;"
# If active connections > 80% of pool: scale DB too

# Step 5: If abuse — rate limit the offending principal
aegis admin rate-limit \
  --principal [PRINCIPAL_ID] \
  --limit 1req/s \
  --duration 1h \
  --reason "traffic-surge-investigation"
```

### 6.3 Sustained High Traffic

If surge is sustained and legitimate:

```
Hour 1: Scale Railway replicas (2 → 6)
Hour 2: Enable PgBouncer if not already (see §3.3)
Hour 3: Add Redis replica for read load
Day 1:  Evaluate CF Workers edge rollout (Phase 3 path)
Week 1: Full Phase 3 deployment if traffic stays high
```

### 6.4 Load Shedding

As a last resort, when infrastructure is fully saturated:

```typescript
// In verify.controller.ts: emergency load shedding
if (await redisService.get('aegis:load_shed') === 'active') {
  // Shed 50% of FREE tier traffic
  if (principal.tier === 'free' && Math.random() < 0.5) {
    throw new ServiceUnavailableException({
      error: 'SERVICE_OVERLOADED',
      message: 'Service temporarily overloaded. Upgrade to PRO for priority access.',
      retryAfterSeconds: 30,
    });
  }
}
```

Enable load shedding:
```bash
redis-cli -u $REDIS_URL SET aegis:load_shed active EX 3600
# Disable:
redis-cli -u $REDIS_URL DEL aegis:load_shed
```

---

## 7. Performance Benchmarks

### 7.1 Latency Budget (Phase 1, 500 RPS)

Target p99 < 200ms. Budget breakdown:

| Component | Expected | Alarm |
|-----------|---------|-------|
| Network (Railway) | 10ms | > 30ms |
| Agent DB lookup | 15ms | > 50ms |
| Revocation cache (Redis) | 2ms | > 10ms |
| Ed25519 verify | 0.5ms | > 5ms |
| JTI replay (Redis) | 2ms | > 10ms |
| Policy DB lookup | 10ms | > 40ms |
| Spend (Redis INCRBY) | 2ms | > 10ms |
| BATE compute | 1ms | > 10ms |
| Audit write (DB) | 5ms | > 30ms |
| Audit KMS sign | 20ms | > 100ms |
| **Total budget** | **~68ms** | **> 200ms** |

The 200ms p99 SLO has ~3x headroom at expected p99 (~68ms). This absorbs DB jitter and queue depth.

### 7.2 Throughput Limits

| Bottleneck | Limit | Mitigation |
|-----------|-------|-----------|
| Single Railway replica | ~200 RPS | Add replicas |
| PostgreSQL direct connections | 100 connections | PgBouncer |
| Redis single node | ~100K ops/sec | Redis Cluster |
| NestJS event loop | ~1000 concurrent requests | Cluster mode or more replicas |
| Ed25519 verify | ~50K ops/sec per core | Pure CPU — never a bottleneck |

### 7.3 Load Test Procedure

Run before every major scaling event:

```bash
# Phase 1 baseline (run on staging, target production capacity)
k6 run tests/load/verify.js \
  -e BASE_URL=https://staging.api.aegislabs.io/v1 \
  -e API_KEY=$STAGING_KEY \
  --out json=load-test-results.json

# After test: check for
# - p99 < 200ms at 500 RPS ✓
# - error rate < 0.1% ✓
# - no DB connection exhaustion ✓
# - no Redis OOM ✓
# - spend counters accurate (no race conditions) ✓
```

---

## 8. Capacity Planning

### 8.1 Storage Growth

| Table | Growth Rate | 100K verifies/day | 1M verifies/day |
|-------|------------|-------------------|----------------|
| AuditEvent | 1KB/event | 100MB/day → 3GB/month | 1GB/day → 30GB/month |
| SpendRecord | 100B/event | 10MB/day | 100MB/day |
| BateSignal | 50B/signal | 5MB/day | 50MB/day |

At 1M verifies/day, AuditEvent fills 30GB/month. Partition + archive plan is mandatory (see DATABASE_OPERATIONS.md §6.2).

### 8.2 Cost Projections

| Scale | Railway API | Railway DB | Redis | Cloudflare | Total/month |
|-------|------------|-----------|-------|-----------|-------------|
| Phase 1 (500 RPS) | $20-50 | $20 | $10 | $5 | **~$75** |
| Phase 2 (5K RPS) | $100-200 | $50 | $30 | $20 | **~$300** |
| Phase 3 (50K RPS) | $100 (backstop only) | $200 | $100 | $200 | **~$600** |

Phase 3 Cloudflare Workers pricing: $0.50/million requests beyond free tier. At 50K RPS = 4.3B req/month → ~$2,150/month CF cost. Offset by massive Railway savings (edge absorbs 95% of traffic).

---

*Scaling playbook version: 1.0 | AEGIS Phase 1*  
*Next review: when hitting 50% of Phase 1 capacity targets*
