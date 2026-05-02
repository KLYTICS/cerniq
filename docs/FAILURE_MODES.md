---
title: AEGIS — Failure modes (FMEA)
status: draft
last-reviewed: 2026-05-02
owner: operator (Erwin) — sid open
audience: SRE / on-call / incident commander / SOC 2 Type II auditor / DR rehearsal facilitator
companion-to: docs/ARCHITECTURE.md §10 (summary), docs/DR_RUNBOOK.md, docs/SECURITY_RUNBOOK.md, docs/CAPACITY_PLAN.md (degradation thresholds)
---

# AEGIS — Failure modes (FMEA)

> **Purpose.** Component-by-component failure mode and effects
> analysis (FMEA) for every load-bearing piece of AEGIS, with
> mitigation, detection, and recovery clearly specified per failure
> mode. ARCHITECTURE.md §10 is the architectural summary; this
> document is the canon for SRE and incident commanders.
>
> Closes audit findings **A-002**, **A-003**, **A-022** at depth (the
> §10 rollup closed them at the architectural level).

---

## 1. How to use this document

- **During an incident:** §4–§13 are independently consultable by
  component. Each failure mode lists immediate operator actions,
  expected user-visible behaviour, and the runbook anchor.
- **During DR rehearsal:** §14 cascading scenarios are the rehearsal
  scripts. Walk through one per quarter.
- **During design review:** §3 methodology and §2 invariants are the
  guardrails for new components — every new module must add a row
  before merge.

The denial-precedence ordering from CLAUDE.md invariant 6 is the
**single most important interaction** between failure modes and
external behaviour. When in doubt, **deny**: the verify path's
correctness contract is "valid: false on any uncertainty" (per
ADR-0004).

---

## 2. Invariants under failure

These are the **non-negotiable** behaviours regardless of which
component is failing:

| Invariant                          | Source                               | Failure mode that tests it       |
|------------------------------------|--------------------------------------|----------------------------------|
| Private keys never enter AEGIS     | CLAUDE.md inv. 1                     | Compromised app-server memory dump |
| Verify hot path stays portable     | CLAUDE.md inv. 2                     | Phase 3 CF Worker substitution    |
| Audit log is append-only + signed  | CLAUDE.md inv. 3                     | DB partition swap, replication lag, outbox stall |
| No silent failures, no fabricated data | CLAUDE.md inv. 4                | Cache error → DB fallback (logged), spend Redis error → 503, never synthetic trust |
| Multi-tenant isolation             | CLAUDE.md inv. 5                     | RLS bypass attempt, principalId omission |
| Denial precedence is fixed         | CLAUDE.md inv. 6 + ADR-0004          | Race between revocation + spend evaluation must surface revocation first |

A change to a failure-mode mitigation that would weaken any of these
invariants requires an ADR.

---

## 3. FMEA methodology

Each failure mode is rated on three axes, scored 1–5, multiplied to
form a Risk Priority Number (RPN). RPN guides remediation priority,
not absolute risk.

### 3.1 Severity (S)

| Score | Definition                                                                          |
|-------|--------------------------------------------------------------------------------------|
| 5     | Authority compromise: signed-but-false verify result, audit chain corruption, key disclosure |
| 4     | Service-wide outage, audit append loss without recovery path, multi-tenant leak     |
| 3     | Partial degradation: one surface down, one tenant impacted, recoverable             |
| 2     | Latency budget breach without correctness failure                                    |
| 1     | Observability or developer-experience degradation                                   |

### 3.2 Likelihood (L)

| Score | Definition                                                                          |
|-------|--------------------------------------------------------------------------------------|
| 5     | Expected weekly under normal operations                                              |
| 4     | Expected monthly                                                                     |
| 3     | Expected quarterly                                                                   |
| 2     | Expected annually                                                                    |
| 1     | Expected once per service lifetime or never under non-adversarial conditions         |

### 3.3 Detectability (D, inverse — lower = more detectable)

| Score | Definition                                                                          |
|-------|--------------------------------------------------------------------------------------|
| 1     | Page operator within 1 minute (existing alert)                                       |
| 2     | Visible in dashboard + alert within 5 minutes                                        |
| 3     | Visible in dashboard, no alert (operator must look)                                  |
| 4     | Detectable only via log search after the fact                                        |
| 5     | Undetectable with current instrumentation                                            |

### 3.4 RPN guidance

`RPN = S × L × D`

- **RPN ≥ 36:** unacceptable; mitigation must ship before next sprint
  closes.
- **RPN 16–35:** ship mitigation in current quarter.
- **RPN < 16:** track in this document; revisit at quarterly review.

A new failure mode added without remediation gets a `<!-- accepted-risk:
... -->` comment with operator initials.

### 3.5 Denial-precedence interaction

Where a failure mode has multiple plausible denial reasons under race,
the response **must** follow CLAUDE.md invariant 6 ordering:

```
AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE → POLICY_REVOKED →
POLICY_EXPIRED → SCOPE_NOT_GRANTED → SPEND_LIMIT_EXCEEDED →
TRUST_SCORE_TOO_LOW → ANOMALY_FLAGGED
```

Race-resolution column in §4–§13 tables uses this ordering.

---

## 4. Crypto failures

Determines correctness of every verify decision. Most catastrophic
class because failures here can produce signed-but-false decisions.

### 4.1 Failure modes

