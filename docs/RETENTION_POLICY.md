---
title: OKORO — Data retention policy
status: draft
last-reviewed: 2026-05-02
owner: operator (Erwin) — sid open
audience: SOC 2 Type II auditor / EU AI Act DPO / customer DPA reviewer / incident commander / SRE handling deletion requests
companion-to: docs/ARCHITECTURE.md §12 (summary), docs/COMPLIANCE.md, docs/EU_RESIDENCY.md, docs/decisions/0006-audit-redactability.md, docs/CAPACITY_PLAN.md §5.4 (storage growth driver)
---

# OKORO — Data retention policy

> **Purpose.** Authoritative classification, retention period, lawful
> basis, deletion mechanism, and owner for every persistent data
> class OKORO holds. ARCHITECTURE.md §12 is the architectural summary;
> this document is the canon a DPO, SOC 2 auditor, or Enterprise DPA
> reviewer references.
>
> Closes audit findings **A-005** (partitioning detail) and **A-006**
> (right-to-erasure flow detail) at depth. The §12 rollup closed them
> at the architectural level.

---

## 1. How to use this document

- **For a DPO / external reviewer:** §3 (data class taxonomy) and §4
  (per-class table) are the entry point. §5 + §6 explain the
  immutability-vs-erasure resolution.
- **For an SRE handling a tenant deletion request:** §7 is the
  step-by-step operational flow; §8 covers backups; §9 covers keys.
- **For an auditor verifying SOC 2 evidence retention:** §10
  provides the evidence-collection hooks and §11 the multi-region
  posture.
- **For a developer adding a new persistent field:** §3.4 is the
  classification rubric; you must classify any new field before
  merging.

The single most-important interaction is **CLAUDE.md invariant 3
(audit log is append-only)** vs. **GDPR Article 17 (right to
erasure)**. The resolution is the **redactable signed payload** model
formalized in `docs/decisions/0006-audit-redactability.md` and
summarized in §5 below.

---

## 2. Scope and authorities

### 2.1 In scope

Every persistent data class managed by OKORO in any storage system —
Postgres, Redis, S3 + GCS archive, Glacier + Coldline cold tier, KMS
key material, CF KV, CF D1 (Phase 3), notarization service.

### 2.2 Out of scope

- **Customer (RP) systems.** OKORO does not retain RP-internal data;
  RPs are responsible for their own retention per their own DPAs.
- **Agent private keys.** OKORO never holds them per CLAUDE.md
  invariant 1; SDKs handle this client-side.
- **Plaintext PII outside the audit chain.** PII in `Principal` rows
  is governed by §4 row P1; PII inside `AuditEvent` rows is governed
  by §5–§6 redaction.

### 2.3 Lawful basis (jurisdictional anchors)

| Jurisdiction | Authority                              | Why we comply                                         |
|--------------|----------------------------------------|-------------------------------------------------------|
| EU / EEA     | GDPR (Reg. 2016/679)                   | EU AI Act applicability + EU customer principals     |
| United States| SOC 2 Type II (AICPA), CCPA           | Customer-required attestation; CA principals         |
| United States (financial) | FINRA 17a-4, SEC Rule 17a-4 | Persona C in `docs/spec/04_COMMERCIAL_STRATEGY.md` may demand |
| United States (PCI scope) | PCI-DSS v4.0 §10              | RPs handling card data may require OKORO log retention |
| United Kingdom | UK GDPR + DPA 2018                  | Same as EU principle, separate legal entity          |
| Other        | Customer-DPA-driven                    | Negotiated per Enterprise contract                    |

The **strictest applicable retention floor** governs each data
class. Where two regimes conflict (e.g. SOC 2 evidence retention 7
years vs. GDPR data minimization), the audit-redaction model in §5
resolves both.

### 2.4 Cross-references to operator decisions

- **OD-004 (audit retention horizon):** sets the §4 P3 row's cold tier
  duration.
- **OD-007 (status page hosting):** affects §4 P9 (incident records)
  storage location.

---

## 3. Data class taxonomy

Every persistent field falls into one of nine classes. The class
determines retention, storage tier, encryption, and deletion flow.

### 3.1 Classification rules

