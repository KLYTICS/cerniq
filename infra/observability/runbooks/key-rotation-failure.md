# Runbook — API key rotation failure

## Alert

- **Names**: `ApiKeyRotationFailureRate` (warning),
  `ApiKeyExpiredAuthSpike` (warning) — *both not yet emitted; flip on
  metric land per round 15 backlog*.
- **Group**: `aegis.auth`
- **File**: `infra/observability/alerts/aegis.rules.yml`
- **Source**: round-15 rotation surface — `apps/api/src/modules/auth/api-key-rotation.controller.ts`, `api-key.service.ts.rotate()`, `api-key.guard.ts`.

## Symptom

One or more of:
1. `POST /v1/principals/me/api-keys/rotate` returning 5xx at > 0.1/s for 5 min.
2. Auth guard surfacing `EXPIRED_API_KEY` error code at > 1% of inbound auth attempts (the customer-visible signal that someone is using a rotated-out key past its 24h overlap window).
3. `AlreadyRotatedError` (HTTP 409) firing — a principal tried to rotate twice within their overlap window.
4. The rotation transaction failed mid-flight: a new key was created but the old key's `expiresAt` wasn't set, leaving two active keys without an expiry boundary.

## Impact

- **Customer integrations break silently**. A rotated-out key returns 401 with `EXPIRED_API_KEY` — debuggable, but every minute of confusion is a customer support ticket.
- **Audit gap**: `api_key.rotated` event must be emitted via `AuditService` per round 15 design. A failed rotation that didn't emit the event is an evidence gap (SOC2 CC6.1 — access management).
- **Two active keys without expiry** (mid-transaction failure mode): violates the round-15 contract that exactly one rotation chain exists at a time. Defense-in-depth was added at controller AND service to prevent this; if it still happens, both layers were bypassed (security incident).
- **Plaintext leak risk**: the rotate endpoint returns the new key plaintext ONCE. If it's ever logged, captured by an APM tool, or returned in an error envelope, that key is compromised — see "Mitigate" below.

## Diagnose

1. **Confirm the symptom in metrics.**

   ```promql
   sum(rate(http_requests_total{path="/v1/principals/me/api-keys/rotate", status=~"5.."}[5m]))
   sum(rate(http_requests_total{path="/v1/principals/me/api-keys/rotate"}[5m]))
   sum(rate(api_key_auth_total{result="expired"}[5m])) / sum(rate(api_key_auth_total[5m]))
   ```

   The first two give success rate of the rotation endpoint. The third gives the customer-visible expired-rate. Round 15 metric naming may be `aegis_api_key_*` — confirm via `metrics.service.ts`.

2. **Pull the rotation audit events to see the chain state.**

   ```bash
   railway run -s aegis-api -- psql "$DATABASE_URL" -c "
     SELECT id, \"createdAt\", \"principalId\", payload
     FROM \"AuditEvent\"
     WHERE \"eventType\" = 'api_key.rotated'
     ORDER BY \"createdAt\" DESC
     LIMIT 20;"
   ```

   Each event's `payload` should include `{oldKeyId, newKeyId, overlapHours, oldKeyExpiresAt}`. Plaintext should NEVER appear. If you see plaintext-looking strings, **escalate immediately**.

3. **Check for orphan two-active states (the bug class).**

   ```sql
   -- A principal with > 1 ApiKey where expiresAt IS NULL or > now.
   -- Should be exactly 1 (the new key) for any principal mid-rotation,
   -- 2 only during the overlap window with old.expiresAt > now.
   SELECT "principalId", COUNT(*) AS active_keys,
          MIN("expiresAt") AS earliest_expiry,
          MAX("expiresAt") AS latest_expiry
   FROM "ApiKey"
   WHERE "expiresAt" IS NULL OR "expiresAt" > NOW()
   GROUP BY "principalId"
   HAVING COUNT(*) > 2;
   ```

   Any row returned here is an anomaly. > 2 active keys means the controller/service guards both bypassed.

