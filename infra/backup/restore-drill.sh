#!/usr/bin/env bash
# =============================================================================
# AEGIS — Production restore drill
# =============================================================================
# Verifies that the latest pgBackRest backup of the `aegis` stanza is restorable
# and that the audit chain remains intact across the restore boundary.
#
# Default mode: DRY RUN. No restore is performed unless --execute is passed.
#
# Cron:        weekly, Sunday 03:00 UTC (operator wires this — see README.md).
# Companion:   verify-backup.sh runs daily and is the lightweight gate;
#              this script is the heavyweight gate that exercises restore.
#
# Exit codes (structured):
#    0  PASS
#    2  usage / argument error
#    3  prerequisite missing (pgbackrest, docker, psql)
#   10  most recent backup is older than --max-backup-age (default 24h)
#   11  restore failed
#   12  post-restore row count drift vs --source-counts
#   13  audit chain verification failed
#   14  cleanup / teardown failed
# =============================================================================
set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────────────
STANZA="aegis"
EXECUTE=0
KEEP=0
JSON=0
TARGET_TIME=""
SOURCE_COUNTS=""
MAX_BACKUP_AGE_HOURS=24
TEMP_PG_IMAGE="postgres:16-alpine"
TEMP_PG_NAME="aegis-restore-drill-$$"
TEMP_PG_PORT="55432"
TEMP_PG_PASSWORD=""
RESTORE_DIR=""
LOG_TS="$(date -u +%Y%m%dT%H%M%SZ)"

usage() {
  cat <<'EOF' >&2
restore-drill.sh — exercise the AEGIS pgBackRest restore path.

Usage:
  restore-drill.sh [--execute] [--keep] [--json]
                   [--target-time <RFC3339>]
                   [--source-counts <file>]
                   [--max-backup-age-hours <N>]

Options:
  --execute                  perform the restore (otherwise dry run only)
  --keep                     do not tear down the temp Postgres on success
  --json                     emit one structured JSON line on stdout
  --target-time <ts>         PITR target (default: now - 1m)
  --source-counts <file>     file with KEY=N pairs:
                               Principal=<n>
                               AgentIdentity=<n>
                               AuditEvent=<n>
                             missing keys are skipped, not failed
  --max-backup-age-hours <N> fail if newest backup older than this (default 24)
  -h, --help                 show this help

Cross-references:
  - infra/backup/pgbackrest.conf      stanza and repo configuration
  - infra/backup/verify-backup.sh     daily lightweight verifier
  - infra/backup/README.md            operator-facing overview
  - docs/DR_RUNBOOK.md                disaster recovery playbook
EOF
}

log() {
  # All progress logging goes to stderr; structured success goes to stdout.
  printf '[restore-drill %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2
}

emit_result() {
  local code="$1"
  local status="$2"
  local detail="$3"
  if [[ "${JSON}" -eq 1 ]]; then
    # No external jq dep — small fixed shape.
    printf '{"ok":%s,"exit":%d,"status":"%s","detail":"%s","stanza":"%s","ts":"%s"}\n' \
      "$([[ ${code} -eq 0 ]] && echo true || echo false)" \
      "${code}" "${status}" "${detail//\"/\\\"}" "${STANZA}" "${LOG_TS}"
  else
    printf 'restore-drill: status=%s exit=%d detail=%s\n' \
      "${status}" "${code}" "${detail}"
  fi
}

cleanup() {
  local rc=$?
  if [[ "${KEEP}" -eq 0 && -n "${TEMP_PG_NAME}" ]]; then
    if docker ps -a --format '{{.Names}}' | grep -q "^${TEMP_PG_NAME}$"; then
      log "tearing down temp Postgres ${TEMP_PG_NAME}"
      docker rm -f "${TEMP_PG_NAME}" >/dev/null 2>&1 || {
        log "WARN: failed to remove ${TEMP_PG_NAME}"
        rc=${rc:-14}
      }
    fi
  fi
  if [[ -n "${RESTORE_DIR}" && -d "${RESTORE_DIR}" && "${KEEP}" -eq 0 ]]; then
    rm -rf -- "${RESTORE_DIR}" 2>/dev/null || true
  fi
  exit "${rc}"
}
trap cleanup EXIT INT TERM

# ── Argument parsing ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=1; shift ;;
    --keep) KEEP=1; shift ;;
    --json) JSON=1; shift ;;
    --target-time) TARGET_TIME="${2:-}"; shift 2 ;;
    --source-counts) SOURCE_COUNTS="${2:-}"; shift 2 ;;
    --max-backup-age-hours) MAX_BACKUP_AGE_HOURS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; emit_result 2 "ARGS" "unknown argument: $1"; exit 2 ;;
  esac
done