A field is classified by **the strictest** of:
- **Identifiability:** can it be linked to a natural person? (PII)
- **Cryptographic role:** is it a key, signature, or chain element?
- **Operational role:** is it cache, queue state, or ephemeral?
- **Audit role:** does it form part of the signed audit chain?

Where a row contains multiple fields of different classes (e.g.
`AuditEvent` has signed-payload fields + redactable PII fields),
**each field is classified independently** and the row's deletion
flow is the union of per-field flows.

### 3.2 The nine classes

| Class | Symbol | Meaning |
|-------|--------|---------|
| Personal data — direct PII | P1 | Names, emails, principal contact |
| Personal data — indirect identifiers | P2 | IP addresses, user-agents in audit, RP-supplied agent metadata |
| Authentication & authorization secrets | P3 | API keys, session tokens, federated identity claims |
| Cryptographic material — public | P4 | Public keys, JWKS contents |
| Cryptographic material — private (KMS-held) | P5 | Audit signing key, policy signing key (KMS-only) |
| Audit chain — signed payload | P6 | The signed portion of `AuditEvent`; cryptographically immutable |
| Audit chain — redactable companion | P7 | The plaintext columns of `AuditEvent` co-located with their signed hashes |
| Operational state — durable | P8 | Spend records, trust score history, BATE signals |
| Operational state — ephemeral | P9 | Cache entries, DPoP nonces, BullMQ job state, incident-record open set |

### 3.3 Per-field classification table (selected)

Maintained in source: see `apps/api/prisma/schema.prisma` annotations
(via `/// @retention-class P1` doc-comments alongside each field).
The table below illustrates the principle for the ~20 most
auditor-relevant fields.

| Field path                                        | Class | Notes                                          |
|---------------------------------------------------|-------|------------------------------------------------|
| `Principal.email`                                 | P1    | Primary contact; subject to GDPR Art. 17      |
| `Principal.contactName`                           | P1    |                                                |
| `Principal.organizationName`                      | P1    | Legal-person but treated as P1 for safety     |
| `ApiKey.hashedKey`                                | P3    | Hashed, but enables re-issuance flow          |
| `ApiKey.lastUsedAt`                               | P2    | Operationally useful, indirectly identifying  |
| `AgentIdentity.publicKey`                         | P4    |                                                |
| `AgentIdentity.metadata` (RP-supplied JSON)       | P2    | RP must classify per its own DPA              |
| `AgentPolicy.scopes`                              | P6    | Part of signed policy JWT                     |
| `AgentPolicy.signedToken`                         | P6    |                                                |
| `AuditEvent.okoroSignature`                       | P6    | Cryptographic chain element                    |
| `AuditEvent.prevHash`                             | P6    |                                                |
| `AuditEvent.signedPayloadHash`                    | P6    | Hash of canonical payload                     |
| `AuditEvent.actionRaw` (free-text)                | P7    | Hash signed; raw redactable                   |
| `AuditEvent.relyingPartyRaw`                      | P7    |                                                |
| `AuditEvent.policySnapshotRaw`                    | P7    |                                                |
| `AuditEvent.requestedAmountRaw`                   | P7    |                                                |
| `AuditEvent.principalId`                          | P2    | Required for tenant filter; redactable to `redacted-{hash}` per ADR-0006 |
| `SpendRecord.amount`                              | P8    | Operationally durable; P2 if linked to PII   |
| `TrustScoreHistory.signalId`                      | P8    | Required for evidence trail                  |
| `BateSignal.payload`                              | P2    | RP-supplied evidence; classify per DPA        |
| `WebhookSubscription.endpointUrl`                 | P2    | Customer endpoint                             |
| `FederatedIdentity.subject` (Auth0 sub)           | P3    | Per ADR-0009                                  |
| `FederatedIdentity.email`                         | P1    |                                                |
| `Redis: agent:{id}:*`                             | P9    | Cache; reconstructable                        |
| `Redis: spend:*`                                  | P8    | Operationally durable; persisted via AOF      |
| `Redis: dpop:nonce:*`                             | P9    | TTL-bound                                     |
| `KMS: okoro-audit-signing-key/v{N}`               | P5    | KMS-internal; per ADR-0011                    |

### 3.4 Adding a new field — checklist

Before merging a Prisma schema change that adds any persistent field:

