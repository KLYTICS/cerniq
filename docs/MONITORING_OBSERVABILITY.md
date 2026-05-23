# OKORO — Monitoring & Observability

## OTel Spans, Prometheus Metrics, Alerting Rules, and Dashboards

> **Owner:** Engineering Lead  
> **Updated:** 2026-05-04  
> **Stack:** OpenTelemetry → Grafana/Datadog | Prometheus metrics | Pino JSON logging | Railway + Cloudflare

---

## 1. Observability Pillars

OKORO uses the three pillars. Each serves a different diagnostic need:

| Pillar      | Tool                               | What It Answers                                           |
| ----------- | ---------------------------------- | --------------------------------------------------------- |
| **Metrics** | Prometheus + Grafana               | "Is the system healthy right now?" (rate, error, latency) |
| **Traces**  | OpenTelemetry (Jaeger/Datadog APM) | "Where did this specific request spend its time?"         |
| **Logs**    | Pino JSON → Railway/Datadog        | "What happened in detail for this request?"               |

---

## 2. Metrics Reference

### 2.1 Verify Metrics (Core SLOs)

These are the metrics that matter most. Every on-call engineer must know them.

| Metric                           | Type      | Labels                                             | Description                                             |
| -------------------------------- | --------- | -------------------------------------------------- | ------------------------------------------------------- |
| `okoro_verify_total`             | Counter   | `outcome` (approved/denied/error), `denial_reason` | All verify calls                                        |
| `okoro_verify_duration_seconds`  | Histogram | `outcome`                                          | Verify latency — check p50/p95/p99                      |
| `okoro_verify_token_age_seconds` | Histogram | —                                                  | How old are tokens when presented (monitors clock skew) |
| `okoro_verify_spend_amount`      | Histogram | `currency`                                         | Distribution of spend amounts                           |

**SLO targets:**

- `okoro_verify_duration_seconds{quantile="0.99"}` < 200ms
- `okoro_verify_total{outcome="error"}` rate < 0.1%
- `okoro_verify_total{outcome="approved"}` / total > 85% (healthy traffic baseline)

### 2.2 Identity Metrics

| Metric                               | Type      | Labels       | Description                    |
| ------------------------------------ | --------- | ------------ | ------------------------------ |
| `okoro_agents_registered_total`      | Counter   | —            | Cumulative agent registrations |
| `okoro_agents_active`                | Gauge     | —            | Active (non-revoked) agents    |
| `okoro_agents_revoked_total`         | Counter   | `reason`     | Revocations by reason          |
| `okoro_trust_score`                  | Histogram | `band`       | Distribution of trust scores   |
| `okoro_trust_band_transitions_total` | Counter   | `from`, `to` | Band promotions/demotions      |

### 2.3 BATE Metrics

| Metric                                 | Type      | Labels                                                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | --------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `okoro_bate_signals_total`             | Counter   | `type`                                                        | Signals received by type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `okoro_bate_anomaly_triggers_total`    | Counter   | `rule` (R-1..R-5)                                             | Anomaly rule firings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `okoro_bate_anomaly_trigger_total`     | Counter   | `rule` (low cardinality, values `detector.r1`..`detector.r5`) | Count of BATE behavioral anomaly detector rule triggers, partitioned by rule. Increments inside `BateService.recompute` when `BateAnomalyDetector.detect()` emits a signal. Use to detect rules with abnormal trigger rates (sudden jump = either an attacker pattern or a tuning regression). Source: `apps/api/src/common/observability/metrics.service.ts`, `apps/api/src/modules/bate/bate.worker.ts`. Suggested alert: `rate(okoro_bate_anomaly_trigger_total{rule="detector.r3"}[5m]) > 0.5` (geographic-inconsistency rule firing >0.5/sec sustained = likely tenant compromise). |
| `okoro_bate_score_computation_seconds` | Histogram | —                                                             | BATE scoring latency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### 2.4 Audit Metrics

| Metric                                | Type      | Labels                       | Description                                   |
| ------------------------------------- | --------- | ---------------------------- | --------------------------------------------- |
| `okoro_audit_events_total`            | Counter   | `outcome`, `denial_reason`   | Audit events written                          |
| `okoro_audit_chain_breaks_total`      | Counter   | —                            | Chain integrity failures (should be 0 always) |
| `okoro_audit_signing_latency_seconds` | Histogram | `signer` (kms/env/ephemeral) | KMS vs env var signing latency                |

### 2.5 Infrastructure Metrics

