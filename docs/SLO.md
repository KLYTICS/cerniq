# AEGIS — Service Level Objectives

> Lives separate from `docs/RUNBOOK.md` because SLOs are a *contract* with
> customers, while the runbook is a contract with on-call. Changing an SLO
> means changing what we promise; changing the runbook is mechanical.

**Owner**: Engineering on-call lead.
**Cadence**: Quarterly review against actual telemetry. Update when
material drift (>10%) is observed.
**Last reviewed**: 2026-05-01.

---

## 1. The contract

| Surface | SLI | SLO | Error budget / 30d |
|---|---|---|---|
| `POST /v1/verify` (origin) | p99 latency from request received → response sent | **<200 ms** at 99.9% | 43 m / 30d |
| `POST /v1/verify` (edge, Phase 3) | p99 latency global | **<80 ms** at 99.9% | 43 m / 30d |
| `POST /v1/verify` | success rate (HTTP 2xx, including verify denials) | **99.95%** | 21 m / 30d |
| `GET /v1/agents/:id/status` | success rate | **99.99%** | 4.3 m / 30d |
| Agent revocation propagation | revoke → next verify denied | **<5 s** at 99.9% | 43 m / 30d |
| Audit log durability | every approved verify produces a chained audit row within 60 s | **100%** (best-effort with DLQ — losses must be enumerable from DLQ) | 0 |
| BATE score recompute lag | signal ingested → score updated | **<60 s** at 99% | 7.2 h / 30d |
| Webhook delivery | event emitted → first delivery attempt | **<60 s** at 99.5% | 3.6 h / 30d |
| Webhook end-to-end (incl. retries) | delivered or DLQ'd | **<24 h** at 99.9% | 43 m / 30d |
| Status page accuracy | actual ongoing incident reflected on status page | **<5 m** at 99% | 7.2 h / 30d |

## 2. SLI definitions (precise)

### `verify_latency_seconds`
Histogram, labels: `decision={approved|denied}`, `denial_reason={...}`, `source={origin|edge}`.
- Start clock: NestJS interceptor records `Date.now()` after request body is parsed (validation pipe complete).
- Stop clock: response object handed to Express `res.send()` (interceptor `tap`).
- p99 is computed over a 5-minute trailing window for alerting; 30-day window for SLO accounting.

### `verify_success_total`
Counter, labels: `outcome={approved|denied|error}`. A verify response is **success** if the API responded with HTTP 200 (regardless of `valid: true|false`). HTTP 4xx (bad request) and 5xx (internal) count as failures.

### `agent_revoke_propagation_seconds`
Histogram. Start clock: principal calls `DELETE /v1/agents/:id`, response 204 returned. Stop clock: first subsequent verify call for that agent returns `denialReason: AGENT_REVOKED`. Excludes verify calls received before the revoke landed (those are correctly approved).

### `audit_durability_ratio`
Computed daily. Numerator: count of `verifyApprovedTotal` events that have a matching `auditEvent` row by `eventId`. Denominator: `verifyApprovedTotal`. Failure to chain (signature break) is a P0 incident, not just an SLO breach.

### `bate_score_recompute_seconds`
Histogram. Start clock: `BateSignal.occurredAt`. Stop clock: `TrustScoreHistory` row inserted that includes the signal's id.

## 3. Error budget policy

- Each SLO defines a 30-day error budget (1 - SLO).
- When a service has **<10% budget remaining** in a rolling 7-day window, the on-call lead may declare a **release freeze** on that surface. Bug fixes and security patches still ship; new features wait.
- Budget burn rate alarms fire at: 14.4× (consumes 30d budget in 2h), 6× (in 5h), 3× (in 24h).
- Budgets reset on the first day of each calendar month per surface, not globally.

## 4. SLO ↔ pricing tier

| Tier | Verify p99 | Agent status p99 | Webhook delivery | Audit retention |
|---|---|---|---|---|
| FREE | best-effort (no SLO) | 99.9% | 99.5% | 30 days |
| Developer | 99.9% | 99.95% | 99.9% | 90 days |
| Growth | 99.95% | 99.99% | 99.9% | 1 year |
| Enterprise | 99.99% (custom contract) | 99.99% | 99.99% | 7 years (SOC2 Type II floor — see OPERATOR_DECISIONS.md OD-004) |

Customer-facing SLAs (with credits) are a strict subset of these SLOs and ship with the Enterprise contract template.

## 5. Reporting

- Internal: a Grafana dashboard at `grafana.internal/d/aegis-slo` shows current 30-day burn, broken down by surface. Updated continuously.
- Customer: the status page (`status.aegislabs.io`) publishes 90-day rolling SLO compliance per surface. No per-customer dashboards in v1.

## 6. What's NOT covered by an SLO

- BATE score *correctness* (a flagged agent's flagging is a product question, not an availability one).
- Dashboard UX latency (separate target, not customer-facing SLO).
- Stripe webhook handling (we depend on Stripe's own SLA).
- First deploy / cold start (an instance's first 100 requests are excluded from p99 windows).

## 7. Change control

A change to an SLO row in §1 requires:
1. A short ADR in `docs/decisions/`.
2. Customer notification 30 days in advance for tightening that affects credits-bearing tiers.
3. No notice required for *loosening* an SLO during incident response, but the incident postmortem must justify it.
