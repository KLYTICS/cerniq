# AEGIS — Production Go-Live Checklist
## Gate Criteria Before Accepting First Real User Traffic

> **Owner:** Engineering Lead + Operator (Erwin)  
> **Frequency:** Run once before public beta. Re-run before each major milestone (Phase 2, Phase 3).  
> **Format:** Each item is binary PASS/FAIL. Defer GA until all P0 items pass.

---

## Priority Legend

- 🔴 **P0** — Hard blocker. Do not go live with any failure here.
- 🟠 **P1** — Strong recommendation. Acceptable risk only with documented mitigation.
- 🟡 **P2** — Best practice. Ship, but track as tech debt.

---

## Section 1 — Security

### 1.1 Cryptography

```
[ ] 🔴 Production Ed25519 keys generated via scripts/generate-aegis-keys.ts
        Keys are NOT the development defaults
        Keys stored in Railway Variables or a secrets manager
        Private keys have NEVER appeared in git history
        
[ ] 🔴 JWT signing key and audit signing key are SEPARATE
        Different keys for different purposes (rotation independence)
        
[ ] 🔴 AEGIS_API_KEY_BCRYPT_COST=12 in production
        (cost=4 is only acceptable in test/CI)
        Verify: grep BCRYPT_COST .env.production
        
[ ] 🔴 AEGIS_ADMIN_TOKEN is a randomly generated 32-byte hex string
        NOT a human-readable password
        NOT committed to git
        Verify: echo $AEGIS_ADMIN_TOKEN | wc -c   # should be 65 (64 hex + newline)
        
[ ] 🟠 Private keys are NOT logged anywhere
        Search: grep -r "privateKey" apps/api/src --include="*.ts" | grep -v "spec\|test"
        Verify no private key appears in Datadog/Railway logs
        
[ ] 🟠 Audit signing key rotation plan documented
        See docs/SECURITY_RUNBOOK.md §Key Rotation
        First rotation date scheduled within 90 days of GA
```

### 1.2 Transport Security

```
[ ] 🔴 HTTPS enforced on all endpoints (no HTTP fallback)
        Cloudflare SSL mode: Full (strict)
        Railway: custom domain with valid TLS cert
        
[ ] 🔴 HSTS header present on all responses
        Verify: curl -I https://api.aegislabs.io/health | grep strict-transport
        Expected: strict-transport-security: max-age=31536000; includeSubDomains
        
[ ] 🟠 CSP header on dashboard
        Verify: curl -I https://dashboard.aegislabs.io | grep content-security-policy
        
[ ] 🟠 CORS allowlist is explicit (not *)
        Check: apps/api/src/common/security/cors-allowlist.ts
        Production should list specific origins, not '*'
```

### 1.3 Rate Limiting

```
[ ] 🔴 Throttler configured for FREE tier verify
        Check: AEGIS_VERIFY_RATE_LIMIT_FREE=10 (req/sec, burst 20)
        See: apps/api/src/modules/verify/verify.module.ts @nestjs/throttler config
        
[ ] 🟠 Identity endpoints rate-limited (prevent agent spam registration)
        Check: POST /v1/agents has per-IP rate limit
        
[ ] 🟠 Auth endpoint rate-limited (prevent API key brute-force)
        Check: POST /v1/auth/api-keys has per-IP rate limit
```

### 1.4 Multi-Tenant Isolation

```
[ ] 🔴 RLS migrations applied and verified
        Run: SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';
        All core tables should show rowsecurity=true
        
[ ] 🔴 Multi-tenant isolation test passes
        Run: pnpm jest apps/api/src/__multi_tenant__/
        All isolation tests must be green
        
[ ] 🔴 No cross-principal data leakage verified in E2E
        Run: pnpm vitest run tests/e2e/
        Verify: no test accesses another principal's data
```

---

## Section 2 — Infrastructure

### 2.1 Database

```
[ ] 🔴 All 6 Prisma migrations applied
        Run: pnpm prisma migrate status
        All migrations show ✓ (applied)
        
[ ] 🔴 Database backups enabled
        Railway: enable daily automated backups
        Retention: 7 days minimum (30 days recommended)
        Test restore: restore to a staging DB and verify chain integrity
        
[ ] 🟠 Database on dedicated instance (not shared free tier)
        Production: Railway PostgreSQL Pro ($20+/month)
        
[ ] 🟠 Connection pooling configured
        PgBouncer OR Prisma connection pool max set appropriately
        DATABASE_URL has connection_limit param if using PgBouncer
        
[ ] 🟠 AuditEvent table partitioning plan documented
        Monthly partitioning required before >100M audit rows
        See: docs/RETENTION_POLICY.md §8
        
[ ] 🟡 Read replica provisioned for audit export queries
        Prevents export queries from impacting write path latency
```

### 2.2 Redis