1. Add `/// @retention-class P{n}` doc-comment to the field.
2. If the field is P1, P2, or P7 → confirm a deletion path exists in
   §7.
3. If the field is P3 or P5 → confirm key-rotation impact in §9.
4. If the field is P6 → confirm the signed payload includes it
   intentionally; it cannot be redacted post-hoc.
5. Update §3.3 if the field is auditor-relevant.

---

## 4. Per-class retention table

The single most-consulted table in this document.

| Class | Storage primary               | Encryption at rest         | Hot retention      | Warm retention      | Cold retention | Lawful basis                         | Deletion mechanism                                                                                          | Owner                        |
|-------|-------------------------------|-----------------------------|--------------------|----------------------|----------------|---------------------------------------|------------------------------------------------------------------------------------------------------------|------------------------------|
| P1    | Postgres `Principal`, `FederatedIdentity` | TDE (Railway managed) | Active tenant lifetime | n/a               | n/a            | GDPR Art. 6(1)(b) (contract performance); GDPR Art. 6(1)(f) (legitimate interest) | Hard delete on tenant deletion request after 30-day grace                                                  | Engineering (data-deletion job) |
| P2    | Postgres various + `AuditEvent.principalId` | TDE | 18 months hot in Postgres | 18mo → 7yr S3+GCS  | 7yr → forever  | Same as P1 + GDPR Art. 17 (erasure)   | NULL out raw column; replace `principalId` with `redacted-{hash}`; meta event in audit chain (per §5)      | Engineering                  |
| P3    | Postgres `ApiKey`, `Session` (Argon2id-hashed) | TDE | Until revoke + 30-day grace | n/a            | n/a            | GDPR Art. 6(1)(b); SOC 2 CC6.1        | Hard delete after revoke + grace; predecessor key hashes preserved 90 days for forensics then deleted     | Engineering                  |
| P4    | Postgres `AgentIdentity.publicKey`, JWKS files | TDE; JWKS publicly served | Until agent revoke | n/a               | n/a            | GDPR Art. 6(1)(b); CLAUDE.md inv. 1   | Hard delete on revoke; JWKS published key-id remains in `keys-superseded` for 30 days for in-flight verifies | Engineering                  |
| P5    | KMS (AWS / GCP / Vault); never OKORO-DB | KMS-managed | Active key window (1 yr) | Disabled key 30 days post-rotation | Cryptographic destroy after 7 years | SOC 2 CC6.6; ADR-0011               | Soft-delete in KMS for 30 days; hard destroy after 7 years (per §9)                                       | Operator (KMS-IAM-protected) |
| P6    | Postgres `AuditEvent` (signed cols), S3+GCS archive, Glacier+Coldline | TDE (Postgres); AES-256-GCM (archive); KMS keys per partition | 18 months hot | 18mo → 7 yr S3+GCS | 7 yr → forever (legal hold) or `OD-004` cold horizon | SOC 2 CC4.1; FINRA 17a-4; PCI-DSS §10 | **Never deleted** by data path; chain integrity preserved forever for legal-hold partitions; rolloff drops from hot → warm → cold | Compliance + Engineering     |
| P7    | Postgres `AuditEvent` (raw cols) | TDE | 18 months hot | 18mo → 7 yr S3+GCS (encrypted) | (drops at warm→cold boundary unless legal hold) | GDPR Art. 17 vs. SOC 2 (resolved per §5) | NULL the raw column; meta `audit.redact` event in chain; signed payload hash remains so chain still verifies | Engineering (operator-authorized for redaction job) |
| P8    | Postgres `SpendRecord`, `TrustScoreHistory`, `BateSignal` | TDE | 18 months hot | 18mo → archive (NDJSON) | 7 yr → cold | SOC 2 CC4.1; auditor evidence trail   | Hard delete 7 years post-creation unless under legal hold; per-tenant erasure NULLs PII columns           | Engineering                  |
| P9    | Redis (cache / nonce / spend hot half) + BullMQ queues | At-rest via Railway-managed disk encryption | TTL-bound (≤ 24h) | n/a                 | n/a            | Operationally necessary; transient    | Natural TTL expiry; no manual deletion needed                                                            | Engineering                  |

### 4.1 Why P6 says "never deleted"

The signed payload columns of `AuditEvent` are **the trust artifact**.
Deletion would invalidate the chain for every subsequent event.
Instead:

