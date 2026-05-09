# AEGIS — Database Operations Guide
## Migrations, Backups, RLS, Partitioning, and AuditEvent Maintenance

> **Owner:** Engineering Lead  
> **Updated:** 2026-05-04  
> **Database:** PostgreSQL 16 on Railway  
> **ORM:** Prisma 5 with connection pooling

---

## 1. Schema Overview

Source of truth: `apps/api/prisma/schema.prisma`

```
Principal (tenant root)
  ├── ApiKey[]               (bcrypt-hashed, per-principal auth)
  ├── AgentIdentity[]        (Ed25519 public key, trust state)
  │    ├── AgentPolicy[]     (many-to-many via pivot)
  │    ├── BateSignal[]      (behavioral signals, 14 types)
  │    ├── TrustScoreHistory[]
  │    └── AgentDelegation[] (hierarchical delegation, max depth 5)
  ├── AgentPolicy[]          (policy definitions)
  ├── AuditEvent[]           (append-only, signed hash chain)
  ├── SpendRecord[]          (daily spend backstop)
  ├── OutboxEvent[]          (transactional outbox for webhooks)
  ├── WebhookSubscription[]
  │    └── WebhookDelivery[]
  ├── RelyingParty[]         (registered relying parties)
  └── PrincipalOnboarding    (activation funnel, one-per-principal)
```

---

## 2. Migration Workflow

### 2.1 Development Workflow

```bash
# Make schema changes in prisma/schema.prisma

# Generate and apply migration locally
pnpm prisma migrate dev --name add_webhook_retry_count
# This: creates migration SQL, applies it, regenerates Prisma client

# Check migration was applied
pnpm prisma migrate status

# If something went wrong: reset (dev only, never production)
pnpm prisma migrate reset
```

### 2.2 Production Migration Workflow

**Never run `prisma migrate dev` against production.** Production uses `migrate deploy`.

```bash
# 1. Create the migration in dev
pnpm prisma migrate dev --name your_migration_name

# 2. Review the generated SQL
cat prisma/migrations/TIMESTAMP_your_migration_name/migration.sql

# 3. Test on staging first
DATABASE_URL=$STAGING_DB_URL pnpm prisma migrate deploy

# 4. Verify on staging
DATABASE_URL=$STAGING_DB_URL pnpm prisma migrate status

# 5. Deploy to production (Railway runs this automatically on deploy)
DATABASE_URL=$PRODUCTION_DB_URL pnpm prisma migrate deploy

# 6. Post-deploy: verify all migrations applied
pnpm prisma migrate status
```

### 2.3 Railway Auto-Migration

