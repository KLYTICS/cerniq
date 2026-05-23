# OKORO — Incident Response Runbook

> **Audience:** on-call engineers and SREs operating an OKORO deployment.
> **Sister doc:** [`RUNBOOK.md`](./RUNBOOK.md) covers local development
> and routine operations. THIS doc covers what happens when the alarm
> goes off.
> **Classification:** INTERNAL · ENGINEERING
> **Last updated:** 2026-05-05
> **Pager rotation:** see your team's PagerDuty / Opsgenie schedule.

This document is the on-call playbook. Every section follows the
same shape:

- **Detection** — the signal that wakes you up.
- **Severity** — how loud the alarm should be.
- **Triage** — what to do in the first five minutes.
- **Remediation** — how to make the alarm go away.
- **Post-incident** — what to write down so this doesn't repeat.

---

## Table of contents

1. [Chain integrity break](#1-chain-integrity-break)
2. [KMS rotation](#2-kms-rotation)
3. [Mass agent revocation (compromise response)](#3-mass-agent-revocation)
4. [JWKS endpoint outage](#4-jwks-endpoint-outage)
5. [Verify p99 SLA breach](#5-verify-p99-sla-breach)
6. [Stripe webhook DLQ drain](#6-stripe-webhook-dlq-drain)
7. [GDPR Art. 17 redaction request](#7-gdpr-art-17-redaction-request)
8. [New region rollout](#8-new-region-rollout)
9. [Appendix: severity ladder](#appendix-severity-ladder)

---

## 1. Chain integrity break

### Detection

- `audit-chain-integrity.yml` GitHub Action fails (nightly cron).
- `okoro_audit_chain_break_total` Prometheus counter > 0.
- Slack `#okoro-alerts` posts "OKORO audit chain break detected at row N".
- Customer / regulator opens a ticket: "Your audit verifier rejects row N".

### Severity

**SEV-1.** A chain break is the security claim OKORO exists to make.
Page the on-call engineer AND the security lead immediately. Do
**not** reset, mutate, or "fix" any audit row before the security
lead is on the bridge — the broken row is forensic evidence.

### Triage

```sh
# Reproduce the break independently with the public verifier.
npx @okoro/audit-verifier verify ./export.ndjson \
  --jwks https://api.okoroapp.com/.well-known/audit-signing-key \
  --no-fail-fast --json > triage.json

# Find the first break.
jq '.firstBreak' triage.json
```

Read the `reason` field:

| Reason fragment            | Likely cause                                                               |
| -------------------------- | -------------------------------------------------------------------------- |
| "signature did not verify" | Payload was mutated post-signing (row tampering OR canonicalization drift) |
| "chain link mismatch"      | Row dropped, reordered, OR forged-insert                                   |
| "kid not present in JWKS"  | Key rotation completed before JWKS published                               |

### Remediation

**Tampering / forged insert (SEV-1 security event):**

1. Freeze writes to `AuditEvent` table — set `okoro-api` deployment
   replicas to 0 OR put the API into read-only mode via env flag.
2. Snapshot the database. Preserve the broken row exactly as-is.
3. Page security lead. Begin incident-response per
   `docs/SECURITY.md` § Incident Response.

**Canonicalization drift (regression bug):**

1. Confirm via `pnpm -F @okoro/types spec-sync` that the canonicalize
   algorithm has not changed.
2. Compare the broken row's payload bytes vs. the signature bytes —
   the bug is almost always a new field added to `AuditChainPayload`
   without a payload-version bump.
3. Roll back the offending deploy. The chain past the point of the
   bug needs to be re-signed (operator decision; consult security
   lead — usually it's better to leave the break visible).

**JWKS lag (operator process error):**

1. Verify `/.well-known/audit-signing-key` lists the kid the broken row references.
2. If not — the previous KMS rotation didn't publish the new kid.
   Run `pnpm -F @okoro/api exec tsx scripts/publish-jwks.ts` (or the
   equivalent in your KMS adapter).
3. Re-run the verifier to confirm intactness.

### Post-incident

- Write a public incident report (chain breaks are customer-facing).
- Update CI: add a regression test that catches the canonicalization
  drift via the `canonicalize parity` test in `chain.spec.ts`.
- File an ADR if the resolution requires a payload-version bump.

---

## 2. KMS rotation

KMS rotation rotates the OKORO audit signing key (and, in the future,
JWT signing keys). Rotations are scheduled, not reactive — they
follow the cadence in `docs/RETENTION_POLICY.md` § Key lifecycle.

### Detection

This is a planned operation. Triggered by:

- Quarterly cadence (90 days).
- Compromise response (immediate).
- KMS provider mandates (annual for AWS HSM-backed keys).

### Severity

**SEV-3 planned** for scheduled rotations. **SEV-1** for compromise-
driven rotations (jump to § 3).

### Triage (pre-flight)

```sh
# 1. Confirm the new key is provisioned in the KMS provider.
aws kms list-keys --query 'Keys[?contains(KeyId, `okoro-audit`)]'
# (or the GCP / Vault equivalent)

# 2. Confirm the old key is still listed in JWKS.
curl -s https://api.okoroapp.com/.well-known/audit-signing-key | jq '.keys[].kid'
```

### Remediation (the rotation)

Rotation is dual-key for at least 24 hours. Both old and new kids
appear in JWKS so in-flight rows remain verifiable.

```sh
# 1. Provision the new key in the KMS adapter's expected ARN/path.
#    Set OKORO_AWS_KMS_AUDIT_KID_NEW=<new-kid> in env.

# 2. Restart the API. The AuditSignerService picks up the new active
#    kid; new rows are signed with the new key.
kubectl rollout restart deployment/okoro-api

# 3. Confirm the JWKS lists BOTH old + new kids for the rotation
#    window.
curl -s https://api.okoroapp.com/.well-known/audit-signing-key | jq '.keys'

# 4. After 24h, confirm no in-flight rows still reference the old kid.
psql -c "SELECT signingKeyId, count(*) FROM \"AuditEvent\"
         WHERE \"createdAt\" > NOW() - INTERVAL '1 hour'
         GROUP BY signingKeyId;"

# 5. Mark the old key as expired in JWKS metadata (set expires_at
#    on its JWK). Do NOT remove it from JWKS — old rows still need
#    to verify.
```

### Post-incident

- Update `docs/RETENTION_POLICY.md` § Key lifecycle with the
  rotation date.
- Confirm `audit-chain-integrity.yml` ran successfully against the
  current chain post-rotation.

---

## 3. Mass agent revocation

When a partner is compromised, you need to revoke every agent owned
by their principal in seconds, not minutes. The mass-revoke
procedure is the customer-facing capability that justifies the
"instant revocation" SLA.

### Detection

- Customer report ("our service was breached").
- Anomaly fan-out: > N% of a principal's agents flagged in one window.
- BATE engine emits `okoro.principal.compromised` (M-055 anomaly R-6
  if/when shipped).

### Severity

**SEV-1.** Every minute of delay is an additional minute of agent
authority for the attacker. Run the procedure first, validate after.

### Triage

```sh
# 1. Confirm the principal id from the customer ticket.
PRINCIPAL_ID=pri_xxx

# 2. Snapshot the current agent list for forensics BEFORE revoking.
okoro agents list --principal "$PRINCIPAL_ID" --json > snapshot-$(date +%s).json
```

### Remediation

```sh
# Bulk revoke via admin endpoint (gated by OKORO_ADMIN_TOKEN).
curl -X POST https://api.okoroapp.com/v1/admin/principals/$PRINCIPAL_ID/revoke-all \
     -H "X-OKORO-Admin: $OKORO_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"reason":"compromise_response","ticketId":"INC-2026-0501"}'

# Confirm zero active agents remain.
okoro agents list --principal "$PRINCIPAL_ID" --status active --json | jq '.agents | length'
# expected: 0

# Fan webhooks have already fired by this point. Confirm subscribers
# received `okoro.agent.revoked` events for every revoked agent.
okoro events tail --principal "$PRINCIPAL_ID" --type okoro.agent.revoked --since 5m
```

### Post-incident

- Customer must register fresh agents with new keypairs. Revoked
  agent ids cannot be re-activated (one-way ratchet).
- BATE: every agent involved gets a `policy_violation_attempt` signal
  for the compromise window so future signals from any new agent
  with a similar pattern are weighted appropriately.
- Audit chain captures every revocation row — bundle them as part of
  the customer's post-mortem evidence.

---

## 4. JWKS endpoint outage

Relying parties using `@okoro/verifier-rp` cache the JWKS with stale-
while-revalidate, so a brief outage is invisible. A multi-hour
outage breaks new RP cold-starts.

### Detection

- `okoro_wellknown_uptime` < 99.9% over the rolling 5min window.
- Customer reports: "verifier-rp can't fetch JWKS".

### Severity

**SEV-2** for < 1h; **SEV-1** for > 1h.

### Triage

```sh
# Verify the endpoint serves correctly from your edge.
curl -fsSI https://api.okoroapp.com/.well-known/audit-signing-key
# Expected: 200, Cache-Control: public, max-age=86400, stale-while-revalidate=604800

# Verify it's not an upstream Railway / Cloudflare issue.
curl -fsSI https://api.okoroapp.com/health
```

### Remediation

```sh
# Most outages are caused by the AppConfigService failing to load
# OKORO_SIGNING_PUBLIC_KEY at boot. Check the logs.
kubectl logs deployment/okoro-api | grep -i "OKORO_SIGNING"

# Restart pulls the env from the secret store again. Often resolves
# transient KMS / Vault outages.
kubectl rollout restart deployment/okoro-api
```

If the outage persists, fall back to the static JWKS published in
the GitHub repo at `infra/jwks/okoro-audit-jwks.json` (refreshed on
every key rotation). Customers can pin to the GitHub raw URL as a
backup `--jwks-file` source.

### Post-incident

- Confirm the static GitHub-hosted JWKS is up to date with current
  rotated kids.
- Add the static URL to your customer-facing docs as the documented
  fallback.

---

## 5. Verify p99 SLA breach

The verify hot path SLA is **p99 < 200ms** (see
`docs/CAPACITY_PLAN.md`). Sustained breach is a credibility hit —
agents serving real-time commerce can't tolerate a slow gate.

### Detection

- `okoro_verify_latency_seconds` p99 > 0.2 sustained 10min.
- Customer reports: "verify calls timing out".

### Severity

**SEV-2** if breach is < 2x SLA. **SEV-1** if > 2x or sustained > 1h.

### Triage decision tree

```
p99 spike?
├── DB CPU / connection saturation? → § 5a (DB)
├── Redis latency spike?            → § 5b (Redis)
├── Cold-cache after deploy?        → § 5c (cache)
├── KMS sign latency?               → § 5d (KMS)
└── BATE recompute backpressure?    → § 5e (BullMQ)
```

### 5a. DB saturation

```sh
# Active queries > pool size.
kubectl exec -it $(kubectl get pod -l app=okoro-api -o name | head -1) -- \
  psql -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
```

Resize the connection pool (`OKORO_DB_POOL_MAX`) or scale read
replicas.

### 5b. Redis latency

Verify path uses Redis for spend counters + replay cache. Slow
Redis = slow verify. Check the Upstash / ElastiCache dashboard for
the p99 line. CLAUDE.md invariant 4: Redis-down fails closed with
ANOMALY_FLAGGED — verify is still fast in that case (no Postgres
fallback round-trip).

### 5c. Cold cache

After a deploy, the agent / policy cache is empty. p99 settles in
~5 minutes. If it doesn't, check `okoro_cache_miss_ratio` —
sustained > 30% means the cache key strategy is broken.

### 5d. KMS sign latency

The audit-signer goes through KMS for production. AWS Decrypt has
p99 ~30ms; if you see > 100ms, route through the KMS adapter's
internal cache (it caches the unwrapped Ed25519 priv-key for the
process lifetime).

### 5e. BATE BullMQ backpressure

BATE recompute is async — backpressure shouldn't affect verify
latency directly. If `okoro_bullmq_queue_depth` > 1000 sustained,
scale the BateRecomputeWorker concurrency.

### Post-incident

- Update `docs/CAPACITY_PLAN.md` with the new p99 baseline.
- Add a Grafana panel for the specific failure mode if it wasn't
  visible.

---

## 6. Stripe webhook DLQ drain

Stripe webhooks may pile in the DLQ after OKORO-side outages.
Draining is safe because every webhook handler is idempotent
(SETNX-keyed on Stripe `event.id`).

### Detection

- `okoro_webhook_dlq_depth{source="stripe"} > 0` sustained 1h.
- Slack: `#okoro-alerts` "Stripe webhook DLQ has N events".

### Severity

**SEV-3** if < 100 events. **SEV-2** if > 100. **SEV-1** if
subscription state is drifting (customer reports lost upgrade).

### Remediation

```sh
# Drain the DLQ. Idempotency guard prevents double-processing.
pnpm -F @okoro/api exec tsx scripts/drain-stripe-dlq.ts \
  --since "2026-05-04T00:00:00Z" --dry-run

# If dry-run looks correct:
pnpm -F @okoro/api exec tsx scripts/drain-stripe-dlq.ts \
  --since "2026-05-04T00:00:00Z" --apply
```

### Post-incident

- Confirm subscription states are correct in the dashboard.
- If the original outage was OKORO-side, link the post-mortem to
  this drain so the cause/effect is documented.

---

## 7. GDPR Art. 17 redaction request

A user invokes their right to erasure. OKORO's audit chain stays
verifiable through redaction (ADR-0006) — null the PII columns,
keep the `*Hash` commitments + the signature.

### Detection

- Customer support ticket: "user X requests data deletion".
- Compliance team forwards a DPO request.

### Severity

**SEV-3 planned.** GDPR mandates response within 1 month; treat as
SEV-2 if you're inside the last 7 days of that window.

### Triage

```sh
# 1. Look up the principal + agents owned by the user.
psql -c "SELECT id FROM \"Principal\" WHERE email = '$USER_EMAIL';"
psql -c "SELECT id FROM \"AgentIdentity\" WHERE \"principalId\" = '$PRINCIPAL_ID';"

# 2. Identify audit rows that contain user PII for redaction.
psql -c "SELECT count(*) FROM \"AuditEvent\"
         WHERE \"principalId\" = '$PRINCIPAL_ID'
           AND \"action\" IS NOT NULL;"
# (action / relyingParty / requestedAmount / policySnapshot may carry PII)
```

### Remediation

```sh
# Redact via the compliance endpoint. This NULLs the PII columns
# but keeps the *Hash columns + the signature, so the chain stays
# verifiable.
for EVENT_ID in $(psql -At -c "SELECT id FROM \"AuditEvent\" WHERE \"principalId\" = '$PRINCIPAL_ID';"); do
  curl -X POST https://api.okoroapp.com/v1/compliance/audit/redact-event \
       -H "X-OKORO-API-Key: $OKORO_ADMIN_KEY" \
       -d "{\"eventId\":\"$EVENT_ID\",\"reason\":\"gdpr_art17\",\"ticketId\":\"$TICKET\"}"
done

# Verify the chain is still intact post-redaction.
npx @okoro/audit-verifier verify ./export-after-redact.ndjson \
  --jwks https://api.okoroapp.com/.well-known/audit-signing-key
# Expected: ✓ INTACT
```

### Post-incident

- Send the customer a DPO-shaped confirmation (audit-event-id list
  redacted, redaction-event-id, retention timeline).
- The redaction itself is logged as an audit row — that row is
  permanent (ADR-0006: redaction is observable).

---

## 8. New region rollout

Deploying OKORO in a new region (e.g. EU after first US deployment).
This is the data-residency story documented in `docs/EU_RESIDENCY.md`.

### Pre-flight checklist

- [ ] KMS provider has a region-local key (no cross-region wrapping).
- [ ] Postgres replica is region-local; no cross-region writes.
- [ ] Redis cluster is region-local.
- [ ] DNS routing rule directs region traffic to the right cluster.
- [ ] Audit chain genesis row in the new region is signed by the
      region-local kid.
- [ ] JWKS at the region-local domain lists the region-local kid.
- [ ] Customer's onboarding row records the region (`region: 'eu-west'`).

### Rollout steps

```sh
# 1. Run migrations against the new region's DB.
DATABASE_URL=$EU_DB_URL pnpm -F @okoro/api prisma migrate deploy

# 2. Boot the region-local API.
kubectl apply -f infra/k8s/okoro-api-eu-west.yaml

# 3. Confirm the genesis audit row was created and is verifiable.
npx @okoro/audit-verifier verify <(curl -s https://eu.api.okoroapp.com/v1/audit-events/export) \
  --jwks https://eu.api.okoroapp.com/.well-known/audit-signing-key

# 4. Update the customer's principal record to pin region.
curl -X PATCH https://api.okoroapp.com/v1/admin/principals/$PRINCIPAL_ID \
     -H "X-OKORO-Admin: $OKORO_ADMIN_TOKEN" \
     -d '{"region":"eu-west","dataResidency":"eu"}'
```

### Post-rollout

- Customer's audit chain is region-local from the rollout point.
- Their PRIOR audit rows remain in the original region (don't
  cross-migrate; the chain breaks).
- Document the cutover timestamp so a regulator asking "where is
  the data" can answer with the rollout date as the inflection.

---

## Appendix: severity ladder

| SEV | Wake on-call?      | Pager | Customer comms                 | Internal SLA      |
| --- | ------------------ | ----- | ------------------------------ | ----------------- |
| 1   | yes — immediate    | yes   | status page + post-mortem      | response < 15 min |
| 2   | yes — within 30min | yes   | status page if customer-facing | response < 1h     |
| 3   | next business day  | no    | none unless customer-asked     | response < 1d     |
| 4   | weekly review      | no    | none                           | response < 7d     |

Severity bumps **upward** when:

- Customer-facing money is at risk.
- A regulator might ask about it.
- There's an ongoing security event.

Severity bumps **downward** when:

- The fix is deployed and the alarm is just lagging.
- Equivalent capability is degraded but functional.

When in doubt, bump up. False SEV-1s cost a quiet hour;
under-classified SEV-3s cost trust.
