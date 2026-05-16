# Runbook — Enable Intent Manifest in production

> **ADR-0016** (kernel) + **ADR-0017** (Phase 2 runtime issuance) + **Phase 2.1**
> Postgres adapter (commit `2cabeba`). Flipping `AEGIS_INTENT_MANIFEST_ENABLED=true`
> exposes the `/v1/intent/*` endpoints. This runbook covers the production
> flip sequence with the durable (Postgres) storage backend.

---

## TL;DR

The intent-manifest module is **off by default** in every environment. To
enable it in production with durable storage:

1. Run migration `20260516000000_add_intent_manifest_phase21`.
2. Verify the two tables exist (`IntentManifest`, `IntentActual`).
3. Set `AEGIS_INTENT_MANIFEST_STORAGE=prisma`, roll the API.
4. Set `AEGIS_INTENT_MANIFEST_ENABLED=true`, roll the API again.
5. Smoke-test `POST /v1/intent` against a test principal.
6. Watch metrics + logs for 15 minutes; declare healthy or rollback.

Total wall-clock: ~30 min including two rolls + smoke + observation window.

Rollback: unset `AEGIS_INTENT_MANIFEST_ENABLED`, restart. Data preserved.

---

## Prerequisites

Before starting, confirm ALL of:

- [ ] Phase 2 module commit (`5e44480`) AND Phase 2.1 adapter commit
      (`2cabeba`) both present on the deploy branch.
- [ ] Production Postgres reachable from the API process (test with
      `psql $DATABASE_URL -c 'select 1'`).
- [ ] Operator has permissions to run `prisma migrate deploy` against
      the production DSN (read + write + DDL on the API schema).
- [ ] KMS / audit-signing-key already configured (intent manifests share
      the audit signing key family per ADR-0011 §3 — if the existing
      `/v1/verify` issues tokens cleanly, intent manifests can sign).
- [ ] At least one principal with an API key for smoke testing.
- [ ] Read access to `/metrics` + the structured-log stream.
- [ ] On-call secondary aware of the planned flip window.

---

## The flip sequence

### Step 1 — Run the migration

```sh
DATABASE_URL="<production-dsn>" \
  pnpm --filter @aegis/api prisma:migrate deploy
```

Expected output (last lines):

```
Applying migration `20260516000000_add_intent_manifest_phase21`

The following migration(s) have been applied:

migrations/
  └─ 20260516000000_add_intent_manifest_phase21/
    └─ migration.sql

All migrations have been successfully applied.
```

If `0 migrations applied`: the migration is already present in
`_prisma_migrations` (idempotent — safe). Proceed.

If `Error: P3009` (failed migrations): STOP. The prior migration state
is incoherent; do not flip the gate. Page DBA.

### Step 2 — Verify the tables exist

```sh
psql "$DATABASE_URL" -c '\dt "IntentManifest" "IntentActual"'
```

Expected output (two rows):

```
              List of relations
 Schema |      Name      | Type  | Owner
--------+----------------+-------+--------
 public | IntentActual   | table | aegis
 public | IntentManifest | table | aegis
```

If `Did not find any relation named ...`: migration silently failed.
STOP and investigate before continuing.

### Step 3 — Stage the storage env var (do NOT enable yet)

In your secrets/env manager, set:

```
AEGIS_INTENT_MANIFEST_STORAGE=prisma
```

Do **NOT** set `AEGIS_INTENT_MANIFEST_ENABLED=true` in this step. The
two-stage flip catches a bad value (typo, wrong case) at process boot
**before** any endpoint is exposed. `pickStorageProvider()` throws on
invalid values with a remediation message naming this migration filename
(see `apps/api/src/modules/intent/intent.module.ts:155`).

### Step 4 — Roll the API processes (first roll)

Rolling restart preferred. After restart, verify the gate is still
closed:

```sh
curl -i -H "X-AEGIS-API-Key: $TEST_KEY" \
  https://api.aegis-labs.com/v1/intent
```

Expected: `HTTP/2 404` (route not registered — module is off).

If you see `HTTP/2 500` with a startup error in logs, the storage env
var is wrong; check spelling and restart.

### Step 5 — Enable the module

```
AEGIS_INTENT_MANIFEST_ENABLED=true
```

### Step 6 — Roll the API processes (second roll)

After restart:

```sh
curl -i -H "X-AEGIS-API-Key: $TEST_KEY" \
  -X POST https://api.aegis-labs.com/v1/intent \
  -d '{}'
```