# Default target time: now - 1 minute (RFC3339).
if [[ -z "${TARGET_TIME}" ]]; then
  if date -u -v-1M +%FT%TZ >/dev/null 2>&1; then
    TARGET_TIME="$(date -u -v-1M +%FT%TZ)"   # BSD date (mac)
  else
    TARGET_TIME="$(date -u -d '1 minute ago' +%FT%TZ)"  # GNU date (linux)
  fi
fi

# ── Prerequisite check ──────────────────────────────────────────────────────
need_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "missing prerequisite: $1"
    emit_result 3 "PREREQ" "missing $1 in PATH"
    exit 3
  fi
}
need_bin pgbackrest
need_bin docker
need_bin psql

# ── Step 1: validate stanza ────────────────────────────────────────────────
log "step 1/7 — validating stanza ${STANZA}"
if ! pgbackrest --stanza="${STANZA}" info >/dev/null; then
  emit_result 11 "STANZA_INVALID" "pgbackrest --stanza=${STANZA} info failed"
  exit 11
fi

# ── Step 2: backup recency ─────────────────────────────────────────────────
log "step 2/7 — checking newest backup is < ${MAX_BACKUP_AGE_HOURS}h old"
# Output format: one line per backup; we only need newest timestamp.
LATEST_STOP="$(pgbackrest --stanza="${STANZA}" --output=json info \
  | grep -E '"stop"' \
  | tail -n 1 \
  | sed -E 's/.*"stop"[^0-9]+([0-9]+).*/\1/')"

if [[ -z "${LATEST_STOP}" || "${LATEST_STOP}" =~ [^0-9] ]]; then
  emit_result 10 "BACKUP_MISSING" "could not parse stop epoch from pgbackrest info"
  exit 10
fi

NOW_EPOCH="$(date -u +%s)"
AGE_SECONDS=$(( NOW_EPOCH - LATEST_STOP ))
MAX_SECONDS=$(( MAX_BACKUP_AGE_HOURS * 3600 ))

if (( AGE_SECONDS > MAX_SECONDS )); then
  emit_result 10 "BACKUP_TOO_OLD" \
    "newest backup is ${AGE_SECONDS}s old, threshold ${MAX_SECONDS}s"
  exit 10
fi

if [[ "${EXECUTE}" -eq 0 ]]; then
  log "DRY RUN — pre-flight passed; pass --execute to perform restore"
  emit_result 0 "DRY_RUN_OK" \
    "stanza=${STANZA} backup_age_s=${AGE_SECONDS} target_time=${TARGET_TIME}"
  exit 0
fi

# ── Step 3: spin up temp Postgres ──────────────────────────────────────────
log "step 3/7 — spinning up temp Postgres (${TEMP_PG_IMAGE}) on :${TEMP_PG_PORT}"
RESTORE_DIR="$(mktemp -d -t aegis-restore-XXXXXX)"
chmod 700 "${RESTORE_DIR}"

# Generate an ephemeral password from the kernel CSPRNG (NOT $RANDOM).
TEMP_PG_PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)"

if ! docker run -d \
  --name "${TEMP_PG_NAME}" \
  -e POSTGRES_PASSWORD="${TEMP_PG_PASSWORD}" \
  -e POSTGRES_DB=aegis \
  -e POSTGRES_USER=aegis \
  -p "127.0.0.1:${TEMP_PG_PORT}:5432" \
  -v "${RESTORE_DIR}:/var/lib/postgresql/data" \
  "${TEMP_PG_IMAGE}" >/dev/null; then
  emit_result 11 "DOCKER_FAIL" "could not start temp Postgres container"
  exit 11
fi

# Wait for readiness (max 60s).
ready=0
for _ in $(seq 1 60); do
  if docker exec "${TEMP_PG_NAME}" pg_isready -U aegis >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  emit_result 11 "PG_NOT_READY" "temp Postgres did not become ready in 60s"
  exit 11
fi

# ── Step 4: restore + WAL replay to target time ────────────────────────────
log "step 4/7 — restoring stanza ${STANZA} to ${TARGET_TIME}"
# Stop Postgres inside the container, restore over its data dir, restart.
docker exec "${TEMP_PG_NAME}" su - postgres -c 'pg_ctl -D /var/lib/postgresql/data -m fast stop' \
  >/dev/null 2>&1 || true

if ! pgbackrest --stanza="${STANZA}" \
  --pg1-path="${RESTORE_DIR}" \
  --type=time \
  --target="${TARGET_TIME}" \
  --target-action=promote \
  --delta \
  restore; then
  emit_result 11 "RESTORE_FAIL" "pgbackrest restore exited non-zero"
  exit 11
fi

docker restart "${TEMP_PG_NAME}" >/dev/null
ready=0
for _ in $(seq 1 60); do
  if docker exec "${TEMP_PG_NAME}" pg_isready -U aegis >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  emit_result 11 "PG_NOT_READY_POST_RESTORE" \
    "temp Postgres did not return to ready after restore"
  exit 11