```
[ ] 🔴 Redis maxmemory-policy=allkeys-lru set
        Verify: redis-cli -u $REDIS_URL CONFIG GET maxmemory-policy
        
[ ] 🔴 Redis persistence enabled (AOF or RDB)
        Spend counters are correctness-critical — must survive restart
        Verify: redis-cli -u $REDIS_URL CONFIG GET appendonly
        
[ ] 🟠 Redis memory limit set appropriately
        1 GB minimum for starter; 8 GB for production
        Monitor: redis-cli INFO memory | grep used_memory_human
        
[ ] 🟠 Redis on dedicated instance (not shared free tier)
        Production: Railway Redis Pro or Upstash Pro
```

### 2.3 Application

```
[ ] 🔴 Health endpoint responds < 500ms
        curl -w "%{time_total}" https://api.aegislabs.io/health
        
[ ] 🔴 Readiness endpoint passes (DB + Redis ping)
        curl https://api.aegislabs.io/ready -H "X-AEGIS-Admin: $AEGIS_ADMIN_TOKEN"
        Expected: { "status": "ready", "db": "ok", "redis": "ok" }
        
[ ] 🔴 Verify endpoint responds correctly to valid token
        Run: pnpm vitest run tests/e2e/06_verify_happy
        
[ ] 🔴 All 9 denial reasons return correct HTTP status codes
        Run: pnpm vitest run tests/e2e/07_verify_denials
        
[ ] 🟠 Minimum 2 Railway instances (for HA)
        Single instance is SPOF — use 2+ with Railway Pro
        
[ ] 🟠 Auto-scaling configured
        Railway Pro: set min=2, max=10 replicas
        Scale trigger: CPU >70% for 3 minutes
```

---

## Section 3 — Cryptographic Correctness

### 3.1 Audit Chain

```
[ ] 🔴 Audit chain integrity script passes on empty chain
        Run: pnpm tsx scripts/audit-verify-chain.ts \
             --api-base $BASE --api-key $AEGIS_API_KEY --limit 10
        Expected: ✓ Chain intact (0 events or N events, 0 breaks)
        
[ ] 🔴 Hash chain links correctly after first verify call
        1. Make 5 verify calls (any result)
        2. Run: pnpm tsx scripts/audit-verify-chain.ts --limit 5
        Expected: ✓ 5 events verified, 0 chain breaks
        
[ ] 🔴 Tamper detection works
        Mutate one audit row directly in DB: UPDATE "AuditEvent" SET action='tampered' WHERE id='...';
        Run: pnpm tsx scripts/audit-verify-chain.ts --limit 5
        Expected: ✗ Chain break detected at event #N
        
[ ] 🟠 /.well-known/audit-signing-key returns correct JWKS
        curl https://api.aegislabs.io/.well-known/audit-signing-key
        Verify: kid matches signingKeyId in latest AuditEvent row
        NOTE: This endpoint is still open (G-1) — block GA until shipped
```

### 3.2 JWT Signing

```
[ ] 🔴 JWT tokens signed by AEGIS are EdDSA only (no RSA, no HS256)
        Inspect a policy JWT: cat policy.signedToken | cut -d. -f1 | base64 -d
        Expected: { "alg": "EdDSA", ... }
        
[ ] 🔴 JTI replay protection works
        Run: pnpm vitest run tests/e2e/08_replay_protection
        
[ ] 🔴 Token expiry enforced (30-second default)
        Create token with ttlSeconds=1, wait 2s, verify
        Expected: denialReason: INVALID_SIGNATURE
```

---

## Section 4 — Spend Correctness

```
[ ] 🔴 Spend counter race condition test passes (TOCTOU)
        Run: pnpm vitest run tests/e2e/09_spend_race
        Concurrent spend requests must not collectively exceed limit
        
[ ] 🔴 Spend counter is atomic (Redis INCRBY, not GET+SET)
        Verify: apps/api/src/modules/verify/spend-guard.service.ts
        Must use INCRBY + EXPIRE in Lua script, not separate operations
        
[ ] 🔴 Spend fails closed on Redis unavailability
        Simulate Redis down (stop Redis, make verify call with amount)
        Expected: denialReason: ANOMALY_FLAGGED (503, not approval)
        
[ ] 🟠 Daily spend resets at midnight UTC
        Verify: spend counter dateKey format is YYYY-MM-DD (UTC)
        
[ ] 🟠 Postgres backstop spend records written
        After 10 verify calls with amounts, check SpendRecord table
        SELECT COUNT(*) FROM "SpendRecord" WHERE "agentId"='...';
```

---

## Section 5 — Functional Completeness

### 5.1 Core Flows