Expected: `HTTP/2 400` (route registered, body validation rejects empty
payload). If you see `HTTP/2 404`, the env var didn't propagate; check
the secrets manager.

### Step 7 — Smoke test

Run the smoke sequence below. If any step doesn't produce the documented
output, **rollback** (see "Rollback" section) and investigate.

---

## Smoke test

Variables to set:

```sh
export AEGIS_BASE="https://api.aegis-labs.com"
export API_KEY="<your test principal's API key>"
export AGENT_ID="<an agent owned by the test principal>"
```

### 7a — Issue an intent manifest

```sh
curl -s -X POST "$AEGIS_BASE/v1/intent" \
  -H "X-AEGIS-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "agentId": "$AGENT_ID",
  "verifyTokenJti": "smoke-test-jti-$(date +%s)",
  "verifyTokenSha256B64Url": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "intent": {
    "kind": "commerce-action",
    "action": "smoke.test",
    "merchantId": "SMOKE",
    "maxCalls": 1,
    "amountCap": { "amount": "10.00", "currency": "USD" }
  },
  "reconciliation": { "strictness": "strict" },
  "ttlSeconds": 60
}
EOF
)" | jq .
```

Expected response (shape, not values):

```json
{
  "manifestId": "int_<26-char-ulid>",
  "signedManifest": {
    "body": { "schemaVersion": 1, "manifestId": "int_...", ... },
    "signingKeyId": "<active-audit-signing-kid>",
    "signatureB64Url": "<86-char-ed25519-sig>"
  },
  "expiresAt": <unix-seconds, ~now + 60>
}
```

Capture `manifestId` for the next step:

```sh
export MANIFEST_ID="<the int_... value from above>"
```

### 7b — Reconcile with clean actuals

```sh
curl -s -X POST "$AEGIS_BASE/v1/intent/$MANIFEST_ID/actuals" \
  -H "X-AEGIS-API-Key: $API_KEY" \
  -H "Idempotency-Key: smoke-clean-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{
    "actuals": [{
      "observedAt": '"$(date +%s)"',
      "kind": "commerce-action",
      "payload": { "action": "smoke.test", "merchantId": "SMOKE", "amount": "7.50", "currency": "USD" }
    }]
  }' | jq .
```

Expected response:

```json
{
  "manifestId": "int_...",
  "actualCount": 1,
  "mismatches": [],
  "recommendedDenialReason": null,
  "idempotencyReplay": false
}
```

### 7c — Reconcile a fresh manifest with mismatch actuals

Repeat step 7a to get a new `MANIFEST_ID`, then:

```sh
curl -s -X POST "$AEGIS_BASE/v1/intent/$MANIFEST_ID/actuals" \
  -H "X-AEGIS-API-Key: $API_KEY" \
  -H "Idempotency-Key: smoke-mismatch-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{
    "actuals": [{
      "observedAt": '"$(date +%s)"',
      "kind": "commerce-action",
      "payload": { "action": "smoke.test", "merchantId": "SMOKE", "amount": "999.99", "currency": "USD" }
    }]
  }' | jq .
```

Expected response (note `recommendedDenialReason` non-null):

```json
{
  "manifestId": "int_...",
  "actualCount": 1,
  "mismatches": [
    { "kind": "over-amount-cap", "detail": "amount 999.99 > cap 10.00", "detectedAt": <ts> }
  ],
  "recommendedDenialReason": "INTENT_MISMATCH",
  "idempotencyReplay": false
}
```

### 7d — Confirm GET returns the manifest

```sh
curl -s "$AEGIS_BASE/v1/intent/$MANIFEST_ID" \
  -H "X-AEGIS-API-Key: $API_KEY" | jq '.status'
```

Expected: `"RECONCILED"` (manifest moved from OPEN → RECONCILED via step 7c).

If smoke 7a–7d all pass with documented output: **the flip is healthy.**
Proceed to observability watch.

---

## Verification — observability for the next 15 min

After smoke, watch the following for 15 minutes before declaring success.

### Metrics

All `aegis_intent_*` metrics live on the standard `/metrics` Prometheus
scrape endpoint (default port).

