# AEGIS — Disaster Recovery Runbook

> Companion to [`RUNBOOK.md`](./RUNBOOK.md) (everyday ops) and
> [`SECURITY.md`](./SECURITY.md) (threat catalog). This document is the
> **disaster** lane: how AEGIS recovers when the everyday lane is broken.
>
> **Update trigger**: any production incident, any tabletop exercise, any
> change to RTO/RPO, or any new disaster category. Postmortems land in
> [`./decisions/`](./decisions/) when they yield architectural change.

---

## Scope

Five disaster categories are in scope:

1. **Region outage** — Railway, Cloudflare, or Postgres host region down.
2. **Database corruption** — application bug, bad migration, or storage corruption.
3. **Key compromise** — AEGIS audit-signing private key leaked or suspected leaked.
4. **Ransomware on Railway** — operational hosting compromised, attacker has live access.
5. **Supply-chain breach** — malicious code in a dependency reaches production.

Out of scope:

- Customer-side compromises (their agent private keys, their workstations) — we provide audit trails to detect those, not to recover from them.
- Quantum break of Ed25519 — covered separately in [`POST_QUANTUM_ROADMAP.md`](./POST_QUANTUM_ROADMAP.md).

---

## RTO / RPO

| Target | Value     | Justification                                                                          |
|--------|-----------|----------------------------------------------------------------------------------------|
| RTO    | 30 min    | Matches the incident-response SLA. Verified weekly by [`../infra/backup/restore-drill.sh`](../infra/backup/restore-drill.sh). |
| RPO    | 5 min     | Audit chain is SOC2 evidence; >5 min unrecoverable would void the "complete records" claim under CC7.2. |

Both are pinned by the pgBackRest configuration at
[`../infra/backup/pgbackrest.conf`](../infra/backup/pgbackrest.conf)
(`archive-async=y`, `start-fast=y`, `delta=y`,
`archive-push-queue-max=1GiB`).

---

## Per-disaster playbook

Each playbook below answers four questions: how do we **detect** it, what
is our **immediate response**, what are the **recovery steps**, and how
do we **communicate**. Every playbook closes with a postmortem step that
lands in [`./decisions/`](./decisions/) when it yields architectural change.

### 1. Region outage

- **Detection signal**:
  - Cloudflare reports origin unreachable; status page (operator-wired) flips.
  - `/v1/health/ready` non-2xx for >2 min from external monitoring.
  - Railway status dashboard shows the region degraded.
- **Immediate response**:
  - Page on-call. Acknowledge within 5 min.
  - Status page → "investigating".
  - Confirm whether the failure is regional vs. account-level (try
    `railway whoami`, then check if a sibling project is also down).
- **Recovery steps**:
  - If Railway-region failure: redeploy the API + worker services to a
    secondary region. Postgres failover requires a hot standby — Phase 2
    introduces a Railway read replica + manual promote runbook; until
    then, recovery from a regional storage failure requires the backup
    flow (see playbook 2). Until standby exists, RTO in this case
    degrades to ~60 min, not 30 — the gap is documented in [`./decisions/`](./decisions/) for closure in Phase 2.
  - If Cloudflare-only: temporarily change DNS to Railway's `*.up.railway.app` hostname while keeping HSTS valid (the API hostname has not been pre-registered with Cloudflare-only-issued certs; operator validates).
- **Comms protocol**: status page updates every 15 min; email security@ + on-call distribution list at start, 30-min mark, and resolution.
- **Success criteria**: `/v1/health/ready` 200 for 5 consecutive checks; verify path p99 returns to baseline (see [`SLO.md`](./SLO.md)).
- **Postmortem**: ADR if the RTO target was missed.

### 2. Database corruption

- **Detection signal**:
  - Audit chain verification fails (reproducible across replicas).
  - Prisma queries return wildly different counts run twice in a row.
  - Application errors spike with FK or constraint failures that imply schema mismatch.