`railway.json` is configured to run migrations before app startup:

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "pnpm prisma migrate deploy && node dist/main.js"
  }
}
```

This ensures migrations always run before the new application code starts.

### 2.4 Migration Safety Rules

Before any migration to production:

```
[ ] Migration is additive (adds columns/tables) OR has explicit rollback plan
[ ] No column renamed without aliasing period (Prisma doesn't support rename natively)
[ ] No column dropped without verifying no code references it
[ ] Large table migrations use batched approach (see §2.5)
[ ] RLS policies updated if new table/column is added
[ ] Migration tested on a production-size DB dump (not just dev)
```

**Dangerous patterns — always review with engineering lead:**
- `ALTER TABLE ... ADD COLUMN ... NOT NULL` without default on large table (table lock)
- `CREATE INDEX` without `CONCURRENTLY` on large table (table lock)
- `ALTER TABLE ... DROP COLUMN` (data loss, irreversible)
- Any migration on `AuditEvent` (audit log is sacred)

### 2.5 Large Table Migration Pattern

For tables with >1M rows (eventually: AuditEvent), use batched migrations:

```sql
-- BAD: locks the table
ALTER TABLE "AuditEvent" ADD COLUMN "newColumn" TEXT NOT NULL DEFAULT '';

-- GOOD: three-step safe migration
-- Step 1: Add nullable column (instant)
ALTER TABLE "AuditEvent" ADD COLUMN "newColumn" TEXT;

-- Step 2: Backfill in batches (run as a script, not in migration)
-- scripts/backfill-new-column.ts
-- DO NOT put large backfills in migration SQL

-- Step 3: Add NOT NULL constraint (after backfill complete)
ALTER TABLE "AuditEvent" ALTER COLUMN "newColumn" SET NOT NULL;
```

---

## 3. Row-Level Security (RLS)

RLS is the last line of defense for multi-tenant isolation. Even if application code has a bug that forgets `principalId`, RLS prevents data leakage.

### 3.1 RLS Status Check

```sql
-- Verify RLS is enabled on all core tables
SELECT 
  schemaname, 
  tablename, 
  rowsecurity,
  CASE WHEN rowsecurity THEN '✓' ELSE '✗ MISSING' END as status
FROM pg_tables 
WHERE schemaname = 'public'
  AND tablename IN (
    'AgentIdentity', 'AgentPolicy', 'AuditEvent', 
    'BateSignal', 'SpendRecord', 'WebhookSubscription',
    'WebhookDelivery', 'TrustScoreHistory', 'RelyingParty'
  )
ORDER BY tablename;

-- Expected: rowsecurity = true for ALL rows
```

### 3.2 RLS Policy Pattern

```sql
-- Example: AuditEvent RLS policy
CREATE POLICY audit_event_principal_isolation ON "AuditEvent"
  USING ("principalId" = current_setting('app.principal_id', true)::uuid);

-- The application sets this before every query:
-- SET LOCAL app.principal_id = '<principalId>';
-- This is handled in PrismaService.$use() middleware
```

### 3.3 Verifying Isolation

```sql
-- Test: as principalA, can we see principalB's data?
SET LOCAL app.principal_id = '<principal_a_id>';
SELECT COUNT(*) FROM "AuditEvent" WHERE "principalId" = '<principal_b_id>';
-- Expected: 0 (RLS blocks it)

SET LOCAL app.principal_id = '<principal_a_id>';
SELECT COUNT(*) FROM "AuditEvent"; -- no WHERE clause
-- Expected: only principal A's rows (RLS auto-filters)
```

### 3.4 RLS Bypass (Admin Only)

The admin operations role bypasses RLS for maintenance operations:

```sql
-- Admin connection bypasses RLS (uses different role)
SET ROLE aegis_admin;
SELECT COUNT(*) FROM "AuditEvent"; -- sees all rows
RESET ROLE; -- always reset after admin operations
```

---

## 4. Backup and Restore

### 4.1 Railway Automated Backups

Configure before first user traffic:

1. Railway Dashboard → PostgreSQL service → Settings → Backups
2. Enable: Daily automated backups
3. Retention: 30 days (minimum 7 days)
4. Verify: backup job ran last night

### 4.2 Manual Backup

```bash
# Full database dump
pg_dump $DATABASE_URL \
  --format=custom \
  --compress=9 \
  --file="aegis-backup-$(date +%Y%m%d-%H%M).dump"

# Schema only
pg_dump $DATABASE_URL \
  --schema-only \
  --file="aegis-schema-$(date +%Y%m%d).sql"

# Specific table
pg_dump $DATABASE_URL \
  --table="AuditEvent" \
  --format=custom \
  --file="audit-events-$(date +%Y%m%d).dump"
```

### 4.3 Restore Procedure

```bash
# 1. Create a fresh database (DO NOT restore over production directly)
createdb aegis_restored

# 2. Restore from dump
pg_restore \
  --dbname aegis_restored \
  --verbose \
  --exit-on-error \
  aegis-backup-20260504-1200.dump

# 3. Verify restore
psql aegis_restored -c "
  SELECT 
    (SELECT COUNT(*) FROM \"Principal\") as principals,
    (SELECT COUNT(*) FROM \"AgentIdentity\") as agents,
    (SELECT COUNT(*) FROM \"AuditEvent\") as audit_events,
    (SELECT MAX(\"createdAt\") FROM \"AuditEvent\") as last_event;
"

# 4. Run audit chain verification on restored DB
DATABASE_URL=postgresql://localhost/aegis_restored \
  pnpm tsx scripts/audit-verify-chain.ts --limit 1000

# 5. If restore is valid, switch DATABASE_URL in Railway
# This causes a brief outage (< 30s connection reset)
```

### 4.4 Point-in-Time Recovery Target

- **RTO** (Recovery Time Objective): 4 hours
- **RPO** (Recovery Point Objective): 1 hour
- **Backup window**: Daily at 02:00 UTC (lowest traffic)
- **Last tested**: [RECORD DATE OF LAST DR TEST]

---

## 5. Connection Pooling

### 5.1 Prisma Connection Pool

```
# .env.production
DATABASE_URL="postgresql://user:pass@host:5432/aegis?connection_limit=10&pool_timeout=20"
```

Configuration table:

| Env | connection_limit | pool_timeout | Notes |
|-----|-----------------|--------------|-------|
| Development | 5 | 10s | Single developer |
| CI | 5 | 10s | Parallel test jobs each get 5 |
| Staging | 10 | 20s | Moderate load |
| Production (Phase 1) | 20 | 30s | Railway Pro: 1-2 replicas |
| Production (Phase 2+) | See PgBouncer | — | External pool at high traffic |

### 5.2 PgBouncer (Phase 2+)

At >100 RPS sustained, Prisma's built-in pool hits PostgreSQL's max_connections limit. Add PgBouncer:

```
DATABASE_URL="postgresql://user:pass@pgbouncer-host:6432/aegis?pgbouncer=true"
DIRECT_DATABASE_URL="postgresql://user:pass@postgres-host:5432/aegis"
# DIRECT_DATABASE_URL is used for migrations only (pooled connections break Prisma migrate)
```

PgBouncer configuration:
```ini
[databases]
aegis = host=postgres-host port=5432 dbname=aegis

[pgbouncer]
pool_mode = transaction  ; Required for Prisma
max_client_conn = 1000
default_pool_size = 20
reserve_pool_size = 5
reserve_pool_timeout = 3
```

### 5.3 Monitoring Connection Pool

```bash
# Current pool state
psql $DATABASE_URL -c "
  SELECT count(*), state 
  FROM pg_stat_activity 
  WHERE datname = 'aegis' 
  GROUP BY state;
"

# Long-running queries (investigate anything > 5s)
psql $DATABASE_URL -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
  FROM pg_stat_activity
  WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
    AND state != 'idle';
"
```

---

## 6. AuditEvent Table Operations

`AuditEvent` is the most critical table. It's append-only, signed, and grows without bound. It needs special care.

### 6.1 Index Strategy

```sql
-- Current indexes (from migration 0003_audit_chain)
CREATE INDEX idx_audit_principal_created ON "AuditEvent"("principalId", "createdAt" DESC);
CREATE INDEX idx_audit_agent_created ON "AuditEvent"("agentId", "createdAt" DESC);
CREATE INDEX idx_audit_chain ON "AuditEvent"("prevEventId"); -- for chain traversal

-- At >10M rows, add these:
CREATE INDEX CONCURRENTLY idx_audit_outcome ON "AuditEvent"(outcome, "createdAt" DESC);
CREATE INDEX CONCURRENTLY idx_audit_denial ON "AuditEvent"("denialReason", "createdAt" DESC) 
  WHERE "denialReason" IS NOT NULL;
```

### 6.2 Partitioning Plan

AuditEvent must be partitioned before it exceeds 100M rows (~6-12 months at scale).

**Partition strategy:** Monthly range partitioning on `createdAt`.

```sql
-- Migration to add partitioning (run when table approaches 50M rows)
-- Step 1: Rename existing table
ALTER TABLE "AuditEvent" RENAME TO "AuditEvent_old";

-- Step 2: Create partitioned table
CREATE TABLE "AuditEvent" (
  -- same columns as before
  -- ... 
  "createdAt" TIMESTAMP NOT NULL
) PARTITION BY RANGE ("createdAt");

-- Step 3: Create initial partitions
CREATE TABLE "AuditEvent_2026_05" PARTITION OF "AuditEvent"
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE "AuditEvent_2026_06" PARTITION OF "AuditEvent"
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Step 4: Migrate data (use pg_partman for online migration)
-- Step 5: Create pg_partman extension for auto-partition creation
```

Automate new partition creation with a monthly cron job:

```sql
-- Run at start of each month via scheduled job
SELECT partman.create_partition_time('public.AuditEvent', 1, p_premake := 3);
```

### 6.3 Retention Policy

Per `docs/RETENTION_POLICY.md` §8:

| Tier | Age | Storage | Queryable |
|------|-----|---------|----------|
| Hot | 0-90 days | PostgreSQL primary | Yes, full performance |
| Warm | 90-365 days | PostgreSQL read replica | Yes, slower |
| Cold | 1-7 years | S3/GCS (Parquet) | Via Athena/BigQuery |
| Purge | >7 years | Deleted | No |

GDPR Art.17 erasure: use `*Hash` columns. Never delete AuditEvent rows — hash the identifying fields instead:

```sql
-- GDPR erasure: hash the identifying fields
UPDATE "AuditEvent" 
SET 
  "agentIdHash" = encode(sha256("agentId"::bytea || 'salt'::bytea), 'hex'),
  "agentId" = '[ERASED]'
WHERE "principalId" = $1;

-- The chain remains intact because *Hash columns are included in the signature
-- The original agentId is gone, but the event is preserved
```

### 6.4 Archive Script

```bash
# Monthly: archive events older than 90 days to S3
pnpm tsx scripts/archive-audit-events.ts \
  --older-than 90 \
  --destination s3://aegis-audit-archive/$(date +%Y/%m)/ \
  --format parquet \
  --delete-after-archive  # requires explicit flag

# Verify archive integrity before deleting
pnpm tsx scripts/verify-audit-archive.ts \
  --path s3://aegis-audit-archive/2026/02/
```

---

## 7. Query Optimization

### 7.1 Common Query Patterns and Their Indexes

```sql
-- Verify flow: agent lookup (most frequent query in the system)
-- Uses: idx_agent_principal (agentId, principalId, status)
SELECT * FROM "AgentIdentity" 
WHERE id = $agentId AND "principalId" = $principalId AND status = 'ACTIVE';

-- Audit tail: recent events for agent
-- Uses: idx_audit_agent_created
SELECT * FROM "AuditEvent" 
WHERE "agentId" = $agentId 
ORDER BY "createdAt" DESC 
LIMIT 20;

-- BATE signals: recent signals for scoring
-- Uses: idx_bate_agent_window (agentId, createdAt)
SELECT type, SUM(count), MIN("createdAt"), MAX("createdAt")
FROM "BateSignal"
WHERE "agentId" = $agentId 
  AND "createdAt" > NOW() - INTERVAL '30 days'
GROUP BY type;
```

### 7.2 Query Performance Monitoring

```sql
-- Enable pg_stat_statements (one-time setup)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top slow queries (run weekly)
SELECT 
  LEFT(query, 100) as query_preview,
  calls,
  mean_exec_time,
  total_exec_time,
  rows / calls as avg_rows
FROM pg_stat_statements
WHERE calls > 100
  AND mean_exec_time > 10  -- queries averaging > 10ms
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Reset stats after optimizing
SELECT pg_stat_statements_reset();
```

### 7.3 EXPLAIN ANALYZE Pattern

Before adding any index, verify it's needed:

```sql
-- Check if query is using indexes
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM "AuditEvent" 
WHERE "principalId" = 'prin_abc123' 
  AND "createdAt" > NOW() - INTERVAL '7 days'
ORDER BY "createdAt" DESC 
LIMIT 100;

-- Look for:
-- "Seq Scan" on large tables → add index
-- "Bitmap Heap Scan" with high cost → may need covering index
-- "Index Scan" with low cost → already optimal
```

---

## 8. Database Maintenance

### 8.1 Vacuum Schedule

PostgreSQL auto-vacuum handles most cases, but after bulk inserts:

```sql
-- Check table bloat
SELECT 
  schemaname, tablename,
  n_dead_tup, n_live_tup,
  ROUND(100 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0)) as dead_pct,
  last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;

-- Manual vacuum if dead tuples are high
VACUUM ANALYZE "AuditEvent";
```

### 8.2 Table Size Monitoring

```sql
-- Table sizes (run monthly)
SELECT 
  schemaname, tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as index_size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### 8.3 Alert Thresholds

| Condition | Threshold | Action |
|-----------|-----------|--------|
| DB storage > 80% | Immediate | Upgrade Railway plan or archive AuditEvent |
| AuditEvent > 50M rows | Planned | Begin partitioning migration |
| Dead tuple % > 20% | Scheduled | Manual VACUUM |
| Index bloat > 30% | Scheduled | REINDEX CONCURRENTLY |
| Connection pool > 80% | Immediate | See §5 connection pooling |

---

## 9. Disaster Recovery Procedures

### 9.1 Full DR Runbook

**Scenario: Production database is unrecoverable.**

Time budget: RTO = 4 hours

```
00:00 - 00:15  Confirm DB is unrecoverable (not just a transient error)
               Try: psql $DATABASE_URL -c "SELECT 1;"
               Contact Railway support if instance shows as running

00:15 - 00:30  Declare incident in #incidents
               Put API in maintenance mode (AEGIS_MAINTENANCE_MODE=true)
               This prevents writes to a partially-broken DB

00:30 - 01:00  Provision new PostgreSQL instance on Railway
               Select most recent backup for restore

01:00 - 02:00  Restore from backup
               Run: pg_restore (see §4.3)
               Time for 50GB DB: ~45 minutes on high-tier instance

02:00 - 02:30  Verify restore integrity:
               - Row counts match expectations
               - Audit chain passes verification
               - pnpm prisma migrate status → all applied

02:30 - 03:00  Update DATABASE_URL in Railway API variables
               This triggers a redeploy automatically
               Verify /ready endpoint returns {"db":"ok"}

03:00 - 03:30  Smoke test:
               - Register a test agent
               - Make a verify call
               - Check audit log was written

03:30 - 04:00  Remove maintenance mode
               AEGIS_MAINTENANCE_MODE=false → redeploy
               Monitor error rate for 30 minutes

04:00          Incident resolved
               Begin post-mortem
```

### 9.2 Data Loss Assessment

After restore, calculate data loss window:

```bash
# Latest event in restored DB
psql $RESTORED_DB_URL -c "
  SELECT MAX(\"createdAt\") as last_event FROM \"AuditEvent\";
"

# Data loss = current time - last_event
# Notify principals whose verify calls fall in the data loss window
aegis admin data-loss-report \
  --from $(date -d "yesterday 02:00" +%Y-%m-%dT%H:%M:%S) \
  --to $(date +%Y-%m-%dT%H:%M:%S) \
  --notify-principals
```

---

## 10. Operational Queries Reference

These queries are safe to run in production (reads only):

```sql
-- Principal summary
SELECT id, email, "createdAt", 
  (SELECT COUNT(*) FROM "AgentIdentity" WHERE "principalId" = p.id) as agent_count,
  (SELECT COUNT(*) FROM "AuditEvent" WHERE "principalId" = p.id) as audit_count
FROM "Principal" p
WHERE email = $email;

-- Agent trust state
SELECT id, name, status, "trustScore", "trustBand", "lastVerifiedAt"
FROM "AgentIdentity"
WHERE "principalId" = $principalId
ORDER BY "lastVerifiedAt" DESC;

-- Recent denials for an agent
SELECT "createdAt", "denialReason", action, "relyingPartyId"
FROM "AuditEvent"
WHERE "agentId" = $agentId
  AND outcome = 'DENIED'
ORDER BY "createdAt" DESC
LIMIT 20;

-- Spend this month for an agent
SELECT SUM(amount) as total_spent, currency
FROM "SpendRecord"
WHERE "agentId" = $agentId
  AND "windowStart" >= DATE_TRUNC('month', NOW())
GROUP BY currency;

-- Onboarding status
SELECT * FROM "PrincipalOnboarding" WHERE "principalId" = $principalId;

-- Webhook delivery health
SELECT status, COUNT(*), AVG("latencyMs")
FROM "WebhookDelivery"
WHERE "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

---

*Database operations guide version: 1.0 | AEGIS Phase 1*  
*Next review: before AuditEvent hits 10M rows*