| Metric                            | Type      | Labels                     | Description                 |
| --------------------------------- | --------- | -------------------------- | --------------------------- |
| `okoro_db_query_duration_seconds` | Histogram | `operation`                | Prisma query latency        |
| `okoro_db_pool_connections`       | Gauge     | `state` (active/idle)      | Connection pool utilization |
| `okoro_redis_operations_total`    | Counter   | `operation`, `status`      | Redis command count         |
| `okoro_redis_latency_seconds`     | Histogram | `operation`                | Redis operation latency     |
| `okoro_http_requests_total`       | Counter   | `method`, `path`, `status` | HTTP request count          |
| `okoro_http_duration_seconds`     | Histogram | `method`, `path`           | HTTP latency by endpoint    |

### 2.6 Business Metrics

| Metric                           | Type    | Labels                                 | Description                   |
| -------------------------------- | ------- | -------------------------------------- | ----------------------------- |
| `okoro_principals_total`         | Gauge   | `tier` (free/developer/pro/enterprise) | Active principals by plan     |
| `okoro_onboarding_step_total`    | Counter | `step`                                 | Onboarding funnel progression |
| `okoro_webhook_deliveries_total` | Counter | `status` (success/failed/retrying)     | Webhook delivery health       |

---

## 3. Prometheus Configuration

### 3.1 Scrape Config

```yaml
# prometheus.yml (or Grafana Agent config)

scrape_configs:
  - job_name: 'okoro-api'
    metrics_path: '/metrics'
    bearer_token: '${METRICS_TOKEN}'
    static_configs:
      - targets: ['api.okoroapp.com']
    scrape_interval: 15s
    scrape_timeout: 10s
```

### 3.2 Metrics Endpoint

```bash
# Verify metrics endpoint is working
curl https://api.okoroapp.com/metrics \
  -H "Authorization: Bearer $METRICS_TOKEN"

# Expected: Prometheus text format
# okoro_verify_total{outcome="approved"} 12453
# okoro_verify_total{outcome="denied",denial_reason="SPEND_LIMIT_EXCEEDED"} 234
# okoro_verify_duration_seconds_bucket{le="0.05"} 11200
# ...
```

### 3.3 Recording Rules (Prometheus)

Pre-compute expensive queries for dashboards:

```yaml
# okoro-recording-rules.yml

groups:
  - name: okoro.verify
    interval: 30s
    rules:
      - record: okoro:verify_error_rate:5m
        expr: |
          rate(okoro_verify_total{outcome="error"}[5m])
          /
          rate(okoro_verify_total[5m])

      - record: okoro:verify_approval_rate:5m
        expr: |
          rate(okoro_verify_total{outcome="approved"}[5m])
          /
          rate(okoro_verify_total[5m])

      - record: okoro:verify_p99:5m
        expr: |
          histogram_quantile(0.99, 
            rate(okoro_verify_duration_seconds_bucket[5m])
          )

      - record: okoro:verify_p50:5m
        expr: |
          histogram_quantile(0.50, 
            rate(okoro_verify_duration_seconds_bucket[5m])
          )
```

---

## 4. Alerting Rules

### 4.1 P0 Alerts (Page Immediately)

```yaml
# okoro-alerts.yml

groups:
  - name: okoro.p0
    rules:
      - alert: OkoroApiDown
        expr: up{job="okoro-api"} == 0
        for: 1m
        labels:
          severity: critical
          runbook: RB-001
        annotations:
          summary: 'OKORO API is down'
          description: 'Health endpoint not responding for 1 minute.'

      - alert: OkoroVerifyErrorRate
        expr: okoro:verify_error_rate:5m > 0.01
        for: 5m
        labels:
          severity: critical
          runbook: RB-102
        annotations:
          summary: 'Verify error rate > 1%'
          description: '{{ $value | humanizePercentage }} of verify calls are erroring.'

      - alert: OkoroAuditChainBreak
        expr: increase(okoro_audit_chain_breaks_total[5m]) > 0
        labels:
          severity: critical
          runbook: RB-003
        annotations:
          summary: 'Audit chain integrity break detected'
          description: 'THIS IS A P0 SECURITY INCIDENT.'

      - alert: OkoroRedisDown
        expr: |
          rate(okoro_redis_operations_total{status="error"}[1m]) 
          / rate(okoro_redis_operations_total[1m]) > 0.9
        for: 1m
        labels:
          severity: critical
          runbook: RB-001
        annotations:
          summary: 'Redis is unreachable'
          description: 'Spend counters and JTI replay cache non-functional.'
```

### 4.2 P1 Alerts (Page Within 15 Min)