- The companion P7 columns (raw plaintext) are redactable.
- The signed payload's hash leaves preserve the cryptographic
  attestation.
- Cold-tier rolloff at OD-004 horizon (7 years) means *the raw
  retrievable form* drops; the signed Merkle root remains in the
  notarization service indefinitely as a one-way trust pin.

Auditors verifying integrity 50 years from now can still verify the
chain root against the OpenTimestamps notarization, without holding
the raw events.

### 4.2 Spend records (P8) special case

Spend correctness is load-bearing for billing accuracy, not just
audit. We retain `SpendRecord` for 7 years to match SOC 2 evidence
horizon and customer billing dispute window. Per-tenant deletion
NULLs the link to the deleted tenant but preserves the aggregate row
(used for OKORO-side billing reconciliation).

### 4.3 Trust score history (P8) and ML training boundary

`TrustScoreHistory` rows are retained as **per-decision evidence**
("why did your trust score drop on date X?"). They are **not used for
ML model training** at Phase 1 — explicitly out of scope. If Phase 2
introduces ML model training on aggregate trust signals, a separate
DPA addendum covers the secondary-use lawful basis (likely GDPR Art.
6(1)(f) legitimate interest with opt-out).

---

## 5. The audit-immutability vs. right-to-erasure resolution

The **single hardest** retention question OKORO faces. Resolution:
**redactable signed payloads** per ADR-0006.

### 5.1 The conflict

- **CLAUDE.md inv. 3:** `AuditEvent` is append-only and
  cryptographically chained.
- **GDPR Art. 17:** A data subject has the right to erasure of their
  personal data on request.

A naïve interpretation of inv. 3 forbids deletion; a naïve reading of
Art. 17 demands it. Both are correct; the resolution is to separate
**what is signed** from **what is plaintext-readable**.

### 5.2 The mechanism

Each `AuditEvent` row has, in parallel:

- **Signed columns (P6):** `okoroSignature`, `prevHash`,
  `signedPayloadHash`, plus a fingerprint of every other field's
  value at append time. These are the inputs to the chain
  verification algorithm. **Immutable forever.**
- **Raw columns (P7):** `actionRaw`, `relyingPartyRaw`,
  `policySnapshotRaw`, `requestedAmountRaw`, plus `principalId` and
  any other identifier. These are the human-readable companion. **Can
  be NULLed.**

Verification flow: an auditor recomputes the hash of the raw column
and compares to the signed companion. If raw is NULL, verification
falls back to the stored hash directly — chain integrity is
preserved, but the raw value is unrecoverable.

### 5.3 The data subject experience

A data subject requests erasure (`DELETE /v1/principals/{id}`):

1. Soft delete on `Principal` for 30 days (legal grace per GDPR
   recitals 65–66).
2. After grace:
   - All P1 / P3 fields hard-deleted.
   - All P2 / P7 fields NULLed across all `AuditEvent` rows for that
     principal.
   - Meta `audit.redact` event written into the chain documenting
     the redaction (per ADR-0006 § "Operator authorization") with:
     - Redacted column list.
     - Operator who authorized erasure (or the data-subject-direct
       endpoint that triggered it).
     - Justification reference (ticket / DPA section).
3. `redactedAt` timestamp set on affected rows so subsequent reads
   know to suppress non-essential fields.

### 5.4 Documented residual risk

Per ADR-0006 § "Dictionary attack residual": where the principal set
is small, an attacker with hash-leaf access could brute-force common
plaintext values. The mitigation is per-event salt rotation (planned
Phase 2). Until then, this is a **disclosed residual** in DPAs and
DPO conversations. Operator-acknowledged in
`docs/FAILURE_MODES.md` Appendix A row 1.

---

## 6. Tenant deletion flow (operational)

### 6.1 Request paths

| Path                                              | Triggered by                       | Authentication                   |
|---------------------------------------------------|------------------------------------|-----------------------------------|
| `DELETE /v1/principals/{id}`                      | Programmatic (RP API)              | Principal-owner API key + step-up |
| Dashboard "Close account"                         | Tenant admin (UI)                  | Session + step-up + email confirm |
| Operator-initiated (DSAR via support email)       | Data subject through DPO inbox     | Manual operator + DPA verification |
| Court-ordered erasure                             | Legal counsel                      | Operator + signed legal-hold removal |

