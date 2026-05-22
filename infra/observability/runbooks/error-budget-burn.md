# Runbook — Verify error budget burn

## Alert

- **Names**: `VerifyErrorBudgetFastBurn` (critical, 14.4x over 1h),
  `VerifyErrorBudgetSlowBurn` (warning, 6x over 6h)
- **Group**: `okoro.verify.slo`
- **File**: `infra/observability/alerts/okoro.rules.yml`

## Symptom

Verify success rate (excluding legitimate revocations) is failing
fast enough to exhaust the 30-day error budget early. The two
windows catch different failure modes:

- **Fast burn (1h)**: an outage or a regression actively breaking
  verifies. At 14.4x, the entire 30-day budget is gone in 2 days if
  sustained.
- **Slow burn (6h)**: a silent regression — for example, one
  principal whose policies are all returning errors, dragging the
  global success rate down without anyone noticing.

## Impact

- **SLO**: 99.95% success on `POST /v1/verify` is a customer-facing
  contract (`docs/SLO.md` § 1, error budget = 21 min/30d). Burning
  past zero forces a release freeze on the verify surface (`docs/SLO.md`
  § 3).
- **Customer trust**: relying parties experiencing failed verifies
  will assume their integration is broken — they raise tickets, they
  retry, they amplify load.
- **Pricing-tier SLAs**: enterprise customers have a 99.99% success
  contract. If the burn is concentrated on enterprise traffic,
  service credits trigger automatically.

## Diagnose

The recording rule `job:okoro_verify_success_ratio:5m` (and `:1h`,
`:6h`) is what the alerts read. Start there.

1. **Confirm the burn is current and at what window.**

   ```promql
   # Current 5m success ratio (the leading edge)
   job:okoro_verify_success_ratio:5m

   # 1h ratio (fast-burn alert reads this)
   job:okoro_verify_success_ratio:1h

   # 6h ratio (slow-burn alert reads this)
   job:okoro_verify_success_ratio:6h
   ```

   If 5m is clean but 1h is bad, the issue is over but the budget is
   still showing the damage. If 5m and 1h are both bad, it's still
   ongoing.

2. **Decide: failure shape.** Same diagnosis tree as the
   verify-error-rate runbook — the burn alerts are budget-aware
   wrappers around the same underlying failures. Run:

   ```promql
   # Denial-reason mix (excluded reasons should be ignored — see
   # docs/SECURITY.md denial precedence)
   sum by (denial_reason) (rate(okoro_verify_total{decision="denied"}[5m]))

   # 5xx rate (platform-level failures)
   sum(rate(okoro_http_requests_total{status_class="5xx",route=~".*verify.*"}[5m]))
   /
   clamp_min(sum(rate(okoro_http_requests_total{route=~".*verify.*"}[5m])), 0.001)
   ```

3. **Per-principal slice — slow-burn often hides here.** A single
   principal driving the budget is the classic slow-burn failure
   mode and is invisible at the global level.

   The `okoro_verify_total` metric does not have a `principalId`
   label (intentional — too high cardinality). Drop to Postgres for
   per-principal slice:

   ```bash
   railway run -s okoro-api -- psql "$DATABASE_URL" -c "SELECT \"principalId\", COUNT(*) FILTER (WHERE result='ERROR') AS errors, COUNT(*) AS total, ROUND(100.0 * COUNT(*) FILTER (WHERE result='ERROR') / GREATEST(COUNT(*),1), 2) AS err_pct FROM \"VerifyEvent\" WHERE \"createdAt\" > NOW() - INTERVAL '6 hours' GROUP BY 1 HAVING COUNT(*) > 100 ORDER BY err_pct DESC LIMIT 10;"
   ```

   *(Replace table/column names if `VerifyEvent` is named differently
   in `apps/api/prisma/schema.prisma` — the audit-style verify log
   table.)*

4. **Recent deploys and migrations** (same as the latency runbook):

   ```bash
   railway deployments -s okoro-api --json | jq '.[0:5] | .[] | {createdAt, status}'
   ```

5. **Compute remaining budget.**

   ```promql
   # 30-day error budget = 1 - 0.9995 = 0.0005
   # Consumed budget (rolling 30d) =
   1 - (
     (
       sum(rate(okoro_verify_total{decision="approved"}[30d]))
       +
       sum(rate(okoro_verify_total{decision="denied",denial_reason=~"AGENT_REVOKED|POLICY_REVOKED|POLICY_EXPIRED"}[30d]))
     )
     /
     clamp_min(sum(rate(okoro_verify_total[30d])), 0.001)
   )
   ```

   If the result > 0.0005, the budget is already exhausted. Operator
   approval is required to ship anything to verify other than a
   security/availability fix until the next 30-day window.

## Mitigate

The mitigation steps depend on which root-cause runbook applies. The
budget alert is downstream — fixing the underlying failure clears
the burn.

- **Failures map to a denial-reason spike** → switch to
  [verify-error-rate-high.md](./verify-error-rate-high.md).
- **Failures map to 5xx** → switch to
  [verify-error-rate-high.md](./verify-error-rate-high.md) "5xx"
  branch.
- **Failures map to a single principal** → contact the customer.
  This is rarely fixable on our side without their change. Document
  the impact on budget in the incident timeline.
- **Failures concentrated on a recent deploy** → rollback:
  `railway rollback -s okoro-api <prev-deploy-id>`.
- **Budget exhaustion confirmed** (step 5 returns > 0.0005) →
  declare a release freeze on the verify surface. Notify
  engineering in `#okoro-oncall` and operator. Only security and
  availability fixes ship until the next month boundary.

## Eradicate

- File the postmortem. Note the budget impact: how much budget did
  this incident consume, and what's the remaining figure for the
  rest of the 30-day window.
- If the same root cause has triggered the slow-burn alert in the
  last quarter, escalate to a quarterly architecture review.
- Add a regression-class test:
  - For deploy regressions: integration test in
    `apps/api/test/verify/`.
  - For per-principal failures: alert template (future) in this rule
    file with a per-principal failure threshold once we have the
    cardinality story sorted.

## Verify recovery

```promql
# 5m and 1h success ratio both above 0.999 (SLO + buffer)
job:okoro_verify_success_ratio:5m > 0.999
job:okoro_verify_success_ratio:1h > 0.999
```

Must hold for 30 min before declaring recovery. Note: the *budget*
itself does not recover — once spent, it's spent until the calendar
window resets. "Recovery" here means we've stopped burning further.

## Escalate

- **Fast-burn (critical) not acknowledged in 5 min** → automatic
  PagerDuty re-page.
- **Fast-burn not resolved in 15 min** → page second-on-call.
- **Fast-burn not resolved in 30 min** → page
  `${ESCALATION_CONTACT}` (OD-007 pending) and notify operator
  directly.
- **Slow-burn (warning) not triaged by next business day** →
  `#okoro-oncall` lead must explain why in the next standup.
- **Budget exhausted** → operator decision required for any
  non-emergency verify-surface release until the budget window
  resets. Page operator.

## Postmortem trigger

**Always yes for fast-burn (critical).** Always yes if the budget was
exhausted in the affected window. **Yes for slow-burn** if it ran for
> 6 h before triage (the alert exists specifically to catch silent
regressions; if it caught one and we ignored it, that's a process
defect worth a postmortem). **No** for slow-burn that was triaged
within 30 min and traced to a known cause already in motion.