```yaml
- name: okoro.p1
  rules:
    - alert: OkoroVerifyLatencyHigh
      expr: okoro:verify_p99:5m > 0.5
      for: 5m
      labels:
        severity: high
        runbook: RB-101
      annotations:
        summary: 'Verify p99 latency > 500ms'
        description: 'Current p99: {{ $value | humanizeDuration }}'

    - alert: OkoroDBConnectionPoolExhausted
      expr: |
        okoro_db_pool_connections{state="active"}
        / (okoro_db_pool_connections{state="active"} + okoro_db_pool_connections{state="idle"})
        > 0.9
      for: 5m
      labels:
        severity: high
        runbook: RB-101
      annotations:
        summary: 'DB connection pool > 90% utilized'

    - alert: OkoroWebhookBacklogHigh
      expr: okoro_webhook_queue_depth > 1000
      for: 10m
      labels:
        severity: high
        runbook: RB-103

    - alert: OkoroSuddenApprovalRateDrop
      expr: okoro:verify_approval_rate:5m < 0.5
      for: 3m
      labels:
        severity: high
      annotations:
        summary: 'Approval rate < 50% — possible mass denial bug'
```

### 4.3 P2 Alerts (Non-Paging)

```yaml
- name: okoro.p2
  rules:
    - alert: OkoroVerifyLatencyElevated
      expr: okoro:verify_p50:5m > 0.1
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: 'Verify p50 > 100ms (elevated, not yet paging)'

    - alert: OkoroTrustBandDegradation
      expr: |
        rate(okoro_trust_band_transitions_total{to="FLAGGED"}[1h])
        > 10
      labels:
        severity: warning
      annotations:
        summary: 'High rate of agents dropping to FLAGGED band'

    - alert: OkoroKeyExpiringSoon
      expr: okoro_signing_key_expiry_seconds < 86400 * 7 # 7 days
      labels:
        severity: warning
      annotations:
        summary: 'Signing key expires in < 7 days — rotate now'
```

---

## 5. OpenTelemetry Traces

### 5.1 Enabling OTel

```bash
# .env.production
OKORO_OTEL_ENABLED=true
OTEL_SERVICE_NAME=okoro-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.your-infra.io:4318
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer ${OTEL_TOKEN}
```

The `initTracing()` call in `main.ts` bootstraps the OTel SDK before NestJS starts.

### 5.2 Span Inventory

Every verify call produces a trace with these spans:

```
POST /v1/verify (root span, ~total latency)
  ├── db.query.findAgent (≈15ms expected)
  ├── redis.get.revocation_cache (≈2ms expected)
  ├── crypto.ed25519.verify (≈0.5ms expected — @noble/ed25519 is fast)
  ├── redis.get.jti_replay (≈2ms expected)
  ├── db.query.findPolicy (≈10ms expected)
  ├── redis.incrby.spend_counter (≈2ms expected)
  ├── bate.scorer.compute (≈1ms expected — pure function)
  ├── bate.anomaly.evaluate (≈1ms expected — pure function)
  ├── db.insert.audit_event (≈5ms expected)
  └── kms.sign.audit_event (≈20ms if KMS, ≈0.1ms if env key)
```

If total span > 200ms, look for:

- `db.query.*` spans > 50ms → missing index or N+1
- `kms.sign.*` > 100ms → KMS latency spike, consider caching
- `redis.*` > 10ms → Redis overloaded or high latency

### 5.3 Custom Span Attributes

Every verify span carries these attributes for filtering in APM:

```typescript
span.setAttributes({
  'okoro.principal_id': principalId,
  'okoro.agent_id': agentId,
  'okoro.outcome': outcome,
  'okoro.denial_reason': denialReason ?? null,
  'okoro.trust_band': trustBand,
  'okoro.trust_score': trustScore,
  'okoro.spend_amount': amount ?? 0,
  'okoro.spend_currency': currency ?? null,
  'okoro.token_age_ms': tokenAgeMs,
  'okoro.scopes': scopes.join(','),
});
```

### 5.4 Trace Sampling

```typescript
// config/otel.ts
const sampler = new ParentBasedSampler({
  // Sample 100% of errors (we never want to miss a failing trace)
  // Sample 10% of successful verify calls at high traffic
  root: new TraceIdRatioBased(
    process.env.OKORO_OTEL_SAMPLE_RATE ? parseFloat(process.env.OKORO_OTEL_SAMPLE_RATE) : 0.1,
  ),
});

// In production: OKORO_OTEL_SAMPLE_RATE=0.05 (5% of successful traces)
// On errors: always 100% (SDK auto-upgrades error traces)
```

---

## 6. Structured Logging