- **Immediate response**:
  - **Freeze writes**: turn on the global read-only flag (Phase 2 — until then, scale the API to 0 and the worker to 0). Audit events are append-only; pausing writes prevents the chain from extending further over corrupt data.
  - Page on-call. Status page → "degraded — write pause".
  - Snapshot Postgres before doing anything else (`pg_dump` to a side bucket — gives us a forensic copy).
- **Recovery steps**:
  - Identify the last known-good timestamp from the most recent passing
    audit chain verification.
  - Run [`../infra/backup/restore-drill.sh --execute --target-time <T>`](../infra/backup/restore-drill.sh) into a temp Postgres.
  - Verify row counts and audit chain on the recovered instance.
  - Promote: swap `DATABASE_URL` in Railway to the recovered instance,
    or `pg_dump` from the recovered instance back into the primary.
  - Re-enable writes; let the BullMQ webhook DLQ flush.
- **Comms protocol**: status page; targeted email to enterprise customers; private post-mortem note to SOC2 auditor.
- **Success criteria**: chain verification across 100% of restored events; no write 4xx for 15 min post-resume.
- **Postmortem**: mandatory ADR — corruption events always reveal something architectural.

### 3. Key compromise (audit-signing key)

- **Detection signal**:
  - Suspected leak (laptop seized, secret manager log shows unauthorised access, key spotted in a paste site, etc.).
  - Audit chain verification reveals a signature that matches the key but came from an unexpected source IP / time.
- **Immediate response**:
  - Treat as P0 — page on-call within 5 min, two-person attendance.
  - Mint a NEW keypair off-band ([`../infra/kms/rotate-aegis-keys.sh --execute`](../infra/kms/rotate-aegis-keys.sh)).
  - Status page: planned key rotation announcement (do NOT publicise compromise yet).
- **Recovery steps**:
  - Run the rotation runbook ([`../infra/kms/rotation-runbook.md`](../infra/kms/rotation-runbook.md)) end-to-end — but **collapse the 7-day pre-announcement window** to immediate.
  - Add a `revokedAt` timestamp to the previous key in JWKS (the wellknown service must distinguish "rotated, still valid for old events" from "compromised, do not trust"). Spec for `revokedAt` field is open — it does not yet exist on the JWK output. **TODO**: extend [`../apps/api/src/modules/wellknown/wellknown.service.ts`](../apps/api/src/modules/wellknown/wellknown.service.ts) to optionally emit `revoked: true` + `revokedAt` per key.
  - Replay every audit event signed by the old key against a known-good replica; if any signatures differ, the chain broke under the compromised key — escalate to playbook 2.
- **Comms protocol**: notify SOC2 auditor + every enterprise customer within 24 hours per contract; public status page note within 72 hours per regulatory minimum.
- **Success criteria**: new key live, old key marked revoked in JWKS, audit chain verified end-to-end.
- **Postmortem**: mandatory ADR + threat-model row update.

### 4. Ransomware on Railway

- **Detection signal**:
  - Production environment behavior diverges from CI artefacts (file hashes, image digests, running config).
  - Unexpected env-var changes, unauthorised deploys, suspicious processes.
  - Ransom note (out-of-band).
- **Immediate response**:
  - **Do not power off** — preserve evidence.
  - Revoke Railway access tokens (operator + CI). Rotate the deploy key.
  - Status page: full outage. Take the production hostname offline at the Cloudflare layer (block all rules) so the attacker cannot serve responses to clients.
- **Recovery steps**:
  - Stand up a fresh Railway project (different account if account-level compromise suspected) from CI artefacts.
  - Restore Postgres from backup ([`../infra/backup/restore-drill.sh`](../infra/backup/restore-drill.sh)) into the fresh project.
  - Mint new keys (key rotation runbook with the compromise collapse).
  - Mint new pgBackRest cipher pass.
  - Reissue every customer's API key plaintext — they must rotate; old hashes may be in attacker hands.
  - Switch DNS at Cloudflare to the fresh project; lift the WAF block.