fi

# ── Step 5: row count verification ─────────────────────────────────────────
log "step 5/7 — running post-restore row counts on Principal/AgentIdentity/AuditEvent"
declare -A counts
for table in Principal AgentIdentity AuditEvent; do
  out="$(PGPASSWORD="${TEMP_PG_PASSWORD}" \
    psql -h 127.0.0.1 -p "${TEMP_PG_PORT}" -U aegis -d aegis -At \
    -c "SELECT count(*) FROM \"${table}\";" 2>/dev/null || true)"
  if ! [[ "${out}" =~ ^[0-9]+$ ]]; then
    emit_result 11 "COUNT_FAIL" "could not count ${table}"
    exit 11
  fi
  counts["${table}"]="${out}"
  log "  ${table} = ${out}"
done

LATEST_AUDIT_TS="$(PGPASSWORD="${TEMP_PG_PASSWORD}" \
  psql -h 127.0.0.1 -p "${TEMP_PG_PORT}" -U aegis -d aegis -At \
  -c 'SELECT max("timestamp") FROM "AuditEvent";' 2>/dev/null || true)"
log "  AuditEvent.timestamp(max) = ${LATEST_AUDIT_TS:-<none>}"

# Compare against pre-recorded source counts when given.
if [[ -n "${SOURCE_COUNTS}" ]]; then
  if [[ ! -r "${SOURCE_COUNTS}" ]]; then
    emit_result 12 "SOURCE_COUNTS_UNREADABLE" "${SOURCE_COUNTS}"
    exit 12
  fi
  while IFS='=' read -r key expected; do
    [[ -z "${key}" || "${key}" =~ ^# ]] && continue
    actual="${counts[${key}]:-}"
    if [[ -z "${actual}" ]]; then
      log "  source-counts: ${key} not in actual map — skipping"
      continue
    fi
    # Audit events are append-only; restored count must be >= expected.
    # Other tables: tolerate exact match only (drift means data loss).
    if [[ "${key}" == "AuditEvent" ]]; then
      if (( actual < expected )); then
        emit_result 12 "AUDIT_COUNT_DRIFT" \
          "AuditEvent restored=${actual} < source=${expected}"
        exit 12
      fi
    else
      if [[ "${actual}" != "${expected}" ]]; then
        emit_result 12 "COUNT_DRIFT" \
          "${key} restored=${actual} != source=${expected}"
        exit 12
      fi
    fi
  done < "${SOURCE_COUNTS}"
fi

# ── Step 6: audit chain verification ───────────────────────────────────────
log "step 6/7 — audit chain verification"
# Foundation built apps/api/src/common/crypto/audit-chain.util.ts but the
# chain-walker CLI (pnpm --filter @aegis/api audit:verify-chain) is not yet
# wired up (tracked in docs/SESSION_HANDOFF.md as M-006-ext). We probe for
# it; if absent, run the placeholder count + WARN, but do NOT fail the
# drill — the drill's primary purpose is restore + row counts. A missing
# chain verifier is its own ticket.
chain_status="DEFERRED"
chain_detail=""
if ( cd / && pnpm --filter @aegis/api audit:verify-chain --since "${TARGET_TIME}" ) \
    >/tmp/aegis-chain-check.log 2>&1; then
  chain_status="OK"
elif grep -q 'No script matched' /tmp/aegis-chain-check.log 2>/dev/null \
  || grep -q 'No projects matched' /tmp/aegis-chain-check.log 2>/dev/null \
  || ! command -v pnpm >/dev/null 2>&1; then
  log "  WARN: chain verification deferred to M-006-ext (no pnpm script wired)"
  COUNT_AUDIT="$(PGPASSWORD="${TEMP_PG_PASSWORD}" \
    psql -h 127.0.0.1 -p "${TEMP_PG_PORT}" -U aegis -d aegis -At \
    -c 'SELECT count(*) FROM "AuditEvent";' 2>/dev/null || echo 0)"
  log "  WARN: ran placeholder \"count(*) AuditEvent\" = ${COUNT_AUDIT}"
  chain_detail="placeholder_count=${COUNT_AUDIT}"
else
  emit_result 13 "CHAIN_FAIL" "audit:verify-chain exited non-zero"
  exit 13
fi

# ── Step 7: report ─────────────────────────────────────────────────────────
log "step 7/7 — drill complete"
DETAIL=$(printf 'principal=%s agents=%s audit=%s chain=%s%s' \
  "${counts[Principal]:-?}" \
  "${counts[AgentIdentity]:-?}" \
  "${counts[AuditEvent]:-?}" \
  "${chain_status}" \
  "${chain_detail:+ (${chain_detail})}")

emit_result 0 "PASS" "${DETAIL}"