All four paths converge on the same `tenant-deletion.service.ts`
flow.

### 6.2 Per-step operations

```
T+0:00      Request validated; soft-delete on Principal.
T+0:01      Audit event: 'principal.deletion_requested' (signed, immutable).
T+0:01      Webhook: 'principal.deletion_requested' to operator + (if
            configured) the principal's secondary contact.
T+0:00      Pause new agent / policy creation under the principal.
T+0:00      Spend / verify continue (existing policies stay valid for
            grace window).

T+30 days   Background `deletion.executor` job:
T+30:00     Hard delete: ApiKey, Session, FederatedIdentity (P3).
T+30:00     Hard delete: AgentIdentity, AgentPolicy, WebhookSubscription
            (P4 + cascading P8 references).
T+30:00     Per AuditEvent for principal:
              UPDATE AuditEvent SET
                actionRaw = NULL,
                relyingPartyRaw = NULL,
                policySnapshotRaw = NULL,
                requestedAmountRaw = NULL,
                principalId = 'redacted-' || sha256(principalId || salt),
                redactedAt = now()
              WHERE principalId = $deletedPrincipalId
                AND redactedAt IS NULL;
T+30:01     Audit event: 'audit.redact' (signed, immutable) with
            redacted column list + operator + justification.
T+30:01     Hard delete Principal row.
T+30:02     Webhook: 'principal.deletion_complete'.
T+30:02     Update OperatorMetrics: tenant-count, deletion-completion-time.
```

The redaction is **idempotent**: re-running the executor on a
half-completed deletion is safe (UPDATE with `WHERE redactedAt IS
NULL` clause).

### 6.3 Failure modes during deletion

Per `docs/FAILURE_MODES.md` integration:

- KMS down (K-01) → meta `audit.redact` event blocked → redaction job
  retries; principal row deletion paused until meta event signs.
- Postgres replica lag → use primary for the redaction reads to avoid
  re-redacting already-redacted rows.
- Operator changes their mind during 30-day grace → `POST
  /v1/principals/{id}/restore` rolls back soft-delete; only valid
  before T+30:00 deletion-executor job kicks off.

### 6.4 Cross-region considerations

EU principal → deletion executes in the EU region only. US-region
DBs **do not** carry EU principal data per `docs/EU_RESIDENCY.md`.
Cross-region DSAR for an EU customer is rejected at request time —
the data physically isn't there.

---

## 7. Backup & snapshot retention

### 7.1 Backup tiers

| Backup type                | Storage                  | Retention | Encryption                        | Restore RTO                  |
|----------------------------|--------------------------|-----------|------------------------------------|------------------------------|
| Postgres continuous archive (WAL) | Railway-managed       | 7 days    | TDE + KMS-encrypted at rest        | Point-in-time, RTO 60 min    |
| Postgres daily snapshot    | Railway-managed + S3 mirror | 30 days   | TDE + AES-256-GCM at rest          | RTO 30 min                   |
| Postgres weekly snapshot   | S3 + GCS dual            | 90 days   | AES-256-GCM with per-snapshot KEK  | RTO 4 hours                  |
| Postgres monthly snapshot (compliance) | Glacier + Coldline | 7 years   | AES-256-GCM + KMS envelope         | RTO 24-48 hours              |
| Redis snapshot (cache + spend) | S3                   | 7 days    | AES-256-GCM                        | Cache reconstructable; spend snapshot used only in disaster |
| KMS key material           | KMS-internal             | per §9    | KMS-managed HSM                    | Not user-restorable          |

### 7.2 Backup interaction with deletion

A subtle but important point: a tenant deletion request must propagate
to backups. Implementation:

- Backups are encrypted with KMS-held keys.
- For monthly compliance snapshots, the KMS key is **per-snapshot**.
- "Tenant erasure on backup" is achieved by **destroying the
  per-snapshot KMS key** at the next compliance review for any
  snapshot containing only the deleted-tenant data — making the
  backup cryptographically unreadable. Industry-standard
  cryptographic-erasure pattern (NIST SP 800-88).
- For snapshots covering multiple tenants (the common case), the
  snapshot is preserved; access is gated by per-tenant key
  derivation, and the deleted tenant's key is destroyed.

