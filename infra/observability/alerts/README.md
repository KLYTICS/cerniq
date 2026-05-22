# OKORO — Alert philosophy + how to add a rule

This directory holds the Prometheus rule file that defines every alert
that pages or notifies the OKORO on-call rotation. There is exactly one
rule file (`okoro.rules.yml`); split it later when it crosses ~30 alerts.

## Philosophy — what gets an alert

We page on **symptoms users can feel**, not on causes.

A rule belongs in `okoro.rules.yml` only if a "yes" answer to all four
of the questions below holds:

1. **Does it map to a real failure mode a customer or auditor would
   notice?** Latency over the SLO, denials they didn't request, missing
   audit rows, webhooks that never arrive — yes. Heap utilisation at
   72% — no.
2. **Is there a runbook with concrete steps?** No alert ships without a
   paired markdown file in `../runbooks/`. "Investigate" is not a step.
3. **Does the metric it references actually exist in
   `apps/api/src/common/observability/metrics.service.ts`?** Cross-
   check before commit. If the metric doesn't exist yet, the alert
   ships with `expr: vector(0) > 1` and a `# tracked: <module>`
   comment so it's structurally correct but disabled — never fabricate
   a metric name.
4. **Will the on-call engineer be able to act in <15 minutes?** If the
   only fix takes a four-hour migration, the alert should be a warning
   that opens a follow-up ticket, not a page-now critical.

If the answer to any question is no, the rule is a Grafana panel or a
weekly metric review — not an alert.

## Severity ladder

| Severity | Routing | First-touch SLA | Examples |
|---|---|---|---|
| `critical` | PagerDuty page → on-call phone | 5 min | SLO breach, audit chain break, error budget fast-burn |
| `warning` | PagerDuty notify (no page) → Slack `#okoro-oncall` | 30 min | SLO warning thresholds, DLQ spikes, cache hit rate (when exporter ships) |
| `info` | Slack `#okoro-ops` only | business hours | Cache utilisation, queue depth trends, baseline drift |

The PagerDuty escalation contact is **OD-007 (TBD operator decision)** —
runbooks reference it as `${ESCALATION_CONTACT}`.

## Required label set

Every alert must carry:

- `severity`: `critical` | `warning` | `info`
- `team`: `okoro-oncall` (used by Alertmanager to route to the right
  PagerDuty service — there's only one team today; the label exists so
  it can fan out cleanly later).
- `surface`: `verify` | `audit` | `bate` | `webhooks` | `cache` | `platform`

Optional:

- `slo`: `latency` | `success` | `budget` — for SLO-tied alerts; lets
  the SLO Grafana dashboard filter cleanly.
- `compliance`: `soc2-cc7.2` etc. — for alerts that map directly to a
  control. Used by the auditor evidence dashboard.
- `status`: `disabled-pending-metric` | `disabled-pending-exporter` —
  marker for alerts that compile but cannot fire today. Disabled
  alerts are kept in-tree so the runbook → alert binding stays
  intact and the trigger is a one-line edit when the metric ships.

## Required annotations

- `summary` — one line, user-facing impact. **Not** "metric exceeded
  threshold". Yes "Verify p99 latency > 200 ms — customer-facing SLO
  breached".
- `description` — multiline, includes `{{ $value }}` interpolation,
  identifies the firing series, lists the threshold, and tells the
  on-call what to look at first.
- `runbook` — repo-relative path, e.g.
  `infra/observability/runbooks/verify-latency-slo-breach.md`.
- `runbook_url` — absolute URL, e.g.
  `https://docs.okorolabs.io/runbooks/verify-latency-slo-breach`.
  Convention: filename without `.md` suffix.

## Recording rules

Pre-aggregated SLI series live in the `okoro.recording` group at the
top of `okoro.rules.yml`. Burn-rate alerts read those series directly
instead of re-deriving the same query — change the SLI definition in
one place, not three. If you find yourself copy-pasting a 5-line PromQL
expression into a third alert, promote it to a recording rule first.

## How to add a rule (4 steps)

1. **Pick or create the runbook.**
   `cp infra/observability/runbooks/_template.md
       infra/observability/runbooks/<my-alert>.md` — wait, no template
   today; copy `error-budget-burn.md`, it's the closest to the
   skeleton. Fill **every** section. No "TBD" except for
   `${ESCALATION_CONTACT}` (which is genuinely OD-007 pending).
2. **Verify the metric exists.**
   `grep <metric_name> apps/api/src/common/observability/metrics.service.ts`
   If it doesn't, either add the emitter first or ship the alert as
   `expr: vector(0) > 1` with a `# tracked: <module>` comment.
3. **Add the alert.** Place it in the matching group
   (`okoro.<surface>`). Use an existing alert as your template.
   Follow the label + annotation contract above.
4. **Test the PromQL.** Either:
   - Local: `promtool check rules infra/observability/alerts/okoro.rules.yml`
   - Hosted: paste the `expr` into the Prometheus expression browser
     and confirm it evaluates without parse errors and returns the
     expected ballpark value during normal traffic.

## Anti-patterns we have already seen and rejected

- **Mirroring dashboard PromQL verbatim.** The Grafana dashboard at
  `infra/observability/grafana-dashboards/okoro-verify-latency.json`
  references several metric names (`okoro_verify_denials_total`,
  `okoro_bullmq_waiting_jobs`, `okoro_cache_hits_total`,
  `okoro_bate_recompute_lag_seconds_bucket`) that the API does **not**
  emit. The dashboard is wrong; the code in `metrics.service.ts` wins.
  Fixing the dashboard is M-020.
- **Threshold on raw counters.** `rate()` first, every time.
- **Page on `up == 0` only.** A scraper that can't reach Prometheus
  isn't telling you anything about the API. Pair it with synthetic
  probes, which live separately (not in this file).
- **Stacking multiple `for:` clauses to suppress noise.** If an alert
  is noisy, fix the threshold or the query — don't paper over it.