```
[ ] 🔴 Full happy path E2E passes
        pnpm vitest run tests/e2e/06_verify_happy
        
[ ] 🔴 All 9 denial reasons tested
        pnpm vitest run tests/e2e/07_verify_denials
        
[ ] 🔴 Revocation propagates within 30 seconds
        pnpm vitest run tests/e2e/13_revocation_propagation
        
[ ] 🔴 Rate limiting works on FREE tier
        pnpm vitest run tests/e2e/14_rate_limit
        
[ ] 🔴 Idempotency on verify calls
        pnpm vitest run tests/e2e/15_idempotency
```

### 5.2 Blocking Feature Gaps

```
[ ] 🔴 /.well-known/audit-signing-key endpoint shipped (G-1)
        This is a hard P0 for enterprise customers
        
[ ] 🔴 Stripe billing wired (G-2) OR Free tier enforced at verify level
        If billing not shipped: ensure FREE tier rate limits are in place
        and no paid features are accidentally exposed
        
[ ] 🟠 Webhook subscription endpoints shipped (G-4)
        Without this, customers can't receive revocation events
        
[ ] 🟠 BATE anomaly detector wired to BateService worker (G-3)
        Detector exists; wiring is 10 lines
```

---

## Section 6 — Observability

```
[ ] 🔴 /health endpoint has no auth, always returns 200 (never blocks)
        curl https://api.aegislabs.io/health   # no API key
        
[ ] 🔴 /metrics endpoint returns valid Prometheus text
        curl https://api.aegislabs.io/metrics -H "Authorization: Bearer $METRICS_TOKEN"
        Expected: aegis_verify_total, aegis_verify_latency_seconds, etc.
        
[ ] 🟠 OTel tracing enabled and traces appearing in your collector
        AEGIS_OTEL_ENABLED=true
        Verify traces in Jaeger/Tempo/DataDog
        
[ ] 🟠 Railway + Cloudflare alerts configured
        See docs/MONITORING_OBSERVABILITY.md for full alert list
        Minimum: verify p99 > 200ms, error rate > 1%, Redis down
        
[ ] 🟠 Audit chain integrity CI workflow scheduled
        .github/workflows/audit-chain-integrity.yml runs on cron
        Slack webhook configured: SLACK_INCIDENT_WEBHOOK in GitHub Secrets
        
[ ] 🟡 Structured logging (Pino JSON) with request correlation IDs
        Verify: railway logs | head -5 | python3 -m json.tool
        Each log line should be valid JSON with traceId field
```

---

## Section 7 — Runbooks & Documentation

```
[ ] 🔴 INCIDENT_RESPONSE.md signed off by engineering lead
        Every on-call engineer has read it
        
[ ] 🔴 SECURITY_RUNBOOK.md signed off
        Key rotation procedure tested in staging
        
[ ] 🟠 RUNBOOK.md covers all P1 scenarios
        DB failover, Redis failover, CF Worker rollback, hot key rotation
        
[ ] 🟠 DR_RUNBOOK.md includes tested restore procedure
        RTO target: 4 hours. RPO target: 1 hour.
        Last DR test date recorded.
        
[ ] 🟡 Status page configured (aegisstatus.io or internal)
        OD-007 decision required for hosting choice
```

---

## Section 8 — Legal & Compliance

```
[ ] 🔴 Privacy policy published (aegislabs.io/privacy)
        References agent data handling, audit log retention
        
[ ] 🔴 Terms of service published (aegislabs.io/terms)
        Includes acceptable use for agent operations
        
[ ] 🟠 DPA template ready for EU enterprise customers
        GDPR Art. 28 template with AEGIS as data processor
        References audit redaction capability (ADR-0006)
        
[ ] 🟠 7-year audit retention policy documented (OD-004)
        Cold storage plan configured (S3/GCS archive)
        
[ ] 🟡 Cookie consent banner on dashboard
        AEGIS_ANALYTICS_CONSENT=required in EU
```

---

## Section 9 — Load Testing

```
[ ] 🟠 Load test passes target SLO (p99 < 200ms at 500 RPS)
        Run: k6 run tests/load/verify.js \
             -e BASE_URL=https://api.aegislabs.io/v1 \
             -e API_KEY=$AEGIS_API_KEY
        Expected: p99 < 200ms, error rate < 0.1%
        
[ ] 🟠 Spend race test passes under load
        Run concurrent spend-limit-at-boundary requests
        Verify no over-spend allowed
        
[ ] 🟡 CF Worker edge cache hit rate >80% under steady traffic
        Verify via Cloudflare Analytics → Workers → KV reads
```

---

## Sign-Off

```
Engineering Lead:     _________________    Date: ___________
Operator (Erwin):     _________________    Date: ___________
Security Review:      _________________    Date: ___________

P0 items all PASS:    [ ] YES  [ ] NO (do not go live)
P1 items PASS or 
 have documented 
 mitigation:          [ ] YES  [ ] NO
Notes:
______________________________________________________________
______________________________________________________________
```

---

*Template version: 1.0 | AEGIS Phase 1 GA*  
*Next review: before Phase 2 launch ($500 MRR gate)*
