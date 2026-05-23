# CERNIQ — On-call runbooks

Every alert in `infra/observability/alerts/cerniq.rules.yml` has exactly
one runbook in this directory. The on-call engineer's first action on
any page is to open the runbook linked from the alert annotation —
not Slack, not Grafana, not the source code. The runbook tells them
what to look at, in what order, and when to escalate.

## Index

| Alert                         | Severity             | Runbook                                                        | First-touch SLA |
| ----------------------------- | -------------------- | -------------------------------------------------------------- | --------------- |
| `VerifyLatencyP99SLOBreach`   | critical             | [verify-latency-slo-breach.md](./verify-latency-slo-breach.md) | 5 min           |
| `VerifyLatencyP99SLOWarning`  | warning              | [verify-latency-slo-breach.md](./verify-latency-slo-breach.md) | 30 min          |
| `VerifyErrorRateHigh`         | warning              | [verify-error-rate-high.md](./verify-error-rate-high.md)       | 30 min          |
| `VerifyErrorBudgetFastBurn`   | critical             | [error-budget-burn.md](./error-budget-burn.md)                 | 5 min           |
| `VerifyErrorBudgetSlowBurn`   | warning              | [error-budget-burn.md](./error-budget-burn.md)                 | 30 min          |
| `AuditChainAppendFailureRate` | critical             | [audit-chain-break.md](./audit-chain-break.md)                 | 5 min           |
| `AuditAppendStalled`          | critical             | [audit-chain-break.md](./audit-chain-break.md)                 | 5 min           |
| `BateRecomputeLag`            | warning _(disabled)_ | [bate-recompute-lag.md](./bate-recompute-lag.md)               | 30 min          |
| `BateAnomalySignalSpike`      | warning _(disabled)_ | [bate-recompute-lag.md](./bate-recompute-lag.md)               | 30 min          |
| `WebhookDLQSpike`             | warning              | [webhook-dlq-spike.md](./webhook-dlq-spike.md)                 | 30 min          |
| `WebhookDeliveryFailureRate`  | warning              | [webhook-dlq-spike.md](./webhook-dlq-spike.md)                 | 30 min          |
| `RedisHitRateLow`             | info _(disabled)_    | [redis-hit-rate-low.md](./redis-hit-rate-low.md)               | business hours  |
| `HTTP5xxRateHigh`             | critical             | [verify-error-rate-high.md](./verify-error-rate-high.md)       | 5 min           |
| `EventLoopLagHigh`            | warning              | [verify-latency-slo-breach.md](./verify-latency-slo-breach.md) | 30 min          |

_(disabled)_ = the underlying metric is not yet emitted; alert ships
as `expr: vector(0) > 1` and is a one-line flip when the metric lands.
The runbook is correct as written.

## On-call expectations

- **Critical alert** — phone page via PagerDuty. Acknowledge within
  5 min; first runbook step within 5 min of acknowledgment. Status
  page update (https://status.cerniqapp.com) within 15 min if the
  alert is still firing.
- **Warning alert** — PagerDuty notify (no page) + Slack
  `#cerniq-oncall`. Triage within 30 min during business hours, by
  next business day if after-hours. No status page entry unless it
  escalates.
- **Info alert** — Slack `#cerniq-ops` only. Triage during business
  hours.

The current rotation, escalation chain, and PagerDuty service ID are
**OD-007 (operator decision pending)**. Runbooks reference the
escalation contact as `${ESCALATION_CONTACT}` until OD-007 lands.

## How to add a runbook (4 steps)

1. **Copy `error-budget-burn.md` as your template.** It has every
   required section with realistic content. Do not invent your own
   structure.
2. **Fill every section with concrete commands.**
   `kubectl logs ...`, `psql ...`, `redis-cli ...`, exact Grafana panel
   URLs, exact Prometheus queries. The quality bar (below) is enforced
   in review.
3. **Cross-link the alert.** The `runbook` annotation on the alert in
   `cerniq.rules.yml` must use the runbook's repo path; the
   `runbook_url` must use `https://docs.cerniqapp.com/runbooks/<file
without .md>`.
4. **Update this index table.** New row in the right severity slot.

## Quality bar

Every runbook must:

- Use **real query strings**, not "investigate the issue" or
  "check the logs". The on-call engineer will copy-paste — make it
  copy-pasteable.
- Reference **real metric names** that exist in
  `apps/api/src/common/observability/metrics.service.ts`. If you
  reference a metric that doesn't exist, mark it inline:
  `(metric not yet emitted — tracked: <module>)`.
- Include a **Verify recovery** section with a Prometheus query that
  must return ok-state. "It's fine now" is not a recovery criterion.
- Include a **Postmortem trigger** section with a yes/no answer based
  on the standard policy: any SLO breach > 30 min triggers a
  postmortem; any audit chain break triggers a postmortem regardless
  of duration; any customer-visible incident > 15 min triggers a
  postmortem; warnings do not, unless a customer reports impact.
- Include an **Escalate** section with the escalation chain and
  timing. Until OD-007 ships, this is a TBD line referencing
  `${ESCALATION_CONTACT}`.

A runbook that says "investigate the issue" without a concrete next
step blocks the PR.

## Build-time / process runbooks (no Prometheus alert)

These runbooks back failures from CI gates and process surfaces (the round-15+ quality bar). They don't fire as Prometheus alerts; they fire when `make preflight` or a per-PR gate returns non-zero. First-touch is the engineer who broke the gate, not on-call.

| Trigger                                                          | Runbook                                                        | Owner                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| `make preflight` exit 1 or 2                                     | [preflight-failure.md](./preflight-failure.md)                 | engineer who hit the gate                             |
| API key rotation 5xx / orphan two-active state                   | [key-rotation-failure.md](./key-rotation-failure.md)           | on-call (security-adjacent)                           |
| Audit retention tick missed > 25h / mid-batch crash              | [audit-retention-failure.md](./audit-retention-failure.md)     | on-call (compliance-adjacent)                         |
| Plan-aware throttle 429 storm / tier mis-classification          | [plan-aware-throttle-storm.md](./plan-aware-throttle-storm.md) | on-call                                               |
| Error catalog uncataloged / parity drift / customer-message leak | [error-catalog-drift.md](./error-catalog-drift.md)             | engineer who hit the gate (security-adjacent if leak) |

These five reach Prometheus-alert parity once their underlying metrics emit (round 15 backlog). The runbook content is correct as written — only the alert linkage moves.

## Where things live

- Alert rules: `infra/observability/alerts/cerniq.rules.yml`
- Grafana dashboards: `infra/observability/grafana-dashboards/`
- OTel collector config: `infra/observability/otel-collector.yaml`
- SLO contract: `docs/SLO.md`
- Architecture invariants (for "is this a real issue or by design"):
  `CLAUDE.md`
- Security model + denial precedence: `docs/SECURITY.md`
