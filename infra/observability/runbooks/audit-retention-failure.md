# Runbook — audit retention failure

## Alert

- **Names**: `AuditRetentionTickMissed` (warning),
  `AuditRetentionRedactStalled` (critical) — *both not yet emitted; flip
  on metric land per round 15 backlog*.
- **Group**: `okoro.compliance`
- **File**: `infra/observability/alerts/okoro.rules.yml`
- **Source**: round-15 retention surface — `apps/api/src/modules/compliance/audit-retention.service.ts`, `scripts/run-audit-retention.ts`.

## Symptom

One or more of:
1. `okoro_audit_retention_events_redacted_total` flat for > 25 hours when traffic is normal (the cron skipped — round 15 default is 24h interval).
2. `runOnce()` invocation throws midway through a principal's batch — partial redaction state.
3. A principal's `AuditEvent` rows older than `Principal.planTier`'s `auditRetentionDays` cutoff still exist with `redactedAt IS NULL`.
4. The retention service's `getStatus()` reports the last tick was > 25h ago.

## Impact

- **SOC2 + GDPR exposure**. The retention policy is the binding control on Art. 17 (right to erasure) and the auditor-visible "we don't keep PII forever" claim. Each day past the policy without redaction is a control failure.
- **Per-tier retention drift**: plans expose `auditRetentionDays` (FREE 30, DEVELOPER 90, GROWTH 365). A tenant on a paid tier expects their audit log to live for the full window; a tenant downgrading should see immediate retention shrink. A failed retention pass means the downgrade isn't enforced.
- **Chain integrity preserved by design**: round 15 redacts via `RedactService.redactEvent()` (NOT delete) — the hash chain stays intact and a meta-event is pinned. So **a missed retention tick does NOT break the chain**, just delays the redaction. This is good news for incident severity but bad news for compliance windows.

## Diagnose

1. **Confirm the symptom — when did retention last fire?**

   ```promql
   max(okoro_audit_retention_events_redacted_total) by (instance)
   # If flat for > 25h, the tick missed. Pair with:
   sum(rate(okoro_audit_retention_events_redacted_total[1d]))
   ```

   Or programmatically via the service's `getStatus()`:

   ```bash
   # Connect to a running API and call the introspection endpoint
   # (round 15 may not have exposed it yet — check compliance.module.ts)
   railway logs -s okoro-api | rg -F 'audit-retention' | tail -30
   ```

2. **Check for stalled redaction state (mid-batch crash).**

   ```sql
   -- Principals whose audit horizon has events past the cutoff still
   -- un-redacted. Joins planTier → auditRetentionDays from plans.ts.
   -- (Adjust the day values to match plans.ts at time of incident.)
   SELECT
     p.id, p."planTier",
     COUNT(a.id) FILTER (WHERE a."redactedAt" IS NULL) AS unredacted_old,
     MIN(a."createdAt") FILTER (WHERE a."redactedAt" IS NULL) AS oldest_unredacted
   FROM "Principal" p
   JOIN "AuditEvent" a ON a."principalId" = p.id
   WHERE a."createdAt" < NOW() - CASE p."planTier"
     WHEN 'FREE' THEN INTERVAL '30 days'
     WHEN 'DEVELOPER' THEN INTERVAL '90 days'
     WHEN 'GROWTH' THEN INTERVAL '365 days'
     WHEN 'TEAM' THEN INTERVAL '365 days'        -- ADR-0014 alias
     WHEN 'SCALE' THEN INTERVAL '365 days'       -- ADR-0014 alias
     WHEN 'ENTERPRISE' THEN INTERVAL '730 days'  -- per OD-004 default (7y for SOC2)
   END
   GROUP BY p.id, p."planTier"
   HAVING COUNT(a.id) FILTER (WHERE a."redactedAt" IS NULL) > 0
   ORDER BY oldest_unredacted ASC NULLS LAST
   LIMIT 20;
   ```

   Any row → retention is behind for that principal. Older `oldest_unredacted` = more compliance exposure.

3. **Check the meta-event chain — every redaction emits one.**

   ```sql
   SELECT COUNT(*) AS meta_events_today
   FROM "AuditEvent"
   WHERE "eventType" = 'audit.redacted'
   AND "createdAt" > CURRENT_DATE;
   ```

   If retention fired today, `meta_events_today` should equal the count of redacted events. Mismatch = chain meta-event missing for some redactions (audit-of-audit broken).

