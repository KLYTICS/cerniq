# OKORO — Security incident runbook

> The on-call playbook. Pageable scenarios link here from
> `infra/observability/alerts/okoro-security.rules.yml`. Each section is
> a procedure, not prose — read top-to-bottom.
>
> **Severity legend**: 🔴 Page now · 🟠 Engage in working hours · 🟡 Track + monitor.

---

## Table of contents

1. [Authentication failure spike](#authentication-failure-spike) 🔴
2. [Token replay detected](#token-replay-detected) 🔴
3. [Cross-tenant attempt](#cross-tenant-attempt) 🔴
4. [Audit append failures](#audit-append-failures) 🔴
5. [Cache write failure](#cache-write-failure) 🟠
6. [Replay cache outage](#replay-cache-outage) 🔴
7. [Spend guard outage](#spend-guard-outage) 🔴
8. [Webhook DLQ filling](#webhook-dlq-filling) 🟠
9. [Signing key not loaded](#signing-key-not-loaded) 🔴
10. [Signing key rotation](#signing-key-rotation) 🟠
11. [Rate limit heavy](#rate-limit-heavy) 🟡
12. [Suspected key compromise](#suspected-key-compromise) 🔴
13. [Audit chain integrity breach](#audit-chain-integrity-breach) 🔴
14. [GDPR Art. 17 erasure request](#gdpr-art-17-erasure-request) 🟠
15. [Pre-rotation checklist](#pre-rotation-checklist)

---

## Authentication failure spike

**Trigger**: `OKORO_API_KEY_FAILURE_SPIKE` — > 5 INVALID_SIGNATURE/sec for 5 min from one principal.

**Hypothesize**:
1. Stolen API key + brute-forced tokens.
2. Customer SDK upgrade broke their token signing.
3. `@noble/ed25519` regression (very rare; check release notes).

**Triage** (5 min):

```bash
# 1. Identify the noisy principal.
psql $DATABASE_URL -c "
  SELECT \"principalId\", count(*)
    FROM \"AuditEvent\"
   WHERE timestamp > now() - interval '15 minutes'
     AND decision = 'DENIED' AND \"denialReason\" = 'INVALID_SIGNATURE'
   GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
"

# 2. Pull the failing source IPs (if logs ship to your aggregator).
# Look for whether all failures come from one IP (broken integration)
# or many IPs (distributed brute force).

# 3. Check noble-ed25519 version + recent release notes.
pnpm why @noble/ed25519
```

**Mitigate**:

- Single broken integration → message the principal owner; suggest
  re-issuing the API key.
- Distributed brute force → revoke the suspect API key:
  `POST /v1/agents/<id>/revoke` from the dashboard, OR
  ```sql
  UPDATE "ApiKey" SET "revokedAt" = now()
   WHERE id = '<the-key-id>';
  ```
  Then bust the cache:
  `redis-cli DEL apikey:<keyHash>`.
- Library regression → roll back the offending package version + open
  an issue with @paulmillr.

**Resolve when**: failure rate drops below 1/sec for 10 min.

---

## Token replay detected

**Trigger**: `OKORO_REPLAY_DETECTED` — > 1 ANOMALY_FLAGGED/sec for 2 min.

**Hypothesize**: an attacker captured a valid agent token and is
replaying it. (The replay-cache is rejecting them — defense working.)

**Triage** (5 min):

```bash
# Identify the agent.
psql $DATABASE_URL -c "
  SELECT \"agentId\", count(*)
    FROM \"AuditEvent\"
   WHERE timestamp > now() - interval '15 minutes'
     AND \"denialReason\" = 'ANOMALY_FLAGGED'
   GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
"

# Pull the source IPs of the replays — if same IP, they have the
# token; if many IPs, the token may be in someone's pastebin.
```

**Mitigate**:
1. Revoke the affected agent: `POST /v1/agents/<id>/revoke`.
2. Force a re-handshake on the legitimate caller (rotate their keypair).
3. Notify the principal owner — they've had a credential exposed.
4. Add the IP(s) to the WAF deny-list at the Cloudflare layer.

**Forensic**: check the audit chain for the agent — what merchants did
the replays target? Is there a financial impact to refund?

---

## Cross-tenant attempt

**Trigger**: `OKORO_CROSS_TENANT_ATTEMPT` — non-zero rate of
`okoro_authorization_denied_total{reason="cross_tenant"}`.

**Treat as compromise** until proven otherwise.

**Triage** (immediate):

```bash
# 1. Find the calling key.
grep "cross_tenant" /var/log/okoro-api/*.log | tail -100

# 2. Identify the target principal vs. the calling principal.
# If the target principal is a high-value account, escalate.
```

**Mitigate**:
1. Revoke the calling API key immediately.
2. Lock the calling principal's account (set `Principal.locked = true`
   in the schema — TODO: peer's `Principal` model may need this column).
3. Notify the principal owner via email + force a password reset (Auth0
   side once the bridge ships).

**Forensic**: pull the full audit log for the calling principal over the
last 30 days. Look for other anomalies (geographic shifts, unusual spend
patterns, anomalous BATE signal sources).

---

## Audit append failures

**Trigger**: `OKORO_AUDIT_APPEND_FAILURE_SPIKE` — > 0.1 audit failures/sec for 5 min.

**Stop**: every failed append is a compliance gap. Pause writes to
`AuditEvent` ASAP if root cause unclear.

**Triage**:

```bash
# 1. Check Postgres advisory-lock contention.
psql $DATABASE_URL -c "
  SELECT * FROM pg_locks WHERE locktype = 'advisory' LIMIT 50;
"

# 2. Confirm the audit signing key is loaded.
curl -s https://api.okorolabs.io/v1/health/ready | jq .signing_key_loaded

# 3. Check for schema drift — did a recent migration not apply?
psql $DATABASE_URL -c "SELECT * FROM \"_prisma_migrations\" ORDER BY \"finished_at\" DESC LIMIT 5;"
```

**Mitigate**:
- Lock contention → pause the loudest tenant temporarily; let the queue
  drain; investigate why one principal generates so many concurrent
  appends.
- Signing key missing → re-load env var + restart the API container.
  See `signing-key-not-loaded`.
- Schema drift → run `pnpm --filter @okoro/api prisma:migrate deploy`
  manually + verify the failing column.

**Compliance**: file a SOC2 incident note with the gap window — every
event in the affected window is unverifiable.

---

## Cache write failure

**Trigger**: `OKORO_CACHE_SET_FAILURE_SPIKE` — > 1/sec for 5 min on any op.

🟠 Working-hours response. The verify path will start hitting Postgres
on every call. Latency degrades but correctness holds.

**Triage**:

```bash
redis-cli ping
redis-cli info clients
redis-cli info memory
redis-cli config get maxmemory-policy
```

**Mitigate**:
- Redis OOM → bump memory or change eviction to `allkeys-lru`.
- Network partition → restart Redis client connection on the API side.
- Type-mismatch errors → check the offending op label; a new code path
  may be writing the wrong type to a key prefix.

---

## Replay cache outage

**Trigger**: `OKORO_REPLAY_CACHE_FAIL_CLOSED` — > 10 ANOMALY_FLAGGED/sec for 2 min.

🔴 Critical: every verify is failing closed. Customer impact = total
verify outage.

**Triage** (immediate):

```bash
redis-cli ping  # if this fails, Redis is gone
```

**Mitigate**:
- Redis down → restore Redis (the highest priority); the verify path
  will recover automatically as the cache reopens.
- Don't tempt fate by switching to fail-open. The replay-cache is
  fail-closed by design (`replay-cache.service.ts:14-16`).

**Comms**: status page update within 5 min.

---

## Spend guard outage

**Trigger**: `OKORO_SPEND_GUARD_UNAVAILABLE` — > 0.5/sec for 5 min.

🔴 Customers can't transact (commerce verifies fail closed on
`SPEND_LIMIT_EXCEEDED`).

**Triage**:

```bash
# Both Redis AND Postgres must be reachable for spend-guard.
redis-cli ping
psql $DATABASE_URL -c "SELECT count(*) FROM \"SpendRecord\" WHERE date > now() - interval '1 day';"
```

**Mitigate**: same as above — restore the data layer.

---

## Webhook DLQ filling

**Trigger**: `OKORO_WEBHOOK_DELIVERY_DLQ_FILL` — > 0.05/sec dead-lettered.

🟠 Working hours.

**Triage**:

```sql
SELECT event, count(*)
  FROM "WebhookDelivery"
 WHERE status = 'ABANDONED'
   AND "createdAt" > now() - interval '1 day'
 GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
```

**Mitigate**:
- One subscriber bad → contact the principal; they likely have a
  broken endpoint.
- Many subscribers bad → suspect OKORO-side: check our outbound HMAC
  signature, retry timing, payload format.

---

## Signing key not loaded

**Trigger**: `OKORO_AUDIT_SIGNING_KEY_MISSING` — `okoro_signing_key_loaded{type="audit"} == 0`.

**Triage**:

```bash
# Confirm env var is set in the running container.
railway run env | grep -E '^OKORO_SIGNING_(PRIVATE|PUBLIC)_KEY='

# Confirm the JWKS endpoint resolves the right kid.
curl -s https://api.okorolabs.io/.well-known/jwks.json | jq .keys
```

**Mitigate**:
- Env var missing → set it from the secret manager + restart container.
- Env var present but wrong format → re-mint via
  `pnpm tsx scripts/generate-okoro-keys.ts --format both --out .local/keys`
  and load.
- Loud failure expected — the API refuses to boot without a key in
  production (`config.service.ts` validation).

---

## Signing key rotation

**Trigger**: `OKORO_SIGNING_KEY_NEAR_ROTATION` — key > 60 days old.

🟠 Schedule a rotation maintenance window in the next 7 days.

**Procedure**:

1. **Generate the next keypair** locally:
   ```bash
   pnpm tsx scripts/generate-okoro-keys.ts --format both --out .local/next-keys
   ```
   The script outputs the kid in JSON. Note it.
2. **Add the next key to the JWKS endpoint** without removing the
   current one. Both keys live in the JWKS array during the cutover —
   verifiers caching by kid keep working.
3. **Switch the signer** to the new key. New audit chain entries are
   signed with the new key; old chain entries continue to verify under
   the old key (still in JWKS).
4. **Wait one TTL cycle** of the JWKS Cache-Control max-age (1 hour
   per `wellknown.controller.ts`). Verifiers refresh.
5. **Remove the old key** from JWKS.
6. **Update `OKORO_SIGNING_KEY_ROTATED_AT`** env var to the rotation
   timestamp. The `okoro_signing_key_age_seconds` metric resets.

Document the rotation in `docs/decisions/` if it was for a non-routine
reason (compromise, algorithm change, regulatory).

---

## Rate limit heavy

**Trigger**: `OKORO_RATE_LIMIT_HEAVY` — > 50% 4xx for 10 min on a route.

🟡 Track. Investigate within 24 h.

**Triage**:

- Distinguish "broken integration" (one principal sending malformed
  bodies) from "abuse" (many sources hammering the same route).
- Look at the route — `/v1/verify` getting 4xx is normal at moderate
  rates (denials count as 200, not 4xx; here we're talking about
  validation failures).

---

## Suspected key compromise

**Whether or not** an alert fired, if you have grounds to believe an
OKORO-issued key is compromised:

1. **Immediately revoke**:
   ```bash
   curl -X DELETE https://api.okorolabs.io/v1/agents/<id> \
     -H "X-OKORO-API-Key: <admin-key>"
   ```
   Verifiers see the agent as REVOKED within 60s (cache TTL).
2. **Bust the cache** to drop that 60s window:
   `redis-cli DEL agent:<id> agent:status:<id>`.
3. **Notify** the principal owner; require a re-handshake.
4. **Audit** the agent's recent activity (last 30 days):
   ```sql
   SELECT decision, "denialReason", "merchantDomain", count(*)
     FROM "AuditEvent"
    WHERE "agentId" = '<id>'
      AND timestamp > now() - interval '30 days'
    GROUP BY 1, 2, 3 ORDER BY 4 DESC;
   ```
5. **File** a security event in Linear with severity `high`.

---

## Audit chain integrity breach

If a chain-verify against the published JWKS public key fails on any
event, the chain is potentially corrupted.

**Do not** attempt to "fix" a chain by recomputing signatures —
that's destroying evidence.

**Procedure**:

1. **Snapshot** the affected DB rows immediately:
   ```sql
   COPY (SELECT * FROM "AuditEvent" WHERE timestamp > '<window-start>')
     TO '/tmp/audit-snapshot.csv' CSV HEADER;
   ```
2. **Stop writes** to the affected agent's audit chain (peer's
   advisory-lock makes this naturally rare; if it happens, halt the
   agent).
3. **Identify** whether the break is from:
   - Storage corruption (run `pg_amcheck` on AuditEvent).
   - Application bug writing the wrong signature (check recent deploys).
   - Insider mutation (check `pg_audit` logs for UPDATE/DELETE on
     `AuditEvent` outside the redact session-var path — see
     `migrations/20260502000300_audit_redact_session_var/migration.sql`).
4. **Notify** legal + the principal owner. Compliance disclosure obligation.

---

## GDPR Art. 17 erasure request

When a principal owner requests erasure of personal data referenced in
audit rows:

1. Confirm the request is legitimate (verified email; verified Auth0
   session if Auth0 bridge is live).
2. Identify the affected rows:
   ```sql
   SELECT id FROM "AuditEvent"
    WHERE "principalId" = '<principal>'
      AND <conditions referencing the data subject>;
   ```
3. **Use `AuditService.redact()`** — never raw `UPDATE`. The trigger
   from `migrations/20260502000300_audit_redact_session_var/migration.sql`
   only allows column-whitelisted UPDATEs inside a session-var-authorized
   transaction. Direct UPDATE will throw P0001.
4. The redact operation NULLs the raw value columns
   (`action`, `relyingParty`, `requestedAmount`, `policySnapshot`),
   sets `redactedAt` + `redactionReason`, leaves the hashes + signature
   intact. The chain remains verifiable.
5. Emit an `okoro.compliance.audit_amendment` event for the bookkeeping
   trail.
6. Respond to the requester within 30 days per Art. 12(3).

---

## Pre-rotation checklist

Before rotating any signing key (audit, JWT, webhook HMAC):

- [ ] New key generated in dedicated secret manager (KMS, Railway
      secrets, AWS Secrets Manager). Never on a developer laptop.
- [ ] kid recorded in operator log + ADR (if rotation reason is
      non-routine).
- [ ] JWKS endpoint serves both old and new keys for a cutover window
      (1 h minimum, 24 h recommended).
- [ ] Verifier libraries (relying-party SDKs) confirm they refresh
      JWKS at the documented Cache-Control interval.
- [ ] Status-page note prepared (low-severity).
- [ ] Roll-back plan: how to revert if the new key turns out to
      be wrong (return to old key as the active signer; new key was
      only published, not yet used to sign anything).

---

## Document maintenance

- Review every quarter.
- After every paged incident, append a "Lessons" section to the
  relevant procedure.
- Cross-reference any change with `docs/SECURITY.md` and the
  appropriate ADR.
