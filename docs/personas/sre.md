---
title: CERNIQ for site reliability engineers
audience: SREs operating CERNIQ or operating services that depend on CERNIQ
last-reviewed: 2026-05-02
---

# CERNIQ for SREs — what to watch, what to page on

CERNIQ is on the hot path for every relying-party action. If CERNIQ is
unhealthy, every dependent service degrades. The SLOs and runbooks are
sized for that reality.

## SLOs

| Surface                  | SLO                                                       | Source                             |
| ------------------------ | --------------------------------------------------------- | ---------------------------------- |
| `/v1/verify` (origin)    | p99 < 200 ms, error rate < 0.1%                           | `docs/SLO.md`                      |
| `/v1/verify` (edge)      | p99 < 80 ms, error rate < 0.05%                           | Phase 3 — gated on M-013 / $5K MRR |
| `/v1/audit` write        | p99 < 100 ms, error rate < 0.05%                          | `docs/SLO.md`                      |
| `/.well-known/jwks.json` | 99.99% availability (this is the offline-verify fallback) | `docs/SLO.md`                      |
| Webhook delivery         | p99 first attempt < 5s; 99% within 10 attempts            | M-008                              |

Alert rules live in `infra/observability/alerts/cerniq-security.rules.yml`
(peer-shipped 2026-05-02). The alerts are _security-flavored_ — auth
failure spikes, audit append failures, replay-cache failures — because
those are the cases where degraded CERNIQ turns into a security
incident, not just a latency one.

## Dashboards

- **Verify hot path** — `verify_latency_seconds` histogram, `verify_total{denial_reason}` counter, `verify_total{tier}` for tier breakdown.
- **BATE signals** — `bate_score_delta{signal_type}` to track which signals are firing and how loudly.
- **Audit chain** — `audit_append_failures_total`, `audit_chain_depth` gauge.
- **Replay cache** — `replay_cache_consume_total{result=accept|reject}`.

Dashboards live alongside the alert rules; both are Grafana JSON in
`infra/observability/`.

## Top runbooks

Read in this order:

1. `docs/RUNBOOK.md` — general operations.
2. `docs/SECURITY_RUNBOOK.md` (2026-05-02) — incident response:
   key rotation, secret leak, audit chain breach.
3. `docs/DR_RUNBOOK.md` — disaster recovery (DB loss, Redis loss,
   region failover for Phase 3).
4. `docs/SMOKE_TEST.md` — post-deploy validation.

## What to page on

- Any audit append failure (severity: high) — directly threatens the
  tamper-evident promise.
- Verify error rate > 0.5% over 5 minutes (severity: high).
- JWKS unavailability > 1 minute (severity: medium — RPs can still
  verify online, but offline-verify is degraded).
- Cross-tenant query attempt detected by RLS (severity: critical —
  always a code or auth bug, never a benign event).
- Spend-counter Redis unavailability (severity: critical — fail
  closed; verify returns 503 rather than fall back to Postgres-only
  per ARCHITECTURE.md §6 / threat model §8).

## Capacity

`docs/CAPACITY_PLAN.md` (sid=a9198691, 2026-05-02) holds the current
sizing. Headline: a single Railway origin handles ~20K req/s on a
warm cache before vertical scaling matters; the Phase 3 edge fans
out across CF regions.

## Failure modes

`docs/FAILURE_MODES.md` (sid=a9198691, 2026-05-02) enumerates how
CERNIQ degrades when each dependency (Postgres, Redis, KMS, Auth0)
goes away. Worth reading before you're paged at 3am.

## Reference

- `docs/SLO.md`, `docs/RUNBOOK.md`, `docs/DR_RUNBOOK.md`, `docs/SMOKE_TEST.md`
- `docs/SECURITY_RUNBOOK.md`, `docs/CAPACITY_PLAN.md`, `docs/FAILURE_MODES.md`
- `infra/observability/` — alert rules + Grafana dashboards.
- `cerniq doctor` — for the operator side, the same probes the SRE
  dashboard surfaces, but on demand.
