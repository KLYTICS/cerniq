# Runbook — Cross-project agent orchestrator

> Operational guide for `apps/api/src/modules/orchestrator/` and its
> Slack adapter (`packages/integrations/slack/`).
>
> Authoritative architecture decision: [`docs/decisions/0020-cross-project-agent-orchestrator.md`](../decisions/0020-cross-project-agent-orchestrator.md)
>
> **Stub status**: this runbook is authored alongside ADR-0020 EQR-9.
> Sections below are scaffolded with the right shape; concrete commands
> + output samples land in M-060h after M-060b deploys to staging.

## Quick reference

| Symptom                                                              | Section                                  | Severity |
| -------------------------------------------------------------------- | ---------------------------------------- | -------- |
| Page: `OrchestratorTaskCreateErrorRateHigh`                          | [§3 Task-create errors](#3-task-create-error-rate-high) | P2 |
| Page: `OrchestratorApprovalBacklog`                                  | [§4 Approval backlog](#4-approval-backlog) | P2 |
| **Page: `OrchestratorAuditChainBreak`** (wake-the-house)             | [§5 Audit-chain break](#5-audit-chain-break-wake-the-house) | **P0** |
| Security: `OrchestratorSlackCallbackForgeryAttempts`                 | [§6 Slack forgery attempts](#6-slack-callback-forgery-attempts) | P1 |
| Customer ticket: "my task is stuck in `awaiting_approval`"           | [§7 Task stuck in state](#7-task-stuck-in-state) | P3 |
| Operator: "I need to bulk-approve while Slack is down"               | [§8 Bulk-approve fallback](#8-bulk-approve-fallback) | varies |
| Operator: "I need to flip the feature flag"                          | [§9 Feature-flag procedure](#9-feature-flag-procedure) | varies |

## 1. Healthcheck

Quick verification orchestrator is up:

```bash
curl -fsS https://api.okorolabs.io/v1/orchestrator/healthz
# Expected (HTTP 200):
# {"ok":true,"db":"up","redis":"up","outbox":"draining","version":"<sha>"}
```

`db`, `redis`, and `outbox` keys all `"up"` or `"draining"` → healthy.
Any `"down"` → page on-call.

## 2. Useful queries

```bash
# Tasks in progress, last 1h:
psql $DATABASE_URL -c "
  SELECT id, principal_id, project, team, kind, status, created_at
  FROM \"Task\"
  WHERE created_at > NOW() - INTERVAL '1 hour'
  ORDER BY created_at DESC
  LIMIT 50;
"

# Outbox depth for orchestrator events:
psql $DATABASE_URL -c "
  SELECT COUNT(*) FROM \"OutboxEvent\"
  WHERE category = 'orchestrator' AND delivered_at IS NULL;
"

# Slack-callback failures last 1h:
# (read from Prometheus, not DB; this is a metric-only signal)
# slack_callback_total{result!="ok"}
```

## 3. Task-create error rate high

**Alert**: `OrchestratorTaskCreateErrorRateHigh` — `POST /v1/tasks` 5xx
rate > 0.5% for 5m.

1. Confirm scope: per-tenant or platform-wide?
   ```bash
   # In Grafana orchestrator dashboard:
   # Panel "Task create errors by principalId" — top offenders.
   ```
2. **If one principalId dominates**: likely consumer misuse (bad
   envelope schema). Look at recent log entries for that principal:
   ```bash
   # Loki/Grafana log search:
   # {service="okoro-api"} |= "principalId=<id>" |= "task create" |= "validation"
   ```
   Mitigation: reach out to customer; if abuse, apply rate limit via
   existing throttler config.
3. **If platform-wide**: check Postgres + Redis health (§1). If DB
   stress: scale read replicas or shed load via feature flag (§9).
4. Escalation: if 5xx rate > 5% for 15m, page eng manager.

## 4. Approval backlog

**Alert**: `OrchestratorApprovalBacklog` —
`awaiting_approval_seconds` P95 > 300s sustained 15m.

D5d guarantees orchestrator keeps running if Slack is down; the
backlog drains on Slack recovery. But check whether the cause IS
Slack:

1. Slack status: <https://status.slack.com/>
2. Recent Slack post failures:
   ```bash
   # Prometheus:
   # rate(slack_post_total{result!="ok"}[5m])
   ```
3. **If Slack is the cause**: outbox retries are running; verify
   queue health (§2). If queue depth stable or shrinking, wait.
4. **If Slack is fine but approvals aren't happening**: humans aren't
   clicking. Check who's on-call for the affected principalId's Slack
   workspace. May need to use **§8 bulk-approve fallback**.

## 5. Audit-chain break (wake-the-house)

**Alert**: `OrchestratorAuditChainBreak` — any audit-chain
verification failure on a task event. **Severity P0. Page everyone.**

This is invariant #3 territory. Do not silent-recover.

1. **Halt task ingestion immediately**:
   ```bash
   # Flip the orchestrator feature flag off (§9) — stops new task creation
   # but lets in-flight tasks settle.
   ```
2. Identify the break point:
   ```bash
   pnpm -F @okoro/audit-verifier run verify --from <last-known-good-seq> --to HEAD
   # Outputs: first failing event ID + expected vs actual hash.
   ```
3. Snapshot the affected range to immutable storage before any further
   action.
4. Investigation owner: operator (Erwin) + crypto-paired-tests owner.
5. **No silent recovery**. Replay options:
   - Replay from snapshot if available (per ADR-0005 canonicalization).
   - Manual reconciliation with operator sign-off + audit-chain
     restoration ceremony documented in a per-incident decision record.
6. Escalation: PD `wake-everyone` → operator → external auditor if
   customer-export chain was affected.

## 6. Slack callback forgery attempts

**Alert**: `OrchestratorSlackCallbackForgeryAttempts` —
`slack_callback_total{result=kms_invalid}` > 0/min for 5m.

Possible causes (in likelihood order):

1. **KMS key rotation in progress** — verify against ADR-0011 KMS
   rotation playbook. If a planned rotation, alert is benign during
   the rotation window.
2. **Genuine forgery attempt** — extract source IP, geo, user agent
   from `apps/api/src/modules/orchestrator/integrations/slack.controller.ts`
   request log. Cross-reference with WAF logs.
3. **Misconfigured Slack workspace** — workspace using stale signing
   secret. Re-run Slack OAuth handshake.

If genuine forgery: file security incident per `docs/SECURITY.md` §
Incident Response. Rotate KMS key family per ADR-0011 if compromise
suspected.

## 7. Task stuck in state

Customer ticket flow:

1. Get `taskId` from customer.
2. Query the task:
   ```bash
   psql $DATABASE_URL -c "
     SELECT id, principal_id, project, team, kind, status,
            claimed_by, awaiting_approval_since, created_at
     FROM \"Task\" WHERE id = '<taskId>';
   "
   ```
3. Diagnose by status:
   - `created` for > 30s → outbox dispatcher stuck; check Redis.
   - `ready` for > 5m → no agent declared capability; consumer misconfig.
   - `claimed` for > claim TTL (default 1h) → agent heartbeat absent;
     auto-released on next sweep.
   - `awaiting_approval` for > approval TTL (configurable per
     principal) → see §4 backlog response.
4. Manual unblock: only with operator sign-off + audit event recorded.

## 8. Bulk-approve fallback

Use when Slack is down for > 1h and the approval backlog is causing
customer impact.

1. Navigate to: `https://dashboard.okorolabs.io/orchestrator/approvals`
   (M-060f surface).
2. Filter by `principalId`, `status=awaiting_approval`,
   `awaiting_since > 1h`.
3. Review each task's payload before approving. The dashboard renders
   `riskTier`, payload summary, and proposed action.
4. Bulk-approve actions emit one `intent.approval.bulk` audit event
   per task with `approver=operator:<email>`, `bulk_batch_id=<uuid>`,
   `reason=<free-text>`. Required: non-empty reason.
5. Operator MFA prompt at the dashboard ensures the human approver is
   authenticated.
6. Post-incident: every bulk-approve batch generates a review report
   the next business day for compliance evidence.

## 9. Feature-flag procedure

`OKORO_ORCHESTRATOR_ENABLED` controls all orchestrator endpoints.

**Flip OFF** (incident mitigation):
```bash
# Per existing feature-flag system (LaunchDarkly / config service):
# Set OKORO_ORCHESTRATOR_ENABLED=false for affected environments.
# Confirm:
curl -fsS https://api.okorolabs.io/v1/orchestrator/healthz
# Expected when off: {"ok":true,"orchestrator":"disabled","version":"<sha>"}
```

When off:
- `POST /v1/tasks` returns `501 Not Implemented` with body
  `{"error":"orchestrator_disabled"}`.
- Existing tasks in non-terminal states remain queryable.
- Audit chain continues for non-orchestrator events.

**Flip ON** (restore):
- Set `OKORO_ORCHESTRATOR_ENABLED=true`.
- Verify healthcheck (§1).
- Verify Grafana orchestrator dashboard SLI panels recover within 5m.

**Per-principal flag** (carve-out): `OKORO_ORCHESTRATOR_PRINCIPALS_DENY=<comma-list>`
allows blocking individual principals without platform-wide outage.

## 10. Escalation

| Level   | Owner                            | Channel                   |
| ------- | -------------------------------- | ------------------------- |
| Primary | orchestrator on-call             | PD: `orchestrator-primary` |
| L2      | API eng manager                  | PD: `api-eng-manager`     |
| L3      | Operator (Erwin)                 | direct + ops@okorolabs.io |
| Audit   | external auditor (Big-Four named in DPA) | per Enterprise DPA template |

P0 (audit-chain break, customer-data exfiltration) auto-escalates all
levels in parallel.

## 11. Related runbooks

- [`docs/RUNBOOK.md`](../RUNBOOK.md) — root operator runbook
- `docs/runbooks/audit-chain.md` — audit-chain verification + restore
  (referenced by §5)
- `docs/runbooks/slack-integration.md` — Slack adapter ops (M-060h
  follow-on)
- [`docs/decisions/0020-cross-project-agent-orchestrator.md`](../decisions/0020-cross-project-agent-orchestrator.md)
  EQR-3 FMEA matrix — formal failure-mode catalog this runbook implements

---

**Last reviewed**: 2026-05-21 (stub authored alongside ADR-0020).
**Next review**: when M-060b deploys to staging; concrete commands +
output samples filled in.
**Owner**: platform team (operator until hired).