### 6.1 Log Format

All logs are Pino JSON. Every log line must include:

```json
{
  "level": "info",
  "time": 1714867200000,
  "msg": "verify.completed",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "service": "okoro-api",
  "version": "1.2.3",
  "principalId": "prin_abc123",
  "agentId": "agent_xyz789",
  "outcome": "approved",
  "latencyMs": 47,
  "trustBand": "VERIFIED",
  "trustScore": 823
}
```

**NEVER log:**

- Private keys (grep for `privateKey` — should be zero hits in non-test code)
- API key values (only last 4 chars for identification)
- Full JWT tokens
- User PII beyond what's in the audit log

### 6.2 Log Levels

| Level   | When                                    | Examples                                      |
| ------- | --------------------------------------- | --------------------------------------------- |
| `error` | Unexpected failures that need attention | DB connection lost, signing failure           |
| `warn`  | Degraded but functional                 | Ephemeral key used (not KMS), Redis reconnect |
| `info`  | Normal operations (structured events)   | verify.completed, agent.registered            |
| `debug` | Verbose (disabled in production)        | Each DB query, each Redis operation           |

### 6.3 Key Log Events

```typescript
// These structured log messages are what monitoring queries against

logger.info({ msg: 'verify.completed', outcome, denialReason, latencyMs, agentId });
logger.info({ msg: 'agent.registered', agentId, principalId });
logger.info({ msg: 'agent.revoked', agentId, reason });
logger.warn({ msg: 'audit.signing.ephemeral_key', warning: 'NOT FOR PRODUCTION' });
logger.error({ msg: 'redis.unavailable', error: err.message, fallback: 'ANOMALY_FLAGGED' });
logger.error({ msg: 'db.query.failed', query, error: err.message });
logger.info({ msg: 'bate.anomaly.triggered', rule, agentId, details });
logger.info({ msg: 'webhook.delivered', subscriptionId, eventType, latencyMs });
logger.warn({ msg: 'webhook.delivery.failed', subscriptionId, attempt, error });
```

### 6.4 Verify Log Output

Every verify call produces exactly one structured log line at `info` level:

```typescript
logger.info({
  msg: 'verify.completed',

  // Request context
  requestId: req.id,
  traceId: trace.getActiveSpan()?.spanContext().traceId,

  // Identity
  principalId: req.principal.id,
  agentId: input.agentId,
  relyingPartyId: input.relyingPartyId ?? null,

  // Result
  outcome: result.outcome,
  denialReason: result.denialReason ?? null,
  trustBand: result.trustBand,
  trustScore: result.trustScore,

  // Performance
  latencyMs: Date.now() - startTime,
  dbQueryCount: ctx.queryCount,
  redisOps: ctx.redisOps,

  // No PII, no keys, no token
});
```

---

## 7. Dashboards

### 7.1 Dashboard 1: Verify Health (Ops)

**Purpose:** Primary ops dashboard. Should be open during any incident.

Panels:

```
Row 1: Traffic
  - Verify RPS (approved vs denied vs error, stacked area)
  - Denial reason breakdown (pie chart, last 1h)
  - Approval rate % over time (line, alert at <80%)

Row 2: Latency
  - verify_duration_seconds p50/p95/p99 (line, alert band at 200ms)
  - Latency heatmap (histogram over time)
  - Latency by outcome (approved vs denied — should be similar)

Row 3: Errors
  - Error rate % (line, threshold line at 0.1%)
  - Top error types (table: last 100 errors grouped by msg)
  - Recent errors (log panel: level=error, last 50)

Row 4: Capacity
  - DB connection pool utilization (gauge)
  - Redis memory % used (gauge)
  - Railway CPU by replica (stacked line)
  - Railway memory by replica (stacked line)
```

### 7.2 Dashboard 2: Trust & BATE

**Purpose:** Understanding agent behavioral health.

Panels:

```
Row 1: Trust Score Distribution
  - Score histogram (0-1000, 50-point buckets)
  - Trust band breakdown (pie: PLATINUM/VERIFIED/WATCH/FLAGGED)
  - Band transition rate (promotions vs demotions, last 24h)

Row 2: BATE Signals
  - Top signal types received (bar chart, last 24h)
  - Anomaly rule firing rate (R-1 through R-5, line chart)
  - FRAUD_REPORT signal trend (weekly)

Row 3: Agent Activity
  - New agents registered per day (bar chart)
  - Active agents (verified calls in last 7 days)
  - Agents in FLAGGED band trending up? (line, alert at +20%/day)
```

### 7.3 Dashboard 3: Business & Onboarding