- **Comms protocol**: customer notification within contractual SLA (24h enterprise, 72h public); regulator notification per [`EU_RESIDENCY.md`](./EU_RESIDENCY.md) and US state laws.
- **Success criteria**: every secret in production is younger than the suspected compromise window.
- **Postmortem**: full external review; ADR; threat-model overhaul.

### 5. Supply-chain breach (malicious dependency in production)

- **Detection signal**:
  - GitHub Dependabot / OSV report on a dependency we ship.
  - Sentry shows unexpected outbound calls to an unknown destination
    (egress audit feed — see
    [`../infra/network/egress-policies.md`](../infra/network/egress-policies.md)).
  - CodeQL or Semgrep flags new behavior in a recent dependency bump.
- **Immediate response**:
  - Pin to the last known-good version of the affected dependency in
    `pnpm-lock.yaml`; emergency deploy.
  - Status page: maintenance window.
- **Recovery steps**:
  - Audit the time window from "compromised version went live" to "rollback deployed". Anything signed by AEGIS during that window is suspect.
  - If the compromised dep had access to the audit-signing key (i.e. running inside the API process), escalate to playbook 3 (key compromise).
  - File CVE / coordinated disclosure if the issue is novel.
- **Comms protocol**: status page; CVE disclosure if applicable; SOC2 incident note.
- **Success criteria**: clean dependency tree, no anomalous outbound calls for 7 days.
- **Postmortem**: ADR if the breach exposes a tooling gap (e.g. no SBOM, no signed artifacts).

---

## Tabletop schedule

Quarterly. Rotate through the five disaster types so each is exercised at
least once every 15 months. The on-call team runs the tabletop without
touching production — paper-only — and writes a `dr-tabletop-<date>.md`
into [`./decisions/`](./decisions/) afterwards covering:

- The scenario walked through.
- Which steps in the playbook didn't match reality.
- The fix list (track each as a follow-up issue).
- Whether any RTO/RPO target was met.

The first tabletop is scheduled for 60 days after AEGIS production go-live (operator decision: exact date TBD).

---

## Decision log integration

Every DR event — real incident or tabletop — produces a postmortem.
Postmortems that yield architectural change land as ADRs in
[`./decisions/`](./decisions/) using the existing two ADRs as the format
template:

- [`./decisions/0001-cuid-vs-ulid.md`](./decisions/0001-cuid-vs-ulid.md)
- [`./decisions/0002-non-custodial-key-policy.md`](./decisions/0002-non-custodial-key-policy.md)

---

## Cross-references

- [`./RUNBOOK.md`](./RUNBOOK.md) — everyday operations.
- [`./SECURITY.md`](./SECURITY.md) — threat catalog + denial precedence.
- [`./THREAT_MODEL.md`](./THREAT_MODEL.md) — threat rows the playbooks above respond to.
- [`./SLO.md`](./SLO.md) — error-budget framing for the "success criteria" lines.
- [`../infra/backup/`](../infra/backup/) — backup config, verifier, restore drill.
- [`../infra/kms/`](../infra/kms/) — key rotation runbook + driver.
- [`../infra/network/`](../infra/network/) — ingress + egress policies.

## Open operator decisions flagged by this runbook

1. Two-person concurrence for `--execute` of the rotation driver — policy or code? (See [`../infra/kms/rotation-runbook.md`](../infra/kms/rotation-runbook.md) TODO #3.)
2. First tabletop date.
3. Phase 2 standby Postgres + read-replica plan (closes the 60-min RTO gap noted in playbook 1).
4. `revoked: true` extension to the JWKS output (playbook 3 needs this to distinguish rotation from compromise).
5. SSRF check for webhook delivery — release blocker before non-internal webhooks ship (see [`../infra/network/egress-policies.md`](../infra/network/egress-policies.md)).