This means: **the data physically remains on backup storage but is
cryptographically unrecoverable** — sufficient for GDPR Art. 17 per
DPA Working Party Opinion 05/2014 §III.B.

### 7.3 Backup verification

Per `FAILURE_MODES.md` row O-06 (highest RPN in the document):
quarterly DR rehearsal restores from a backup, runs smoke tests, and
verifies chain integrity. Failing rehearsal is a P1 incident.

---

## 8. Audit archive lifecycle

### 8.1 Hot → warm transition (18 months)

Per ARCHITECTURE.md §12.2 + CAPACITY_PLAN.md §5.4:

```
Month N detach trigger (cron 1st of month, 04:00 UTC):
1. DETACH PARTITION CONCURRENTLY for partition (now - 18 months)
2. Export to NDJSON: stream rows to S3 + GCS
3. Compute Merkle root of canonical event hashes
4. Sign Merkle root with current audit signing key (KMS)
5. Publish to /.well-known/audit-archive-roots.json
6. Submit Merkle root to OpenTimestamps notarization
7. Verify archive: re-stream from S3, recompute Merkle, compare to signed root
8. If verified: DROP TABLE detached partition.
9. If not verified: re-attach partition, alert operator, abort rolloff.
```

Per FAILURE_MODES.md AC-02, partition rolloff is the highest-risk
audit-chain operation.

### 8.2 Warm → cold transition (7 years from creation)

```
Year Y partition (created 7 years ago):
1. Verify archive Merkle root still publishes correctly.
2. Confirm OpenTimestamps notarization persists.
3. Migrate from S3 standard + GCS standard → Glacier Deep Archive +
   Coldline Archive.
4. Update /.well-known/audit-archive-roots.json with new tier marker
   (URL changes; root unchanged).
5. Restore SLA changes from minutes (warm) to 24-48 hours (cold).
```

### 8.3 Cold → forever (legal hold)

Per OD-004 (operator-pending), the cold tier is the **forever** tier
for OKORO — we do not cryptographically destroy notarized audit
roots. The notarization remains as the trust pin even after raw
events are unrecoverable (which would only happen via legal-hold
release + intentional cryptographic erasure).

### 8.4 Archive integrity guarantees

Three-way pinning per archive partition:

1. **Internal** signed Merkle root in `/.well-known/audit-archive-
   roots.json`.
2. **External** OpenTimestamps proof (Bitcoin blockchain anchored).
3. **Customer-export** ability to download per-principal NDJSON and
   re-verify against (1).

A discrepancy between (1) and (2) is FAILURE_MODES.md AC-05 (highest
P1 audit-chain incident).

---

## 9. Key lifecycle (P5)

Per ADR-0011 + KMS module M-023.

### 9.1 Per-key lifecycle states

| State          | Definition                                              | Transition trigger                       |
|----------------|----------------------------------------------------------|------------------------------------------|
| `provisioning` | KMS key creation in progress                            | Operator action via `okoro-cli kms rotate` |
| `pre-active`   | Key exists; not yet signing; in JWKS as 30-day-future tag | Provisioning complete                    |
| `active`       | Currently signing audit + policy events                 | Rotation cron at month boundary          |
| `superseded`   | Was active; new key took over; still verifies in JWKS   | New key promoted to active                |
| `retired`      | Removed from JWKS; soft-delete state in KMS             | 30-day overlap window expires             |
| `destroyed`    | KMS key material cryptographically destroyed             | 7 years after retirement                  |

### 9.2 Rotation cadence

- **Audit signing key:** annual rotation (default), with 30-day
  overlap.
- **Policy signing key:** annual rotation, 30-day overlap.
- **Emergency rotation:** any time, triggered by suspected
  compromise; immediate disable of compromised key, immediate
  promotion of standby key.

### 9.3 Why 7-year destruction window

A destroyed signing key cannot verify historical signatures it
produced. To preserve the auditor's ability to verify a 7-year-old
event:
- Retain the key material in KMS soft-delete state for 7 years.
- After 7 years, archived events are validated via the **Merkle root
  notarization chain**, not the original signing key. Cryptographic
  destruction at 7 years is therefore safe.

### 9.4 Provider-specific destruction