| ID | Failure mode | S | L | D | RPN | Mitigation | Detection | Recovery | Runbook |
|----|--------------|---|---|---|-----|------------|-----------|----------|---------|
| C-01 | Ed25519 verify produces wrong result on valid input (library bug) | 5 | 1 | 5 | 25 | Pin `@noble/ed25519` to known-good version; cross-check against `jose` (different impl) at startup with a fixed test vector | Startup self-check; quarterly cross-impl regression in CI | Roll back to last known-good build; pause verify path (return 503) | DR_RUNBOOK §"Crypto integrity failure" |
| C-02 | Random number generator weakness (e.g. predictable agent keypair) | 5 | 1 | 5 | 25 | Private keys generated client-side per CLAUDE.md inv. 1; AEGIS never generates agent keys; AEGIS-side jti via `crypto.randomUUID()` (Node native CSPRNG) | Code review only | Agent re-issuance after key rotation campaign | SECURITY_RUNBOOK §"Suspected key compromise" |
| C-03 | JWT parser accepts unsigned token (`alg: none` smuggling) | 5 | 1 | 1 | 5 | `jose` configured to reject `none`; explicit allowed alg `EdDSA`; covered by test in `jwt.util.spec.ts` | Test failure on regression | Roll back; emergency patch; force re-issue all live policies | SECURITY_RUNBOOK |
| C-04 | Time skew between AEGIS server and RP clock causes false POLICY_EXPIRED | 3 | 4 | 2 | 24 | NTP-disciplined clocks; ±60 s clock-skew tolerance documented in API spec; `iat`/`nbf` rejected if more than 60 s in future | `verify_total{denial_reason="POLICY_EXPIRED"}` rate spike | Increase tolerance to 120 s emergency; investigate NTP drift | RUNBOOK §"Clock skew" |
| C-05 | Audit-chain hash collision (theoretical: SHA-256 broken) | 5 | 1 | 5 | 25 | Hash agility: `audit-chain.util.ts` reads `algSuite` from event meta; ADR-0006 § "Algorithm rotation" | n/a (cryptanalytic discovery is the trigger) | Bump alg suite, re-anchor chain (forward-only, prev_hash carries the new alg) | DR_RUNBOOK §"Cryptographic emergency" |
| C-06 | Audit chain break (one event's `prev_hash` does not match prior event's signature) | 5 | 2 | 1 | 10 | Chain integrity check on every audit GET; nightly cron `audit-chain-verify.sh` reports break point | Page on first break detected | **Forensic preservation first**: snapshot Postgres + outbox + S3 before any write; then determine cause (tampering vs. corruption vs. replay) | DR_RUNBOOK §"Audit chain break" |
| C-07 | Signature verifies as valid for tampered payload (canonicalization bug) | 5 | 2 | 4 | 40 | RFC 8785 JCS implementation tested against published vectors; `audit-chain.util.spec.ts` includes adversarial inputs | Quarterly fuzz test in CI | Roll back canonicalizer; re-sign affected events with corrected canonicalization (writes redaction-style meta event acknowledging supersession per ADR-0006) | SECURITY_RUNBOOK |
| C-08 | DPoP nonce replay accepted (Redis nonce store missed) | 4 | 3 | 3 | 36 | DPoP nonce TTL `> max DPoP token TTL × 2` (5 min nonce vs. 60 s DPoP); Redis DB 2 `volatile-ttl` policy; never TTL-less | `dpop_replay_total` (per BATE-024 weight) emits a BATE signal — score drops triggers per-agent flag | Per-agent revocation if confirmed; trust-score ban below cold-start threshold | SECURITY_RUNBOOK §"DPoP replay" |

### 4.2 Race resolution within crypto

A signature failure (`C-07`) and a token expiry race must surface
`INVALID_SIGNATURE` before `POLICY_EXPIRED` per the precedence
ordering. Implementation: signature verification is **step 4** in the
12-step `verify.algorithm.ts`; expiry check is step 7. Order is
load-bearing.

---

## 5. KMS failures

Per ADR-0011, KMS is the production source for the audit-chain
signing key (and Phase 3+ for policy signing too). A KMS outage is
**partial-fail-closed**: in-flight verify continues from cache;
audit-append degrades to outbox; policy issuance pauses.

### 5.1 Failure modes

| ID | Failure mode | S | L | D | RPN | Mitigation | Detection | Recovery | Runbook |
|----|--------------|---|---|---|-----|------------|-----------|----------|---------|
| K-01 | KMS provider regional outage (AWS/GCP/Vault unreachable) | 4 | 3 | 1 | 12 | Cross-region KMS replication for sign keys; fallback adapter in `kms.module.ts` per env config | `kms_sign_error_rate` page > 0.1% over 1 min | Switch `AEGIS_KMS_PROVIDER` env on the impacted region; rolling restart | DR_RUNBOOK §"KMS provider outage" |
| K-02 | KMS key rotation race (audit signer rotates mid-event) | 4 | 2 | 3 | 24 | 30-day overlap window per ADR-0011; signing-key version persisted on `AuditEvent.signingKeyId` so verifiers know which JWKS entry; verify accepts both during overlap | Cross-impl test catches; nightly chain-verify with both keys exercises overlap | n/a — overlap is by design | RUNBOOK §"Key rotation" |
| K-03 | KMS sign latency p99 spike (provider degradation) | 2 | 4 | 2 | 16 | KMS sign budget 30 ms; circuit breaker after 100 ms p99 sustained 60 s; degrade to **outbox-only** audit append (writes plaintext payload + queue for sign on recovery) | `kms_sign_seconds` p99 page | Outbox drain after KMS recovery (per ADR-0007) | RUNBOOK §"KMS slow path" |
| K-04 | Vault Transit version drift (signature points at retired key version) | 3 | 2 | 2 | 12 | `vault-transit.adapter.ts` parses envelope version on every sign result; mismatch raises `KmsVersionDrift` | Adapter test exercises drift path | Re-sign affected events with current version; chain integrity preserved (signatures over different versions verify against their respective JWKS entries) | RUNBOOK §"KMS version drift" |
| K-05 | KMS rejects sign because IAM policy revoked (operator misconfig) | 4 | 2 | 1 | 8 | Startup self-check signs a sentinel value; fails fast on broken IAM | Startup health-check failure → pod refuses to enter ready | Restore IAM policy; `aegis-cli kms verify` from operator | RUNBOOK §"KMS IAM" |
| K-06 | KMS provider audit log gap (cannot prove sign happened) | 3 | 2 | 4 | 24 | Mirror of every sign request to local outbox row with `kmsRequestId`; audit chain can be cross-verified against KMS-side log | Reconciliation cron compares outbox `kmsRequestId` against KMS provider audit log nightly | Manual reconciliation via aegis-cli; document gap in compliance evidence | RUNBOOK §"KMS reconciliation" |