**Purpose:** Erwin's daily driver for beta health.

Panels:

```
Row 1: Acquisition
  - New principals this week (stat)
  - Cumulative principals by tier (stacked area)
  - Source breakdown (if UTM tracking available)

Row 2: Activation Funnel
  - Onboarding steps completed (funnel chart)
  - hasFirstVerify conversion rate (stat, target: 60%)
  - Time-to-first-verify median (stat, target: <10min)

Row 3: Retention
  - Daily active principals (verified calls today)
  - Weekly cohort retention (table: cohort week vs retention %)
  - Top 10 principals by verify volume (table)

Row 4: Revenue (Phase 2+)
  - MRR (stat)
  - Trial-to-paid conversion (stat)
  - Churn rate (stat)
```

### 7.4 Dashboard 4: Audit Chain Integrity

**Purpose:** Compliance and security monitoring.

Panels:

```
Row 1: Chain Health
  - Chain breaks total (stat, should always be 0)
  - Last chain verification run (timestamp)
  - Events verified in last run (stat)
  - Signing key in use (stat: KMS vs env)

Row 2: Audit Volume
  - Audit events written per hour (area chart)
  - Events by outcome (approved/denied/error)
  - Top principal by audit volume (table)

Row 3: Signing Performance
  - KMS sign latency p99 (line)
  - Signing key ID rotation timeline (events overlay)
```

---

## 8. Cloudflare Workers Observability (Phase 3)

When CF Worker edge verify is live:

```typescript
// workers/cf-verify/src/edge-verify.ts
// All metrics exported to Cloudflare Analytics Engine

env.ANALYTICS.writeDataPoint({
  blobs: [agentId, outcome, denialReason ?? ''],
  doubles: [latencyMs, trustScore ?? 0, amount ?? 0],
  indexes: [principalId],
});
```

Cloudflare dashboard → Workers → Analytics → custom dataset: `okoro_edge_verify`

Additional edge metrics to track:

- Cache hit rate for agent/policy lookups (target: >80%)
- `X-OKORO-Edge-Divergence` header rate (shadow mode: how often edge disagrees with origin)
- Edge vs origin latency comparison

---

## 9. Runbook Links from Alerts

Every alert links to the correct runbook section. Quick reference:

| Alert                | Runbook                           |
| -------------------- | --------------------------------- |
| API down             | INCIDENT_RESPONSE.md §RB-001      |
| Wrong verify results | INCIDENT_RESPONSE.md §RB-002      |
| Audit chain break    | INCIDENT_RESPONSE.md §RB-003      |
| Key exposure         | INCIDENT_RESPONSE.md §RB-004      |
| DB down              | INCIDENT_RESPONSE.md §RB-005      |
| High latency         | INCIDENT_RESPONSE.md §RB-101      |
| High error rate      | INCIDENT_RESPONSE.md §RB-102      |
| Webhook backlog      | INCIDENT_RESPONSE.md §RB-103      |
| Key expiring         | SECURITY_RUNBOOK.md §Key Rotation |

---

## 10. Health and Readiness Endpoints

```bash
# Health (unauthenticated — used by load balancers)
curl https://api.okoroapp.com/health
# Expected: {"status":"ok","timestamp":"2026-05-04T12:00:00.000Z"}
# This must NEVER require auth. Never block on DB/Redis.

# Readiness (authenticated — deep health check)
curl https://api.okoroapp.com/ready \
  -H "X-OKORO-Admin: $OKORO_ADMIN_TOKEN"
# Expected: {"status":"ready","db":"ok","redis":"ok","migrations":"current"}

# Metrics
curl https://api.okoroapp.com/metrics \
  -H "Authorization: Bearer $METRICS_TOKEN"
# Expected: Prometheus text format

# Version info
curl https://api.okoroapp.com/version
# Expected: {"version":"1.2.3","commit":"abc123","build":"2026-05-04"}
```

---

## 11. On-Call Observability Checklist

Before handing off to the next on-call engineer:

```
[ ] All P0 alerts are green (or have documented suppressions)
[ ] Verify error rate < 0.1% (checked in Grafana dashboard 1)
[ ] Verify p99 < 200ms (checked in Grafana dashboard 1)
[ ] Audit chain integrity cron: last successful run < 25h ago
[ ] No OutboxEvent backlog > 100 (checked in DB or dashboard 3)
[ ] Signing key expiry > 30 days (checked in dashboard 4)
[ ] No unresolved P0/P1 incidents in #incidents channel
```

---

_Observability guide version: 1.0 | OKORO Phase 1_  
_Next review: after first week of production traffic_