| Provider | Soft-delete window | Hard destroy mechanism |
|----------|---------------------|--------------------------|
| AWS KMS  | 7 days max (AWS limit) — we maintain 7-year shadow in `infra/kms/key-shadow/{kid}.enc` (envelope-encrypted by master KMS key, can re-import to KMS) | `aws kms schedule-key-deletion` after 7 years |
| GCP KMS  | 30 days max (GCP limit) — same 7-year shadow strategy | `gcloud kms keys versions destroy` |
| Vault Transit | configurable; we set 7-year retention with operator-gated destroy | `vault delete transit/keys/{name}` |

The shadow strategy means **OKORO holds an envelope-encrypted copy
of every signing key** for 7 years. The envelope key is separate from
the audit signing key (KMS master key) and rotates independently. A
breach of one tier does not unlock the other.

---

## 10. Auditor evidence collection

### 10.1 Standard reports (auto-generated)

| Report                                  | Cadence       | Format             | Audience                  |
|------------------------------------------|---------------|--------------------|---------------------------|
| Per-tenant data inventory               | On request    | CSV / JSON          | DPA reviewer / DPO         |
| Retention compliance attestation        | Annual        | Signed PDF          | SOC 2 Type II auditor      |
| Deletion log (last 12 months of DSARs)  | Quarterly     | CSV                 | DPO + operator             |
| Backup verification report              | Quarterly     | Markdown + chain-verify output | SOC 2 auditor    |
| KMS rotation history                    | Annual        | Signed JSON         | SOC 2 auditor              |
| Per-archive Merkle root publication log | Continuous    | Public endpoint     | Customers + external auditors |

### 10.2 Per-tenant export (DSAR fulfillment)

`GET /v1/principals/{id}/data-export` returns all P1, P2, P3, P7, P8
data for a tenant, encrypted with a one-time DSAR key delivered to
the tenant via the dashboard's verified email channel. Format:
NDJSON archive matching the audit-export schema.

### 10.3 Continuous attestation (`/.well-known/`)

| Endpoint                                | Purpose                                       |
|-----------------------------------------|-----------------------------------------------|
| `/.well-known/audit-signing-key`        | Current audit signing public key (P4)         |
| `/.well-known/jwks.json`                | All current + recent signing keys (P4)        |
| `/.well-known/audit-archive-roots.json` | Per-month archive Merkle roots (P6)           |
| `/.well-known/retention-policy.json`    | Machine-readable summary of this document     |

The last endpoint is auto-generated from this document's per-class
table; drift between the document and the endpoint is a CI failure.

---

## 11. Multi-region & EU residency interaction

Per `docs/EU_RESIDENCY.md`:

### 11.1 Per-region scope

| Region        | What lives here                       | What does not          |
|---------------|----------------------------------------|------------------------|
| us-east       | US-residency principals' P1–P9        | EU principals, AP principals |
| eu-west       | EU-residency principals' P1–P9        | US, AP                 |
| ap-southeast  | AP-residency principals' P1–P9        | US, EU                 |

KMS keys are **per-region**: an EU principal's audit events are
signed by an EU-region KMS key. Cross-region replication of KMS keys
is for failover within a residency boundary only.

### 11.2 DSAR routing

- Request lands in any region's API.
- API checks `Principal.dataResidency`.
- Cross-region request → routed to the appropriate region's
  deletion executor.
- US-region executor cannot delete EU data and vice versa (RBAC +
  network-level enforcement).

### 11.3 Audit archive cross-region

Each region's archive is independent. There is **no global archive
root**; per-region Merkle roots publish independently. A multi-region
auditor verifies each region separately.

### 11.4 Backup cross-region

Backups stay in-region. EU backups in EU storage providers (AWS EU
+ GCP EU). Cross-region backup replication is **explicitly
forbidden** for EU principals per GDPR Schrems II considerations.

---

## 12. Legal hold mechanism

When OKORO receives a legal hold (subpoena, regulatory inquiry,
litigation hold):

### 12.1 Hold semantics

- A hold attaches to a `Principal` (and optionally specific
  `AuditEvent` rows or partitions).
- Held data **cannot be redacted, deleted, or rolled off to cold
  tier without legal authorization** — including blocking the
  deletion executor in §6.
