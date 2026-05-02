# Runbook — Audit chain break / append failure

## Alert

- **Names**: `AuditChainAppendFailureRate` (critical),
  `AuditAppendStalled` (critical)
- **Group**: `aegis.audit`
- **File**: `infra/observability/alerts/aegis.rules.yml`

## Symptom

Either:
1. `aegis_audit_append_total{result="error"}` is incrementing at
   > 0.01/s for 5 min — appends are throwing.
2. Or: verify traffic is flowing but audit appends have been zero
   for 10 min — appends are silently not happening.

## Impact

This is the highest-severity alert in the system. **Read carefully.**

- **SOC2 CC7.2** mandates complete audit logs of access decisions.
  Every failed or missing append is an irrecoverable evidence gap on
  that specific event. We cannot reconstruct it later.
- **Cryptographic chain integrity**: each `AuditEvent` row signs over
  `{prev_sig || canonical(event)}` (`CLAUDE.md` invariant § 3). A
  missed append breaks the hash chain — the next successful append
  references a `prev_sig` that no longer corresponds to the most
  recent observed event, which is detectable at audit time and
  damaging.
- **Customer trust + contract breach**: enterprise contracts include
  audit-log durability commitments (`docs/SLO.md` § 1: 100% durability
  with enumerable DLQ).

There is no "minor" version of this alert. Treat every firing as P0.

## Diagnose

1. **Confirm the alert is current.**

   ```promql
   sum(rate(aegis_audit_append_total{result="error"}[5m]))
   sum(rate(aegis_audit_append_total[5m]))
   sum(rate(aegis_verify_total[5m]))
   ```

   Compare verify rate to audit append rate. They should be ~equal
   for approved verifies (denials don't all chain).

2. **Pull recent error logs from `AuditService`.**

   ```bash
   railway logs -s aegis-api | rg -F 'audit.service' | tail -50
   railway logs -s aegis-api | rg -iF 'audit append failed|chain break|signature' | tail -50
   ```

   Common error signatures:
   - `AUDIT_SIGNING_KEY_MISSING` — the env var is unset or rotated
     out from under the running process.
   - `PrismaClientKnownRequestError ... AuditEvent_pkey` — duplicate
     id, possible clock-skew or id-generation bug.
   - `AUDIT_PREV_SIG_MISMATCH` — a row was inserted out-of-band
     bypassing the service. Possibly a manual `psql` write. Treat as
     a security incident.

3. **Inspect the most recent audit rows directly.**

   ```bash
   railway run -s aegis-api -- psql "$DATABASE_URL" -c "SELECT id, \"createdAt\", \"eventType\", LENGTH(\"prevSig\") AS prev_len, LENGTH(signature) AS sig_len FROM \"AuditEvent\" ORDER BY \"createdAt\" DESC LIMIT 10;"
   ```

   `prev_len` and `sig_len` should be constant (Ed25519 sig = 64 bytes
   raw / 88 chars base64). A null or short value indicates a write
   that bypassed signing.

4. **Confirm the signing key is loaded.**

   ```bash
   railway run -s aegis-api -- node -e 'console.log(!!process.env.AEGIS_SIGNING_PRIVATE_KEY_B64, (process.env.AEGIS_SIGNING_PRIVATE_KEY_B64 || "").length)'
   ```

   Empty/short → secret is missing. Cross-check against the
   `/.well-known/audit-signing-key` endpoint:

   ```bash
   curl -fsSL https://api.aegislabs.io/.well-known/audit-signing-key | jq
   ```

   The `kid` in the JWKS must match the kid the API process computes
   from its loaded private key.

5. **Check Postgres write health.**

   ```bash
   railway run -s aegis-postgres -- psql -c "SELECT count(*) FROM pg_stat_activity WHERE state='active' AND query LIKE '%AuditEvent%';"
   ```

   Long-running blockers → `pg_terminate_backend(<pid>)`.

## Mitigate

**Stop new appends from getting lost first; fix the chain after.**

- **Signing key missing/wrong**: restore the key via Railway env vars
  (`AEGIS_SIGNING_PRIVATE_KEY_B64`); restart the service. The
  `wellknown` module throws at module init if missing, so a missing
  key means the service shouldn't be running — confirm uptime.
- **Postgres write failure**: failover via Railway dashboard if the
  database is unhealthy. If the `AuditEvent` table is the only one
  failing, suspect a constraint violation (recent migration?).
- **Out-of-band write detected** (step 3 found null sigs): immediately
  revoke any `psql` admin credentials that have been used in the last
  24 h; this is a security incident. Lock the table:
  `ALTER TABLE "AuditEvent" DISABLE TRIGGER ALL;` is **wrong** — do
  not disable triggers; instead route all `psql` access through a
  read-only role until investigated.
- **Append-stalled with no errors** (the silent variant): take a heap
  snapshot of the API process — likely a hung BullMQ queue. Restart
  the API replicas one at a time:
  `railway service restart -s aegis-api`.

## Eradicate

- **Always file the postmortem within 24h.** Audit chain breaks always
  postmortem regardless of duration (per `docs/SLO.md` § 3 and
  this runbook's "Postmortem trigger" below).
- **Always verify the chain end-to-end** after recovery using the
  audit verifier (when shipped — `scripts/verify-audit-chain.ts`,
  M-014). Until then, run the manual SQL verification:
  ```sql
  -- Find any row where prevSig doesn't match the previous row's signature
  WITH ordered AS (
    SELECT id, "createdAt", signature, "prevSig",
           LAG(signature) OVER (ORDER BY "createdAt", id) AS expected_prev
    FROM "AuditEvent"
  )
  SELECT id, "createdAt" FROM ordered
  WHERE "prevSig" IS DISTINCT FROM expected_prev
  AND id != (SELECT id FROM "AuditEvent" ORDER BY "createdAt", id LIMIT 1);
  ```
- For evidence-gap events: enumerate the affected `eventId`s; each
  must be marked in the next SOC2 audit cycle as a known incomplete
  record.

## Verify recovery

```promql
# Append rate must be > 0 and error rate must be 0
sum(rate(aegis_audit_append_total{result="ok"}[5m])) > 0
sum(rate(aegis_audit_append_total{result="error"}[5m])) == 0
```

Both must hold for 15 min before declaring recovery. Additionally,
the chain SQL query above must return zero rows.

## Escalate

- **Immediate** — page `${ESCALATION_CONTACT}` (OD-007 pending)
  alongside acknowledgment. This alert never waits 15 min.
- **Within 1 h** — notify the company's compliance officer; SOC2
  evidence gaps are reportable in the next audit cycle.
- **Within 24 h** — customer notification if any specific
  customer's audit rows were affected (queryable from the audit table
  by `principalId`).

## Postmortem trigger

**Always yes.** Audit chain breaks trigger a postmortem regardless of
duration or whether they were customer-reported. SOC2 evidence is the
product; a gap in the evidence is a product defect.