4. **Inspect the service interval handle.**

   ```bash
   railway run -s okoro-api -- node -e "
     const { AuditRetentionService } = require('./dist/modules/compliance/audit-retention.service');
     // The service may not be inspectable this way without the running NestJS context.
     // Better path: tail logs for the 'audit-retention: tick' log line.
   "
   railway logs -s okoro-api | rg -F 'audit-retention' | tail -10
   ```

## Mitigate

- **Cron skipped (no errors)**: trigger a manual run via the operator CLI, dry-run first to confirm scope:

  ```bash
  pnpm --filter @okoro/scripts run audit-retention -- --dry-run
  pnpm --filter @okoro/scripts run audit-retention   # commit
  pnpm --filter @okoro/scripts run audit-retention -- --principal-id=<id>  # narrow
  ```

  Exit codes: 0 = clean, 1 = errors during run, 2 = config issue, 3 = nothing to do.

- **Mid-batch crash**: `runOnce()` is paginated (100 principals at a time, 1000 events per redact batch). Re-run is idempotent — already-redacted events skip per the round 15 design. Just re-invoke `pnpm audit-retention`.

- **Meta-event missing**: do NOT manually insert an audit event to fill the gap (would be an out-of-band write, see `audit-chain-break.md`). Instead, file the gap as an evidence note and ensure future redactions emit the meta-event correctly.

- **Self-arming `setInterval` (round-15 interim) failed silently**: the service uses `setInterval` because `@nestjs/schedule` wasn't yet wired (Terminal H per `docs/TERMINAL_ORCHESTRATION.md`). When schedule lands, this becomes `@Cron(CronExpression.EVERY_DAY_AT_3AM)` and gains framework lifecycle introspection. Until then, watch for the `unref()` interval being killed by SIGTERM during a deploy without the next replica's interval registering — the `ShutdownService` integration is supposed to drain it cleanly; if it didn't, file an issue.

## Eradicate

- After the gap is closed, audit how it happened. Common causes:
  - A deploy SIGTERM'd the API process mid-tick and the new replica didn't start a tick on time (could be a 24h gap if the deploy lands right after a tick).
  - The `OKORO_AUDIT_RETENTION_INTERVAL_MS` env var was changed to something unreasonable (e.g., 31 days because someone confused ms and days).
  - A migration changed the `Principal.planTier` enum but `auditRetentionDays` lookup wasn't updated (drift between `plans.ts` and the service).
- Add or verify the alert: a flat `okoro_audit_retention_events_redacted_total` for > 25h with traffic flowing.
- After Terminal H lands `@nestjs/schedule`, this runbook's "Mitigate" section can drop the manual interval-management notes — `@Cron` makes it framework-lifecycle managed.

## Verify recovery

```promql
# Counter must increment within 25h after the first incident-time tick.
increase(okoro_audit_retention_events_redacted_total[26h]) > 0
```

Plus the SQL query in Diagnose step 2 returns zero rows for the affected principals.

## Escalate

- **Compliance officer notification within 24h** if any principal's retention was > 7 days late. SOC2 reportable.
- **Customer notification within 48h** if the principal asked for an Art.17 erasure that was delayed by the failure.
- **`${ESCALATION_CONTACT}`** if a chain meta-event is missing — that's a security incident (audit-of-audit broken).

## Postmortem trigger

- **Yes** if retention was > 7 days late on any principal.
- **Yes** if any chain meta-event is missing for a redacted event.
- **Yes** if the failure was caused by a config drift (e.g., env var mistake, plan tier enum drift).
- **No** for a single missed tick that recovered within 25h with no compliance breach.

## See also

- Round 15 handoff: `docs/SESSION_HANDOFF.md` 2026-05-05 entry, Lane 3.
- Code: `apps/api/src/modules/compliance/audit-retention.service.ts`, `scripts/run-audit-retention.ts`.
- Tests: `audit-retention.service.spec.ts` (13 tests).
- ADR-0006 (audit redactability), ADR-0014 (pricing tiers — `auditRetentionDays` per tier).
- Related runbook: [`audit-chain-break.md`](./audit-chain-break.md).