- Held data **is not** backed up or replicated to additional
  locations during hold (avoids creating new copies that complicate
  release).

### 12.2 Hold lifecycle

| State          | Trigger                                |
|----------------|----------------------------------------|
| `requested`    | Legal counsel files hold form          |
| `active`       | Operator confirms via `okoro-cli legal-hold create --principal {id}` |
| `release-requested` | Legal counsel files release         |
| `released`     | Operator confirms; deletion executor resumes |

### 12.3 Conflict with deletion request

If a tenant requests deletion while a legal hold is active:

- Deletion request is **acknowledged within statutory window**
  (GDPR: 1 month).
- Response explains the legal-hold delay (per GDPR Art. 12(3)).
- Soft-delete proceeds; hard delete is paused; PII redaction is
  paused for held columns.
- Tenant is informed of expected resolution timeline.

### 12.4 Cross-references

- `docs/COMPLIANCE.md` § "Legal hold" (procedural detail).
- `docs/SECURITY_RUNBOOK.md` § "Subpoena response" (operational).

---

## 13. Annual review cadence

| Review                        | Frequency       | Owner                  | Output                                   |
|-------------------------------|-----------------|------------------------|------------------------------------------|
| Per-PR field classification   | Every schema PR | Reviewer               | §3.3 + retention class doc-comment       |
| Quarterly archive verification| Quarterly       | SRE                    | Backup-verification report (auditor input) |
| Quarterly DSAR digest         | Quarterly       | DPO + operator         | Deletion log + open-DSAR list            |
| Annual policy review          | Q1              | Operator + outside counsel | Updated lawful-basis table; new jurisdictions |
| Annual SOC 2 evidence pull    | Q3 (pre-audit)  | Operator               | Signed retention attestation             |
| ADR-0006 dictionary-attack residual review | Annual | Operator + DPO       | Either mitigation or extended residual disclosure |

---

## 14. Cross-references

| Topic                         | Source                                                       |
|-------------------------------|---------------------------------------------------------------|
| Architecture summary          | `docs/ARCHITECTURE.md` §12                                    |
| Capacity (storage growth)     | `docs/CAPACITY_PLAN.md` §5.4 + §11.3                         |
| Failure modes (deletion + chain) | `docs/FAILURE_MODES.md` §6, §11                            |
| Audit chain canonicalization  | `docs/decisions/0005-audit-chain-canonicalization.md`         |
| Audit redactability (P6+P7)   | `docs/decisions/0006-audit-redactability.md`                  |
| KMS rotation (P5)             | `docs/decisions/0011-key-rotation-kms.md`                     |
| Compliance posture            | `docs/COMPLIANCE.md`                                          |
| EU residency                  | `docs/EU_RESIDENCY.md`                                        |
| Operator decisions            | `OPERATOR_DECISIONS.md` OD-004                                |
| Auth0 federated identity      | `docs/decisions/0009-auth0-bridge.md`                         |

---

## Appendix A — alignment with regulatory horizons

| Regulator / standard      | Required floor                | OKORO provides                     | Comment                              |
|---------------------------|--------------------------------|-------------------------------------|--------------------------------------|
| GDPR Art. 17              | Erasure on request             | Redaction + crypto-erasure on backup | Per §5–§7                            |
| GDPR Art. 30 (records)    | Records of processing activities | Per-tenant data inventory (§10.2)   |                                      |
| SOC 2 CC4.1               | Records retained               | Forever for P6 (audit), 7yr for P8 (operational) | Per §4 + §8                  |
| SOC 2 CC6.6               | Key management                 | Per §9 + ADR-0011                    |                                      |
| SOC 2 CC7.4               | Incident communication         | Per ARCHITECTURE.md §9               |                                      |
| FINRA 17a-4               | 6 years on most records        | 7 years cold tier                    | Exceeds floor                        |
| SEC 17a-4                 | 7 years (some 6)               | 7 years cold tier                    | Meets floor                          |
| PCI-DSS v4.0 §10          | 1 year online + 3 years archive | Audit chain forever                  | Vastly exceeds                       |
| CCPA 1798.105             | Erasure                        | Same as GDPR Art. 17                 |                                      |
| EU AI Act (high-risk)     | Logs of decision provenance   | Per-decision audit chain             | OKORO is the substrate for RPs to meet this |