### 5.2 Provider-specific notes

- **AWS KMS:** EdDSA (`SIGN_VERIFY` `ECC_NIST_P256` not Ed25519 yet
  GA in all regions). Per ADR-0011, AWS adapter degrades to RSA-PSS
  during the EdDSA gap window; signature size and JWKS entries must
  reflect the temporary mixed-alg posture.
- **GCP Cloud KMS:** native `EC_SIGN_ED25519`. Lowest sign latency
  observed in pilot.
- **Vault Transit:** self-hosted; operator must size Vault per
  CAPACITY_PLAN.md §9.2.

---

## 6. Database (Postgres) failures

Postgres is single-writer at Phase 1 (per CAPACITY_PLAN.md §5.5).
Failure here cascades broadly.

### 6.1 Failure modes

| ID | Failure mode | S | L | D | RPN | Mitigation | Detection | Recovery | Runbook |
|----|--------------|---|---|---|-----|------------|-----------|----------|---------|
| D-01 | Postgres primary down (region or instance) | 4 | 2 | 1 | 8 | Railway managed failover (RTO 30 min); audit append falls through to outbox per ADR-0007; verify cache hits continue | Railway alert + readiness probe failure | Wait for Railway failover; if persists > 15 min escalate to manual restore | DR_RUNBOOK §"Postgres primary down" |
| D-02 | Replica lag exceeds SLO (audit GET serves stale) | 2 | 4 | 2 | 16 | Lag SLO 5 s; reads requiring fresh data force `READ_REPLICA_OK=false`; audit GET tolerates 5 s | `pg_replication_slot.lag_bytes` page > 100 MB | Pause replica reads; investigate replication slot; restart replica if needed | RUNBOOK §"Replica lag" |
| D-03 | Connection pool exhausted (PgBouncer waiters > 5) | 3 | 3 | 1 | 9 | Pool sized at 65 frontend (CAPACITY_PLAN §5.1); 5 s `query_wait_timeout` → app 503; **do not autoscale API on this metric** (would worsen) | `pgbouncer_pools_cl_waiting` page > 5 sustained 60 s | Reduce app concurrency, kill long-running queries (`pg_terminate_backend`), increase backend pool with operator approval | RUNBOOK §"PG pool exhausted" |
| D-04 | Audit table partition not created in time | 4 | 2 | 2 | 16 | Partition cron runs 24h ahead at 02:00 UTC on the 1st; alert if next month's partition is missing 12h before boundary | Monitoring `aegis_audit_partition_exists{month=N+1}` → 0 | Manual partition creation (`infra/postgres/partition-cron.sql` ad-hoc); investigate cron failure | RUNBOOK §"Partition cron" |
| D-05 | Audit append-only trigger bypassed (UPDATE/DELETE on AuditEvent) | 5 | 1 | 2 | 10 | Trigger in migration `20260502000100_audit_append_only`; only `aegis_schema_owner` role can disable per ADR-0006 | Trigger failure logged; alert on any successful UPDATE/DELETE on AuditEvent | **Do not roll forward**: snapshot + investigate; redaction job uses dedicated grant per ADR-0006 § "Operator authorization" | SECURITY_RUNBOOK §"Audit tamper attempt" |
| D-06 | Cross-tenant data leak via missing `principalId` filter | 4 | 1 | 4 | 16 | Per-service code review for `principalId` in WHERE; optional RLS as defense-in-depth (peer's `apps/api/src/common/security/`) | RLS deny-counter alert; weekly random sample audit | Patch the offending query; affected-tenant notification per incident-comm SLA (per ARCHITECTURE.md §9) | SECURITY_RUNBOOK §"Tenant leak" |
| D-07 | Long-running migration locks AuditEvent table | 3 | 2 | 1 | 6 | Forward-only additive migrations per ARCHITECTURE.md §8.3; migration smoke run on staging at full prod data size; `lock_timeout = 5s` on prod migrations | Migration timeout, alert | Roll back migration; defer to maintenance window | RUNBOOK §"Migration lock" |
| D-08 | Storage exhausted (audit growth ahead of partition rolloff) | 3 | 2 | 1 | 6 | Partition rolloff every 1st at 04:00 UTC; storage tier headroom 50%; alert at 70% | `pg_database_size` > 70% of plan ceiling | Provision next plan tier; trigger partition rolloff manually if scheduled detach delayed | RUNBOOK §"PG storage" |
| D-09 | Outbox stuck (ADR-0007 outbox drain not making progress) | 4 | 3 | 2 | 24 | Outbox drain BullMQ worker concurrency 1; `audit:dlq` alert at depth > 50 000; idempotent INSERT ON CONFLICT DO NOTHING | `audit:dlq` queue depth metric | Restart worker; investigate cause; if KMS-down (K-03) outbox naturally pauses signing — see K-03 | RUNBOOK §"Outbox stall" |
| D-10 | Schema drift between code and DB (Prisma client out of sync) | 3 | 2 | 1 | 6 | `prisma migrate deploy` in API container start script; CI fails if `prisma migrate diff` non-empty | CI failure; runtime "column does not exist" errors | Roll back deploy; re-run migrations; investigate diff | RUNBOOK §"Schema drift" |

### 6.2 Why D-05 is the worst-case scenario

`AuditEvent` is append-only by trigger (per ADR-0006 redaction
contract). A successful UPDATE or DELETE means **the audit chain's
authority has been compromised**. Detection of any successful
UPDATE/DELETE against `AuditEvent` is a **page-immediately /
preserve-state** scenario — incident commander assumes insider threat
or bug until proven otherwise. The redaction operator-authorization
flow per ADR-0006 § "Operator authorization" is the **only**
sanctioned write path.

---

## 7. Cache (Redis) failures

Redis serves three distinct workloads (cache reads, spend counters,
DPoP nonce) per CAPACITY_PLAN.md §6.1. Each has different failure
posture: cache fails open (DB fallback), spend fails closed (503),
DPoP fails closed (deny verify with INVALID_SIGNATURE).

### 7.1 Failure modes

| ID | Failure mode | S | L | D | RPN | Mitigation | Detection | Recovery | Runbook |
|----|--------------|---|---|---|-----|------------|-----------|----------|---------|
| R-01 | Redis cluster outage (primary + standby down) | 4 | 1 | 1 | 4 | Cache reads fall back to Postgres (logged via `aegis_cache_set_failed_total`); spend evaluation 503; DPoP verify denied | Redis health probe; pod readiness false | Wait for Railway managed restart; if > 15 min, manual failover from snapshot | DR_RUNBOOK §"Redis cluster down" |
| R-02 | Redis primary down, failover to standby | 2 | 3 | 1 | 6 | Sentinel/failover automated; brief window of writes lost (≤ 1 s with `appendfsync everysec`); spend counters use `appendfsync always` so no loss | Failover event metric | n/a — automated | RUNBOOK §"Redis failover" |
| R-03 | Redis memory pressure → eviction storm on cache DB (DB 0) | 2 | 4 | 2 | 16 | LRU policy; budget at 50% utilization; alert at 70%; CAPACITY_PLAN.md §6 sizing covers +12mo | `redis_evicted_keys{db="0"}` rate page > 100/s | Provision larger Redis tier; investigate cache hit rate regression | RUNBOOK §"Redis eviction" |
| R-04 | Redis spend DB (DB 1) eviction (must be 0) | 5 | 1 | 1 | 5 | DB 1 is `noeviction`; any non-zero eviction is a page-immediately scenario; `appendfsync always` ensures durability | `redis_evicted_keys{db="1"}` page on > 0 | **Stop new spend evaluations** (toggle `FEATURE_SPEND_GUARD_OFFLINE`); reconcile from Postgres SpendRecord per RUNBOOK § "Spend reconciliation" before re-enabling | SECURITY_RUNBOOK §"Spend integrity loss" |
| R-05 | Redis DPoP nonce DB (DB 2) loss → replay window opens | 4 | 1 | 2 | 8 | DPoP nonce TTL 5 min, `volatile-ttl`; on Redis recovery, the 5-min window is naturally re-protected as new nonces issue; Layer 3 jti dedup (THREAT_MODEL_v2 §7.3) catches the same-call replay | Redis db 2 keyspace miss spike | Wait 5 min for nonce window to reseat; in the interim, BATE signal `AGENT_DPOP_REPLAY_ATTEMPT` weight (`-200`) flags any replays | SECURITY_RUNBOOK §"DPoP nonce loss" |
| R-06 | Cache poisoning (attacker writes to Redis directly) | 5 | 1 | 4 | 20 | Redis bound to private network only; AUTH password from KMS-stored secret; no public Redis exposure; defense-in-depth: every cache read passes through `policy.fingerprint()` validation against signed payload | Anomalous cache contents detected by validation; alert | Flush affected keys; rotate Redis AUTH; investigate ingress | SECURITY_RUNBOOK §"Cache poisoning" |
| R-07 | BullMQ delayed jobs lost on Redis crash | 3 | 1 | 3 | 9 | `appendfsync everysec` for DB 3; AOF replay on restart recovers ≤ 1 s | Job-not-found errors at expected execution time | Manual re-enqueue from outbox; `webhook:deliver` retries naturally on next attempt | RUNBOOK §"BullMQ recovery" |

### 7.2 Spend-counter race resolution

A race between policy revoke (D-01 + R-02 simultaneous) and a verify
spend evaluation must surface `POLICY_REVOKED` per CLAUDE.md inv. 6.
Implementation: revocation in `policy.service.revoke()` busts the
`policy:{id}` cache **before** writing `revokedAt`, ensuring the next
verify reads from Postgres and gets the revoked policy. If Postgres is
also down (D-01), spend evaluation 503s anyway, denying the request
fail-closed — both invariants honored.

---

## 8. Queue (BullMQ) failures

| ID | Failure mode | S | L | D | RPN | Mitigation | Detection | Recovery | Runbook |
|----|--------------|---|---|---|-----|------------|-----------|----------|---------|
| Q-01 | `webhook:deliver` saturated (downstream customer slow) | 2 | 4 | 1 | 8 | Per-subscription concurrency cap 1; OD-005 8-attempt cap then DLQ; backpressure to API → 429 on `POST /v1/webhooks` create after 5 000 depth | Queue-depth alert | Customer notification; manual DLQ inspection | RUNBOOK §"Webhook saturated" |
| Q-02 | `bate:signal` worker crash loop (single-row poison message) | 3 | 2 | 2 | 12 | Per-job try/catch + dead-letter after 5 attempts; isolate poison message to DLQ; log with `signalId` | Worker crash count metric | Inspect DLQ row, fix bug, replay | RUNBOOK §"BATE poison" |
| Q-03 | Outbox drain blocked by KMS-down (K-03) | 3 | 3 | 1 | 9 | Outbox writes accept new payloads even when sign blocked; drain pauses signing; resumes on KMS recovery | KMS sign error → outbox depth growth | KMS recovery resolves; if KMS down > 1 hour, escalate per K-01 runbook | DR_RUNBOOK §"KMS extended outage" |
| Q-04 | Job idempotency key collision (CSPRNG failure) | 3 | 1 | 3 | 9 | UUIDv4 collision probability negligible; ON CONFLICT DO NOTHING degrades gracefully | n/a (collision is silent and benign) | n/a | n/a |
| Q-05 | Cron drift (policy expiry sweep skipped) | 2 | 2 | 3 | 12 | BullMQ scheduled job persisted in DB 3; on Redis restart, scheduled jobs resume from AOF | Skipped-execution metric | Manual sweep via `aegis-cli policies expire`; investigate cron health | RUNBOOK §"Cron drift" |

---

## 9. External dependency failures

### 9.1 Failure modes

| ID | Failure mode | S | L | D | RPN | Mitigation | Detection | Recovery | Runbook |
|----|--------------|---|---|---|-----|------------|-----------|----------|---------|
| E-01 | Auth0 outage (dashboard login broken) | 3 | 3 | 1 | 9 | Dashboard middleware degrades: `AUTH0_REQUIRED=false` emergency env flips to allow operator-IP bypass; programmatic API key auth unaffected | Auth0 status page; dashboard 5xx rate | Flip emergency flag with operator approval; document in incident | RUNBOOK §"Auth0 outage" |
| E-02 | Cloudflare WAF false-positive blocks legitimate verify (Phase 3) | 3 | 3 | 2 | 18 | WAF rule allow-list for known RP IP ranges; emergency `Page Rule` to bypass WAF for `/v1/verify` (with operator-IP guard) | RP customer report; CF WAF block log | Tune rule; if persistent, contact CF support | RUNBOOK §"WAF false positive" |
| E-03 | Cloudflare regional outage (Phase 3) | 4 | 2 | 1 | 8 | Other regions absorb traffic per CAPACITY_PLAN §10.3; CF native multi-region failover; if all regions affected, fall back to direct Railway (Phase 1 path stays online) | CF status page | CF resolves; verify edge auto-recovers | DR_RUNBOOK §"CF outage" |
| E-04 | Sentry / Datadog ingestion fails (observability blind) | 1 | 4 | 3 | 12 | Logs to stdout always; Pino sink unaffected; metrics via Prometheus pull from `prom-client` (Datadog scrape may fail) | Datadog ingest gap alert (self-monitoring) | Wait out provider; logs survive | RUNBOOK §"Observability outage" |
| E-05 | S3 + GCS dual outage (audit archive write fails) | 2 | 1 | 2 | 4 | Dual-write per RETENTION_POLICY §5.4; archive job retries with exponential backoff up to 24h; partitions stay attached during outage; S3 + GCS simultaneous outage extremely rare | Archive job error rate; S3 + GCS provider status | Postpone archive job; partitions remain queryable in Postgres | RUNBOOK §"Archive outage" |
| E-06 | OpenTimestamps / notarization service down (archive integrity-pin fails) | 1 | 3 | 2 | 6 | Archive proceeds without notarization; backlog notarization on recovery; Merkle root recorded in `audit.well-known/audit-archive-roots.json` regardless | Notarization endpoint health | Recover-then-notarize | RETENTION_POLICY §5.4 |

---

## 10. Replay & abuse

These are adversarial failure modes — likelihood is "expected
adversarial probing" rather than fault-rate.

### 10.1 Failure modes

| ID | Failure mode | S | L | D | RPN | Mitigation | Detection | Recovery | Runbook |
|----|--------------|---|---|---|-----|------------|-----------|----------|---------|
| A-01 | Token replay across consecutive verify calls | 4 | 5 | 1 | 20 | Layer 1 jti per call (THREAT_MODEL_v2 §7.3); Layer 3 jti set in Redis DB 2; verify-result cache key includes jti per A-016; DPoP nonce per ADR-0010 | `aegis_replay_blocked_total` rate; BATE weight `AGENT_DPOP_REPLAY_ATTEMPT: -200` | Per-agent revocation if persistent; trust-score-driven cold-start ban | SECURITY_RUNBOOK §"Replay" |
| A-02 | Enumeration of agent IDs via `/v1/agents/{id}` | 2 | 5 | 2 | 20 | Negative caching `agent:{id}:notfound` 60 s TTL (per A-015); rate limit per IP at edge (Phase 3 CF rule); per-key throttle | Anomalous 404 rate per source IP / key | Add IP allow-list for the source if persistent | SECURITY_RUNBOOK §"Enumeration" |
| A-03 | Brute-force key guessing on private key (theoretical) | 5 | 1 | 5 | 25 | Ed25519 128-bit security; private keys never in AEGIS so not exposed by AEGIS breach; agent-side compromise responsibility per CLAUDE.md inv. 1 | n/a | n/a (out of AEGIS attack surface) | n/a |
| A-04 | Dictionary attack on hashed audit redaction leaves (per ADR-0006 § "Dictionary attack residual") | 3 | 3 | 4 | 36 | Hash includes per-event salt published only after redaction; documented residual per ADR-0006; auditor disclosure | Per-DPO inquiry, not detection | Recommend salt rotation if attack feasibility increases | RETENTION_POLICY §3 + SECURITY_RUNBOOK |
| A-05 | API-key compromise (RP's verify-key leaked) | 4 | 3 | 2 | 24 | API-key rotation flow per RUNBOOK; per-key audit log; revoke + reissue ≤ 5 min | Anomalous key usage geography / volume | Revoke key; force RP to re-onboard verify-key | RUNBOOK §"API key compromise" |
| A-06 | Compromised RP revokes legitimate agents (denial-of-service via authority) | 4 | 1 | 3 | 12 | RP revocation requires API-key auth which is rotatable; per-revocation audit row attributable; multi-key for production RPs (dual-control optional) | Revocation rate spike per RP | Restore agents from audit (event payload contains agent registration); investigate RP-side compromise | SECURITY_RUNBOOK §"Authority abuse" |
| A-07 | Spend exhaustion attack (legitimate-looking traffic exhausts policy spend) | 2 | 3 | 1 | 6 | Spend limits per policy; OD-006 rate limit 10 rps per principal FREE; trust-score floor enforces minimum behavior | Per-policy spend rate metric | Issue new policy with adjusted spend; investigate source | SECURITY_RUNBOOK |

---

## 11. Audit chain failures

The audit chain is the load-bearing trust artifact. Failures here
collapse customer trust; this section deserves heightened scrutiny.

### 11.1 Failure modes

| ID | Failure mode | S | L | D | RPN | Mitigation | Detection | Recovery | Runbook |
|----|--------------|---|---|---|-----|------------|-----------|----------|---------|
| AC-01 | `prev_hash` chain break (see C-06 above) | 5 | 2 | 1 | 10 | Per C-06 |  |  | DR_RUNBOOK |
| AC-02 | Partition swap loses tail events | 4 | 2 | 2 | 16 | Partition detach is `DETACH PARTITION CONCURRENTLY` (no exclusive lock); export validated against partition row count + Merkle root before DROP | Detach job logs row count; archive integrity check | If validation fails, re-attach partition; pause rolloff | RUNBOOK §"Partition rolloff" |
| AC-03 | Redaction job introduces chain break (writing meta event with wrong prev_hash) | 5 | 1 | 2 | 10 | Redaction is itself an audit event written via the standard append path; uses current chain tip's prev_hash; ADR-0006 § "Redaction execution model" | Chain integrity check immediate; nightly cron | Re-issue redaction from corrected prev_hash; document in incident | DR_RUNBOOK §"Redaction error" |
| AC-04 | Archive Merkle root publication fails (`/.well-known/audit-archive-roots.json` not updated) | 3 | 2 | 2 | 12 | Publication is the last step of archive job; alert on stale `archive_root_publish_age_seconds > 24h` | Endpoint freshness alert | Re-trigger publication; investigate static-asset host | RUNBOOK §"Archive root publication" |
| AC-05 | Notarization break (OpenTimestamps disagrees with internal Merkle root) | 5 | 1 | 3 | 15 | Cross-verification at archive-job exit; notarization mismatch escalates to incident | Archive job notarization-mismatch alert | Forensic preservation; investigate which side is wrong (internal recompute vs. notarization service) | DR_RUNBOOK §"Notarization break" |
| AC-06 | Audit GET pagination returns out-of-order events | 2 | 2 | 3 | 12 | Strict `(timestamp, id)` ordering; cursor-based pagination not offset-based | Customer-reported anomaly; integration test | Patch ordering; reissue affected pages | RUNBOOK §"Audit GET" |
| AC-07 | Audit signing key (current version) destroyed prematurely | 5 | 1 | 1 | 5 | KMS key destroy requires `aegis_schema_owner` + 7-day soft-delete window per RETENTION_POLICY §6; cannot single-keystroke destroy | KMS key state monitor | Restore from soft-delete window; if past window, re-issue chain segment with new key + meta event | DR_RUNBOOK §"Signing key destruction" |

### 11.2 Why notarization mismatch (AC-05) is critical

Internal chain says state X; OpenTimestamps says state Y. **One of
the two trust roots is wrong.** Until reconciled, no auditor can
trust either. Forensic preservation is the only safe action while
the discrepancy is investigated. The runbook anchor's first action is
**"do not write any new audit events to the affected partition"** —
which means pausing the entire AEGIS write path, accepting service
unavailability over silent corruption.

This is the prototypical example of CLAUDE.md inv. 4 ("no silent
failures, no fabricated data") under pressure: the operationally
expensive choice is the only correct one.

---

## 12. Operational failures (process, not component)

| ID | Failure mode | S | L | D | RPN | Mitigation | Detection | Recovery | Runbook |
|----|--------------|---|---|---|-----|------------|-----------|----------|---------|
| O-01 | Config drift (env var diverges between staging + prod) | 2 | 4 | 4 | 32 | Single Zod-validated config in `apps/api/src/config/`; CI enforces config schema parity; quarterly drift audit | Config-diff report from `aegis-cli config diff` | Reconcile via PR; document divergence intent | RUNBOOK §"Config drift" |
| O-02 | Secret rotation gap (old secret expires before new one provisioned) | 4 | 2 | 2 | 16 | Rotation runbook 30-day overlap; CI calendar reminder 14 days before expiry | Secret expiry monitor | Emergency rotation; investigate scheduling failure | RUNBOOK §"Secret rotation" |
| O-03 | Concurrent deploy collision (two operators deploy simultaneously) | 2 | 2 | 1 | 4 | Railway deploy lock per service; `claude-peers claim` for in-repo coordination | Deploy-conflict error | Wait for first deploy; redo second | RUNBOOK |
| O-04 | Migration deployed without app deploy (or vice versa) | 4 | 2 | 1 | 8 | Three-step contract per ARCHITECTURE.md §8.3; `prisma migrate deploy` in container start script | App startup error or schema diff | Roll back; redeploy correctly; investigate CI/CD ordering | RUNBOOK §"Migration ordering" |
| O-05 | Operator runs destructive `psql` against prod (e.g. DELETE FROM AuditEvent) | 5 | 1 | 1 | 5 | D-05 trigger blocks UPDATE/DELETE on AuditEvent; production DB access requires step-up auth + audit-logged session | Trigger reject + session audit | If somehow succeeded, restore from latest backup + outbox replay | DR_RUNBOOK §"Destructive query" |
| O-06 | Backup not verified (restore-from-backup never tested) | 4 | 3 | 4 | 48 | Quarterly DR rehearsal: provision a fresh region, restore from backup, run smoke + chain-verify; documented in DR_RUNBOOK § "Backup verification" | Rehearsal report | n/a — failing rehearsal is the recovery (fix the gap before next quarter) | DR_RUNBOOK |
| O-07 | On-call paged but runbook anchor missing for the alert | 1 | 3 | 1 | 3 | Every alert in Datadog/Grafana includes a `runbook_url` annotation pointing at the relevant `RUNBOOK.md` section; quarterly runbook completeness audit | Alert without anchor → CI failure on alert config PR | Add anchor; merge | RUNBOOK §"Alerts inventory" |

### 12.1 Why O-06 has the highest RPN in this document

Backup verification gap = **untested recovery path**. By definition
it cannot be detected by alerts (the alert would trigger only when
recovery is needed, which is too late). Quarterly rehearsal is the
only mitigation; failing to schedule it is the failure mode itself.

This row is the **single most important reason** to keep the §15
quarterly review on the calendar.

---

## 13. Phase 3 Cloudflare Worker failures

For when the verify hot path lifts to CF Workers per ARCHITECTURE.md
§1.

| ID | Failure mode | S | L | D | RPN | Mitigation | Detection | Recovery | Runbook |
|----|--------------|---|---|---|-----|------------|-----------|----------|---------|
| W-01 | KV global replication lag (stale agent / policy at edge) | 3 | 3 | 3 | 27 | KV staleness budget 60 s; verify path checks payload `iat` for freshness; on-revoke we issue a wake-up `KV_BUST` request to all regions | KV staleness probe; verify-result divergence between regions | Force re-publish; investigate KV health | DR_RUNBOOK §"KV staleness" |
| W-02 | D1 audit overflow not replicated to Postgres on recovery | 4 | 2 | 2 | 16 | D1-to-Postgres replay job idempotent (per Q-04); replay-completion metric per region | Per-region `d1_replay_lag_seconds` | Investigate replay worker; manual replay if needed | DR_RUNBOOK §"D1 replay" |
| W-03 | Worker exceeds CPU budget (50 ms) on large payload | 2 | 3 | 2 | 12 | Payload size cap 16 KiB enforced at WAF; verify algorithm < 1 ms CPU normal; alert on tail | `worker_cpu_time` p99 metric | Investigate payload anomaly; tighten WAF rule | RUNBOOK §"Worker CPU" |
| W-04 | Worker subrequest budget exceeded (50 per request, but verify uses 2) | 2 | 1 | 2 | 4 | Verify uses 2 subrequests; alert at 10 (4× budget); enforced by code | n/a | n/a | n/a |

---

## 14. Cascading failure scenarios (DR rehearsal scripts)

These are end-to-end scenarios chaining multiple component failures.
One per quarterly DR rehearsal.

### 14.1 Scenario A — KMS regional outage during peak

Trigger: GCP KMS us-east outage 11:00 UTC (peak verify load 800 rps).

Expected behaviour:
1. K-01 detection within 30 s; cross-region KMS adapter switches to
   us-west via `AEGIS_KMS_PROVIDER` rolling config.
2. During the ~60 s switch window, audit append falls through to
   outbox per K-03; verify continues from cache (no audit blocking
   the hot path).
3. Outbox depth grows to ~50 K rows (60 s × 800 rps).
4. KMS recovery; outbox drain catches up in ~5 min (worker
   concurrency 1, batched at 100/round).
5. No audit chain break; chain-verify nightly cron passes.

Operator actions:
- Page acknowledged within 5 min.
- Confirm outbox depth peaked < 100 K (RUNBOOK §"Outbox stall"
  threshold).
- Post-mortem: validate K-01 runbook, update if any step took longer
  than budgeted.

### 14.2 Scenario B — Postgres primary failover during audit batch

Trigger: Railway-managed Postgres primary failure during the 02:00
UTC partition cron.

Expected behaviour:
1. D-01 detection; Railway failover (RTO 30 min budget).
2. Partition cron fails (D-04); cron retries with backoff.
3. Verify cache hits continue; cache misses 503 per D-01 row.
4. Audit append falls through to outbox; spend evaluation 503.
5. Failover completes; cron retry succeeds; verify recovers.

Operator actions:
- Validate D-01 mitigation; confirm partition for next month exists
  (manual `aegis-cli admin partition ensure-next` if cron retry
  exhausts).
- Confirm outbox drain catches up.

### 14.3 Scenario C — Audit chain break detected mid-day

Trigger: Nightly chain-verify cron flags a `prev_hash` mismatch
between event N and N+1.

Expected behaviour (per AC-01 / C-06):
1. **Page immediately**; incident commander declares P1.
2. First action: snapshot Postgres + outbox + S3 archive (preserve
   forensic state).
3. Determine cause: (a) tampering, (b) corruption, (c) double-publish
   from a concurrent writer, (d) clock-skew during cross-region
   replication (Phase 3 only).
4. Customer notification per ARCHITECTURE.md §9 incident-comm SLA
   (P1 = 4 hours).
5. Remediation depends on cause; chain repair via meta event per
   ADR-0006 § "Algorithm rotation" if cryptographic; raw correction
   not permitted.

Operator actions:
- This is the **least-rehearsed** scenario; quarterly DR rehearsal
  must include it at least once per year.
- Practice the customer notification mechanics, not just the
  technical investigation.

### 14.4 Scenario D — Multi-region failure (Phase 3)

Trigger: us-east region down (mgmt + verify edge), eu-west must
absorb US traffic per CAPACITY_PLAN.md §10.3.

Expected behaviour:
1. CF Workers in eu-west receive US traffic; KV replicated.
2. D1 in eu-west buffers US-Principal audit events; cannot replay
   to us-east mgmt-plane (down).
3. Spend evaluation operates from KV cache; tight bound on
   correctness during outage (can over-spend by up to 60 s of
   replication staleness).
4. **Fail-closed boundary:** if outage > 1 hour, eu-west verify
   degrades to **read-only** for US Principals (no new audit, no new
   spend) until us-east recovers.
5. Recovery: D1 replay back to us-east Postgres; reconciliation per
   AC-02.

Operator actions:
- Decision point at 1-hour mark: continue degraded vs. shut down
  US-Principal verify entirely. Operator-approval-required.
- Documented in DR_RUNBOOK §"Cross-region failover".

---

## 15. Detection & alert cross-walk

Every failure mode in this document maps to at least one alert in the
production observability stack. This table is the canonical mapping;
alert config drift against this table is itself a failure mode
(O-07).

| Failure ID | Alert name                                    | Severity | Receiver                  |
|------------|-----------------------------------------------|----------|---------------------------|
| C-01..C-08 | `aegis_crypto_*`                              | page     | on-call + security        |
| K-01..K-06 | `aegis_kms_*`                                 | page     | on-call                   |
| D-01..D-10 | `aegis_postgres_*`                            | page     | on-call + DBA             |
| R-01..R-07 | `aegis_redis_*`                               | page or warn | on-call (page on R-04, R-06) |
| Q-01..Q-05 | `aegis_bullmq_*`                              | warn     | on-call                   |
| E-01..E-06 | `aegis_external_*`                            | warn     | on-call                   |
| A-01..A-07 | `aegis_security_*`                            | page     | security                  |
| AC-01..AC-07 | `aegis_audit_chain_*`                       | page     | security + on-call        |
| O-01..O-07 | (process — no alert; covered by review/audit) | n/a      | operator                  |
| W-01..W-04 | `aegis_worker_*` (Phase 3)                    | page or warn | on-call                |

Every alert includes a `runbook_url` annotation pointing at the
matching `RUNBOOK.md` or `DR_RUNBOOK.md` section.

---

## 16. Per-quarter FMEA review cadence

| Cadence       | Action                                                                |
|---------------|------------------------------------------------------------------------|
| Per-PR        | Add FMEA row for any new component; reviewer enforces                 |
| Monthly       | Rolling read of one component section by on-call rotation             |
| Quarterly     | DR rehearsal of one §14 scenario; update RPNs from observed incidents |
| Semi-annually | Refresh §3 scoring rubric if incident data suggests miscalibration    |
| Annually      | Full audit of every row by external reviewer (preferred: SOC2 auditor)|

The quarterly review is the canonical time to **promote `<!--
accepted-risk: ... -->` items** to mitigations or **demote
mitigations to `accepted-risk`** with operator initials and a
recorded reason.

---

## 17. Cross-references

| Topic                          | Source                                                       |
|--------------------------------|---------------------------------------------------------------|
| Architecture summary           | `docs/ARCHITECTURE.md` §10                                    |
| Capacity (degradation thresholds) | `docs/CAPACITY_PLAN.md` §12                                |
| Retention (data-loss bounds)   | `docs/RETENTION_POLICY.md`                                    |
| DR runbook (recovery steps)    | `docs/DR_RUNBOOK.md`                                          |
| Operator runbook (day-to-day)  | `docs/RUNBOOK.md`                                             |
| Security runbook (adversarial) | `docs/SECURITY_RUNBOOK.md`                                    |
| Threat model v2                | `docs/THREAT_MODEL_v2.md` (especially §8.4 and §11)           |
| Audit-chain canonicalization   | `docs/decisions/0005-audit-chain-canonicalization.md`         |
| Audit redactability            | `docs/decisions/0006-audit-redactability.md`                  |
| Outbox                         | `docs/decisions/0007-transactional-outbox.md`                 |
| DPoP replay prevention         | `docs/decisions/0010-dpop-replay-prevention.md`               |
| KMS rotation                   | `docs/decisions/0011-key-rotation-kms.md`                     |
| Denial precedence              | `CLAUDE.md` invariant 6 + `docs/SECURITY.md` § Denial Precedence |

---

## Appendix A — accepted residual risks

Failure modes the operator has explicitly accepted with no mitigation
beyond detection/disclosure. Each requires operator initials and a
review date.

1. **A-04 dictionary attack on hashed redaction leaves** — accepted
   for Phase 1 GA; mitigation depends on per-event salt rotation that
   ships in Phase 2. Review: Phase 2 design phase.
   <!-- accepted-risk: 2026-05-02, operator EE; documented in ADR-0006 § "Dictionary attack residual" -->
2. **K-04 Vault Transit version drift on adapter upgrade** — accepted
   because adapter is Phase 1 fallback, not primary KMS path. Review:
   when GCP KMS becomes primary in Phase 2.
   <!-- accepted-risk: 2026-05-02, operator EE -->
3. **W-01 KV global replication lag up to 60 s** — accepted as the
   trade-off for Phase 3 edge-cache architecture. Mitigated by
   on-revoke `KV_BUST` and `iat` freshness check. Review: post-Phase
   3 GA + 90 days.
   <!-- accepted-risk: 2026-05-02, operator EE; per ARCHITECTURE.md §10.5 -->