| Metric                                       | Labels                       | Healthy signal                            |
| -------------------------------------------- | ---------------------------- | ----------------------------------------- |
| `aegis_intent_issued_total`                  | `intent_kind`                | Increments on every successful `POST /v1/intent` |
| `aegis_intent_issue_latency_seconds`         | (histogram)                  | p99 < 100 ms in steady state              |
| `aegis_intent_reconciled_total`              | `outcome`                    | One of: `clean` / `mismatch_advised` / `mismatch_denied` / `replay` |
| `aegis_intent_reconcile_latency_seconds`     | (histogram)                  | p99 < 100 ms in steady state              |
| `aegis_intent_mismatch_total`                | `mismatch_kind`              | Bounded enum (8 values per kernel)        |

Sanity-check queries (Prometheus PromQL):

```promql
# Issuance rate
rate(aegis_intent_issued_total[5m])

# Reconciliation outcome distribution
sum by (outcome) (rate(aegis_intent_reconciled_total[5m]))

# p99 issuance latency
histogram_quantile(0.99, rate(aegis_intent_issue_latency_seconds_bucket[5m]))

# Mismatch kind distribution
sum by (mismatch_kind) (rate(aegis_intent_mismatch_total[5m]))
```

### Structured logs

| Log message                         | When                                              | Healthy signal                  |
| ----------------------------------- | ------------------------------------------------- | ------------------------------- |
| `msg=intent_issued`                 | Per successful issuance                           | One per `POST /v1/intent` 201   |
| `msg=intent_reconciled`             | Per successful reconciliation                     | One per `POST /actuals` 200     |
| `msg=intent_algorithm_failure`      | Typed algorithm error (collision, conflict, etc.) | Only on expected denial paths   |
| `msg=intent_unexpected_failure`     | Unmapped exception bubbled up                     | **Should be zero in steady state** |
| `[intent] bate.ingestSignal rejected ...` | BATE signal ingestion failure                | Should be zero — investigate if non-zero |

### BATE feedback loop check

After step 7c (mismatch), confirm the agent's trust score dropped:

```sh
curl -s "$AEGIS_BASE/v1/agents/$AGENT_ID" \
  -H "X-AEGIS-API-Key: $API_KEY" | jq '{trustScore, trustBand}'
```

Expected: `trustScore` reduced by ~100 points vs. pre-smoke baseline
(`INTENT_MISMATCH_OBSERVED` carries a -100 delta with 300-cap per
`apps/api/src/modules/bate/bate.weights.ts:57`).

---

## Rollback

If anything looks wrong during smoke or the 15-min observation window:

### Quick rollback — disable the module

```
AEGIS_INTENT_MANIFEST_ENABLED=false
```

Roll the API processes. Data preserved. The `/v1/intent/*` endpoints
silently 404 again; existing IntentManifest + IntentActual rows remain
for forensics.

### Full rollback — drop the tables (DESTRUCTIVE)

Only if you also want to remove all stored manifest data:

```sql
-- DESTRUCTIVE — pause to confirm you want this
BEGIN;
  DROP TABLE "IntentActual";  -- FK side first
  DROP TABLE "IntentManifest";
  DROP TYPE  "IntentManifestStatus";
COMMIT;
```

Note: existing `INTENT_MISMATCH_OBSERVED` rows in `BateSignal` REMAIN
even after dropping the intent tables. This is intentional — invariant
#3 (audit append-only): BATE signals are historical evidence, not
state. The trust-score impact persists.

### Migration rollback

The migration is forward-only by Prisma convention. To "un-apply" it,
mark it rolled-back in `_prisma_migrations` and `DROP` the tables/enum.
The schema.prisma file would also need a revert commit. Prefer the
quick rollback above unless there's a schema-level corruption.

---

## Common failures

### `AEGIS_INTENT_MANIFEST_STORAGE must be 'memory' or 'prisma'`

**Cause:** typo in env var (e.g. `Prisma`, `postgres`, empty).
**Fix:** re-check the env var value; restart.

### `relation "IntentManifest" does not exist`

**Cause:** migration didn't run, or ran against a different database.
**Fix:** confirm `$DATABASE_URL` resolves to the right host/db; re-run
`prisma migrate deploy`; confirm with `\dt`.

### `INTENT_MISMATCH` denial without an audit event in the chain

**Cause:** the audit signer is failing silently (KMS auth issue?).
**Fix:** check `aegis_audit_append_total{result="failed"}` and
`msg=audit_signer_failure` logs. Intent issuance falls back to the
audit signing key family; if audit chain is broken, intent fails too.

### Trust score not dropping on mismatch