4. **Check for `AlreadyRotatedError` (409) spike — the cooperative case.**

   ```promql
   sum(rate(http_requests_total{path="/v1/principals/me/api-keys/rotate", status="409"}[5m]))
   ```

   High 409 rate is usually a customer's automation (CI key rotation script run from N parallel jobs). Reach out — they need to coordinate their rotation calls.

## Mitigate

- **Mid-transaction failure (two-active without expiry)**: manually set the older key's `expiresAt` to `NOW() + INTERVAL '24 hours'` to restore the overlap-window invariant.

  ```sql
  UPDATE "ApiKey"
  SET "expiresAt" = NOW() + INTERVAL '24 hours'
  WHERE "principalId" = '<id>'
    AND "id" = '<older_key_id>'
    AND "expiresAt" IS NULL;
  ```

  Then audit-emit a meta-event so the chain reflects the manual fix.

- **Plaintext leak suspected** (logs / APM captured the new key string):
  1. Immediately revoke the affected key: `UPDATE "ApiKey" SET "revokedAt" = NOW(), "expiresAt" = NOW() WHERE id = '<key_id>';`
  2. Force the principal to re-rotate via support outreach.
  3. Sweep all log destinations (Railway logs, datadog, etc.) for the leaked string and purge.
  4. Audit `api-key.service.ts.rotate()` — round 15 design returns plaintext in the `key` field of the response and the audit payload uses ONLY the id. If a logger ever captured the response body, that's the leak vector.

- **High `EXPIRED_API_KEY` rate from a single principal**: customer hasn't migrated to the new key. Send a Slack/email reminder with the expected expiration timestamp; confirm they have a working integration with the new key.

- **Rotation endpoint 5xx**: usually transactional failure (Postgres conflict, network blip). Restart API replicas one-by-one if `prisma.$transaction` calls are stuck. Confirm Postgres health (`pg_stat_activity` for long-running tx).

## Eradicate

- File a postmortem if the orphan-two-active state was observed (the controller AND service guards were both bypassed — that's a security regression).
- Add a recurring monitoring query (above) to alert on > 2 active keys per principal as a permanent gate.
- If the root cause was a `AlreadyRotatedError` spike from a customer's automation, document the rotation contract explicitly in `docs/PARTNER_ONBOARDING.md` (single rotation per overlap window).

## Verify recovery

```promql
# Rotation endpoint must succeed at > 95% for 15 min.
sum(rate(http_requests_total{path="/v1/principals/me/api-keys/rotate", status=~"2.."}[5m])) /
  sum(rate(http_requests_total{path="/v1/principals/me/api-keys/rotate"}[5m])) > 0.95

# Customer-visible expired rate < 0.1% for 15 min.
sum(rate(api_key_auth_total{result="expired"}[5m])) /
  sum(rate(api_key_auth_total[5m])) < 0.001
```

Plus the SQL "two active without expiry" query (Diagnose step 3) returns zero rows.

## Escalate

- **Plaintext leak**: page `${ESCALATION_CONTACT}` immediately + notify operator (Erwin) within 5 min. This is a P0 security incident.
- **Audit event missing** for any successful rotation: notify compliance officer; SOC2 evidence gap.
- **Two-active-without-expiry** state observed: page `${ESCALATION_CONTACT}` (defense-in-depth bypass = security incident).

## Postmortem trigger

- **Yes** if any plaintext leak is observed.
- **Yes** if the two-active-without-expiry state was reached (defense-in-depth bypass).
- **Yes** if an `api_key.rotated` audit event is missing for a successful rotation.
- **No** for routine `AlreadyRotatedError` (409) bursts from customer automation — coordinate with the customer.

## See also

- Round 15 handoff: `docs/SESSION_HANDOFF.md` 2026-05-05 entry, Lane 2.
- Code: `apps/api/src/modules/auth/api-key-rotation.controller.ts`, `api-key.service.ts`.
- Tests: `api-key-rotation.controller.spec.ts`, `api-key.service.rotation.spec.ts`.
