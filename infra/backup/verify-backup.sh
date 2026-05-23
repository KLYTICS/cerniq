#!/usr/bin/env bash
# =============================================================================
# CERNIQ — Daily lightweight backup verifier
# =============================================================================
# Runs `pgbackrest verify --stanza=cerniq` and exits non-zero on any failure.
# Designed for cron at 02:00 UTC daily (operator wires the cron entry — see
# infra/backup/README.md § "Cron schedule").
#
# This script is intentionally cheap: it does NOT restore data. The
# heavyweight check is restore-drill.sh, which runs weekly.
#
# Exit codes:
#    0   verify passed
#    2   usage error
#    3   pgbackrest binary missing
#   20   verify reported errors
# =============================================================================
set -euo pipefail

STANZA="cerniq"
JSON=0
LOG_TS="$(date -u +%Y%m%dT%H%M%SZ)"

usage() {
  cat <<'EOF' >&2
verify-backup.sh — daily lightweight verifier (pgbackrest verify).

Usage:
  verify-backup.sh [--json]

Options:
  --json   emit one structured JSON line on stdout
  -h       show this help

Cross-references:
  - infra/backup/pgbackrest.conf      stanza configuration
  - infra/backup/restore-drill.sh     weekly heavyweight verifier
  - infra/backup/README.md            operator-facing overview
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

emit() {
  local code="$1"
  local status="$2"
  local detail="$3"
  if [[ "${JSON}" -eq 1 ]]; then
    printf '{"ok":%s,"exit":%d,"status":"%s","detail":"%s","stanza":"%s","ts":"%s"}\n' \
      "$([[ ${code} -eq 0 ]] && echo true || echo false)" \
      "${code}" "${status}" "${detail//\"/\\\"}" "${STANZA}" "${LOG_TS}"
  else
    printf 'verify-backup: status=%s exit=%d detail=%s\n' \
      "${status}" "${code}" "${detail}"
  fi
}

if ! command -v pgbackrest >/dev/null 2>&1; then
  echo "pgbackrest not in PATH" >&2
  emit 3 "PREREQ" "pgbackrest binary missing"
  exit 3
fi

# operator: wire alert sink — pipe non-zero exit to PagerDuty / Slack /
# email so a silent verify failure is impossible. The simplest wiring is
# a cron line like:
#   0 2 * * * /opt/cerniq/infra/backup/verify-backup.sh --json \
#     | tee -a /var/log/cerniq/verify-backup.log \
#     || curl -fsS -X POST -d "$(tail -n1 /var/log/cerniq/verify-backup.log)" \
#            "$ALERT_WEBHOOK_URL"
# but the production wiring is the operator's call.

if pgbackrest --stanza="${STANZA}" verify >/dev/null 2>&1; then
  emit 0 "PASS" "stanza=${STANZA} verify ok"
  exit 0
fi

emit 20 "FAIL" "pgbackrest verify --stanza=${STANZA} reported errors"
exit 20