**Cause:** BATE ingestion is fire-and-forget (per design — must not
block reconciliation). Failures are WARN-logged but not propagated.
**Fix:** grep logs for `[intent] bate.ingestSignal rejected
INTENT_MISMATCH_OBSERVED:` to see why. Usually one of:
  - `BateService.ingestSignal` rejecting the new signal type (older
    deploy without `INTENT_MISMATCH_OBSERVED` in the Prisma enum)
  - Rate limit on the BATE side
  - Database connection issue

### `idempotency_conflict` on retry

**Cause:** a previous reconcile call with the same `Idempotency-Key`
but **different** actuals body. This is the contract — operators
must NOT recycle Idempotency-Key values across distinct reconcile
attempts.
**Fix:** the calling code must generate a fresh key per distinct
reconcile attempt. Idempotency-Key is for retry-safety, not for
multiple reconciliations.

### Migration applied but POST /v1/intent returns 500

**Cause:** PrismaModule resolved but tables somehow not visible to
the Prisma client (schema drift between code and DB).
**Fix:** run `pnpm --filter @aegis/api prisma:generate` against the
production schema; re-deploy the API artifact (the client is generated
at build time).

---

## Escalation

Page secondary on-call if any of these occur after the flip:

- **p99 latency on `/v1/verify` increases by >20%.** Intent issuance
  shares the audit signer; a slow signer cascades to verify.
- **Audit chain divergence detected post-enable** (check the periodic
  `aegis_audit_chain_verifier` job's output).
- **KMS error rate spikes on the intent-signing path** specifically.
- **`msg=intent_unexpected_failure` rate goes non-zero**: there's an
  unmapped exception bubbling up. Capture the structured log entry
  and the request id; the algorithm should produce typed failures, so
  unexpected ones are bugs.

Coordination notes:

- This module shares the audit signing key family — audit chain
  problems will manifest as intent issuance problems.
- The `INTENT_MISMATCH_OBSERVED` BATE signal feeds the existing
  `TRUST_SCORE_TOO_LOW` denial path on `/v1/verify`. Spike in
  intent mismatches → expect a downstream rise in `TRUST_SCORE_TOO_LOW`
  denials on verify (intentional — the cross-RP penalty travel).

---

## Reference

| Artifact                                         | Purpose                                       |
| ------------------------------------------------ | --------------------------------------------- |
| `docs/decisions/0016-intent-manifest-kernel.md`  | Kernel design + claim shape lock              |
| `docs/decisions/0017-intent-manifest-runtime-issuance.md` | Phase 2 runtime issuance design (D1/D2/D3) |
| `docs/spec/AEGIS_API_SPEC.yaml`                  | Wire contract for `/v1/intent/*`              |
| `apps/api/src/modules/intent/`                   | Phase 2 NestJS module                         |
| `apps/api/src/modules/intent/intent.adapter.prisma.ts` | Phase 2.1 Postgres adapter (commit `2cabeba`) |
| `apps/api/prisma/migrations/20260516000000_add_intent_manifest_phase21/` | Schema migration |
| `apps/api/src/modules/bate/bate.weights.ts:57`   | `INTENT_MISMATCH_OBSERVED` weight (-100, cap 300) |
| `packages/intent-manifest/`                      | Framework-free kernel (sign + reconcile)      |
| `packages/verifier-rp/src/intent.ts`             | Relying-party offline verification surface    |
| `examples/intent-fintech-acp/`                   | ACP merchant demo                             |
| `examples/intent-treasury-iso20022/`             | Treasury (ISO 20022) demo                     |
| `examples/intent-broker-dealer-finra/`           | Broker-dealer (FINRA Rule 3110) demo          |

### Related runbooks

- `docs/runbooks/denial-reasons.md` — wire-level denial reason catalog
  (includes `INTENT_MISMATCH` at position 11).

### Operator decisions still pending

- **OD-019** — separate intent-signing key family vs. reusing audit
  signing key. Current Phase 2 reuses the audit key family for single-
  rotation simplicity; OD-019 considers defense-in-depth via a separate
  `IntentSignerService`. Until OD-019 lands, intent manifests rotate
  with the audit key family.
- **OD-020** — verify-wire emission of intent decision. Phase 2 keeps
  intent denials in the dedicated `/v1/intent/*` response surface;
  OD-020 considers folding `INTENT_MISMATCH` into `/v1/verify`
  outcomes via the existing wire-level enum.
