# AEGIS — Backups (operator-facing)

> Stanza: `aegis`. Engine: pgBackRest. Repo: S3-compatible object store
> (Cloudflare R2 / Backblaze B2 / AWS S3 — operator's pick).

This is the operator-facing index. Implementation files in this directory:

- [`pgbackrest.conf`](./pgbackrest.conf) — stanza configuration (mounted to `/etc/pgbackrest/pgbackrest.conf`).
- [`verify-backup.sh`](./verify-backup.sh) — daily lightweight verifier (cron, 02:00 UTC).
- [`restore-drill.sh`](./restore-drill.sh) — weekly heavyweight restore drill (cron, Sunday 03:00 UTC).

For the cross-disaster playbook, see [`../../docs/DR_RUNBOOK.md`](../../docs/DR_RUNBOOK.md).
For the dev-side runbook (local Postgres, Prisma migrations), see
[`../../docs/RUNBOOK.md`](../../docs/RUNBOOK.md) — this document does **not**
duplicate it.

---

## What we backup

**Engine state**: Postgres 16 cluster (the data directory at `/var/lib/postgresql/data`). The schema is owned by Prisma migrations — see `apps/api/prisma/schema.prisma` for the source of truth. The tables that matter most for SOC2 evidence:

- `Principal` — the tenant identity tree.
- `AgentIdentity` — the public-key registry. (Private keys are NOT held by AEGIS — see `CLAUDE.md` invariant #1. We do not back up anything we never had.)
- `AuditEvent` — append-only signed audit chain. Cannot be reconstructed; **this is the irreplaceable table**.
- `Policy`, `WebhookSubscription`, `WebhookDelivery`, `BateSignal` — operational state.

**Not in scope**:
- Redis (cache + ephemeral queue state — recoverable from Postgres + replay).
- Object storage outside Postgres (we have none in v1).
- Application logs — those flow to the observability stack, not the DB.

---

## Where backups live

S3-compatible bucket. The exact bucket name + region + endpoint live in your
secret manager and are wired into `pgbackrest.conf` at deploy time. Operator
must provision:

- Bucket with **object versioning ON** and **object lock ON** (write-once, ransomware mitigation).
- Lifecycle rule that respects `repo1-retention-full=14` (don't delete out from under pgBackRest).
- IAM credentials with `s3:GetObject`, `s3:PutObject`, `s3:ListBucket`, `s3:DeleteObject` on the bucket only.
- Bucket-level encryption at rest (S3 SSE-KMS or R2 default encryption).
- A second copy via cross-region replication if your RTO/RPO targets warrant it (Phase 2).

The `repo1-cipher-pass` adds a second encryption layer at the application
level: even if the bucket leaks, an attacker without the cipher pass has
nothing usable. Rotate this passphrase on the same cadence as the AEGIS
audit signing key — see [`../kms/rotation-runbook.md`](../kms/rotation-runbook.md).

---

## RTO / RPO

| Target | Value     | Why                                                                                                         |
|--------|-----------|-------------------------------------------------------------------------------------------------------------|
| RTO    | 30 min    | Matches incident-response SLA. Drives `delta=y`, `start-fast=y`, `process-max=4` in `pgbackrest.conf`.       |
| RPO    | 5 min     | AEGIS audit log is SOC2 evidence; >5 min of unrecoverable audit events would void the "complete records" claim under CC7.2. Drives `archive-async=y` + a 1 GiB push queue. |

The per-disaster recovery flow is in [`../../docs/DR_RUNBOOK.md`](../../docs/DR_RUNBOOK.md).

---

## How to restore

1. **Decide the target time.** Default is "now minus one minute". For a
   corruption / ransomware case, the target is the last known-good
   timestamp — read the audit chain output of the last successful
   `restore-drill.sh` run for a starting point.
2. **Run the drill in dry-run first**:
   ```bash
   ./restore-drill.sh --target-time 2026-05-01T12:00:00Z
   ```
   This validates the stanza, confirms the latest backup is fresh, and
   exits before touching any state. Pass `--json` for machine-readable
   output.
3. **When ready, execute**:
   ```bash
   ./restore-drill.sh --execute \
     --target-time 2026-05-01T12:00:00Z \
     --source-counts /tmp/source-counts.txt
   ```
   Where `/tmp/source-counts.txt` looks like:
   ```
   Principal=42
   AgentIdentity=1337
   AuditEvent=2810933
   ```
4. **Promote the temp Postgres** — the drill spins up a temp Postgres on
   `127.0.0.1:55432`. After the drill passes, swap your application
   `DATABASE_URL` to point at the recovered instance, or use this
   instance to dump+reload into the production cluster.
5. **Audit chain verification**: the drill calls
   `pnpm --filter @aegis/api audit:verify-chain --since <target>`. The
   `audit-chain.util.ts` foundation exists at
   [`../../apps/api/src/common/crypto/audit-chain.util.ts`](../../apps/api/src/common/crypto/audit-chain.util.ts);
   the CLI wrapper is tracked as M-006-ext in
   [`../../docs/SESSION_HANDOFF.md`](../../docs/SESSION_HANDOFF.md). Until
   that ships, the drill emits a `WARN: chain verification deferred` and
   runs a placeholder count. **Do not treat the drill as fully green
   until M-006-ext ships.**

Exit codes from `restore-drill.sh`:

| Code | Meaning                                                                |
|------|------------------------------------------------------------------------|
| 0    | PASS                                                                    |
| 2    | usage / argument error                                                  |
| 3    | prerequisite missing (pgbackrest, docker, psql)                         |
| 10   | newest backup older than `--max-backup-age-hours` (default 24h)         |
| 11   | restore failed (Docker, pgbackrest, or Postgres readiness)              |
| 12   | row-count drift vs `--source-counts` file                               |
| 13   | audit chain verification failed                                         |
| 14   | cleanup / teardown failed                                               |

---

## How to verify

`verify-backup.sh` runs daily and is the lightweight gate. It calls
`pgbackrest verify --stanza=aegis` and exits non-zero on any error. It
does **not** restore data — it checksums what is in the repo against the
manifest. Wire its non-zero exit to your alert sink (PagerDuty, Slack,
email — operator's call).

---

## Cron schedule

Operator wires these on the backup host (we deliberately do not commit a
crontab; cron contents are environment-specific). Recommended:

```
# Lightweight daily verifier — wakes everyone up if it fails.
0 2 * * *    /opt/aegis/infra/backup/verify-backup.sh --json >> /var/log/aegis/verify-backup.log 2>&1

# Heavyweight weekly drill — exercises restore end-to-end.
0 3 * * 0    /opt/aegis/infra/backup/restore-drill.sh --execute --json >> /var/log/aegis/restore-drill.log 2>&1
```

A failed run of either should page the on-call engineer. The drill log
should be retained for one year as SOC2 evidence of recoverability
testing (control CC7.5).

> **Permission bit**: both shell scripts ship with the executable shebang
> but the on-disk mode is set by the operator at first commit
> (`chmod 755 verify-backup.sh restore-drill.sh`). Pre-commit hooks should
> enforce this.

---

## Failure modes

| # | Failure                                       | Detection                                                | Mitigation                                                                                          |
|---|-----------------------------------------------|----------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| 1 | Repo unreachable (S3 outage / IAM revoke)     | `verify-backup.sh` exit 20; archive-push queue fills.    | Failover repo (`repo2-*` in pgBackRest); page operator to triage IAM. WAL push pauses at 1 GiB cap. |
| 2 | Cipher pass lost                              | Restore drill exit 11 with "unable to decrypt".          | Recover from secret manager backup. Without the pass, every backup is a brick — treat as P0.       |
| 3 | Backup age > 24h (archive failing silently)   | `restore-drill.sh` exit 10 (BACKUP_TOO_OLD).             | Investigate `archive-push` errors in pgBackRest log; check S3 IAM + DNS resolution from db host.   |
| 4 | Audit chain mismatch after restore            | `restore-drill.sh` exit 13 (CHAIN_FAIL) once M-006-ext ships. | Treat as data-integrity incident — see `../../docs/DR_RUNBOOK.md` § "DB corruption".              |
