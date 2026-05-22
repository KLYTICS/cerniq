#!/usr/bin/env bash
# =============================================================================
# OKORO — Audit-signing key rotation driver
# =============================================================================
# Drives steps 2 + 3 + 4 of the rotation ceremony documented in
# infra/kms/rotation-runbook.md. By design this script does NOT push secrets
# to Railway: it prints the exact `railway variables set` commands and waits
# for operator confirmation. A misfired secret-push is harder to undo than
# typing one extra line.
#
# Default mode: DRY RUN. Pass --execute to actually call the keypair
# generator. Even with --execute, the Railway commands are printed for
# the operator to run by hand.
#
# Exit codes:
#    0   ok
#    2   usage error
#    3   prerequisite missing (pnpm)
#    4   abort by operator (declined to confirm)
#    5   key generation failed
# =============================================================================
set -euo pipefail

EXECUTE=0
JSON=0
DATE_TAG="$(date -u +%Y%m%d)"
LOG_TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="./.local/keys/rotation-${DATE_TAG}"
LOG_FILE="./.local/keys/kms-rotation-${DATE_TAG}.log"
SERVICE="api"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

usage() {
  cat <<'EOF' >&2
rotate-okoro-keys.sh — drive an OKORO audit-signing key rotation.

Usage:
  rotate-okoro-keys.sh [--execute] [--json] [--service <name>] [--out <dir>]

Options:
  --execute            actually invoke the keypair generator. Without this
                       flag, the script prints the plan and exits.
  --json               emit one structured JSON line per step on stdout.
  --service <name>     Railway service name (default: api).
  --out <dir>          output directory for keys (default: ./.local/keys/rotation-<date>).
  -h, --help           show this help.

Cross-references:
  - infra/kms/rotation-runbook.md       full ceremony
  - scripts/generate-okoro-keys.ts      keypair generator (reused, never re-implemented here)
  - infra/kms/README.md                 operator overview
EOF
}

log_step() {
  local step="$1"
  local detail="$2"
  if [[ "${JSON}" -eq 1 ]]; then
    printf '{"step":"%s","detail":"%s","ts":"%s"}\n' \
      "${step}" "${detail//\"/\\\"}" "$(date -u +%FT%TZ)"
  else
    printf '[rotate %s] %s — %s\n' "$(date -u +%H:%M:%SZ)" "${step}" "${detail}"
  fi
  # Always also append to the structured log.
  mkdir -p "$(dirname "${LOG_FILE}")"
  printf '{"step":"%s","detail":%s,"ts":"%s"}\n' \
    "${step}" \
    "$(printf '%s' "${detail}" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')" \
    "$(date -u +%FT%TZ)" \
    >> "${LOG_FILE}"
}

confirm() {
  local prompt="$1"
  local reply
  printf '%s [type "yes" to continue, anything else aborts]: ' "${prompt}" >&2
  read -r reply
  if [[ "${reply}" != "yes" ]]; then
    log_step "abort" "operator declined: ${prompt}"
    exit 4
  fi
}

# ── Argument parsing ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=1; shift ;;
    --json) JSON=1; shift ;;
    --service) SERVICE="${2:-}"; shift 2 ;;
    --out) OUT_DIR="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

# ── Prerequisites ───────────────────────────────────────────────────────────
if ! command -v pnpm >/dev/null 2>&1; then
  log_step "prereq" "pnpm not in PATH"
  exit 3
fi

# ── Step 0: announce intent ─────────────────────────────────────────────────
log_step "start" "mode=$([[ ${EXECUTE} -eq 1 ]] && echo execute || echo dry-run) out=${OUT_DIR} service=${SERVICE}"

# Repo root sanity check — script must live two dirs deep under repo root.
if [[ ! -f "${SCRIPT_DIR}/../../scripts/generate-okoro-keys.ts" ]]; then
  log_step "prereq" "cannot find scripts/generate-okoro-keys.ts from ${SCRIPT_DIR}"
  exit 3
fi
REPO_ROOT="$( cd "${SCRIPT_DIR}/../.." && pwd )"

# ── Step 1: generate or simulate generation ────────────────────────────────
if [[ "${EXECUTE}" -eq 1 ]]; then
  log_step "generate" "running pnpm --filter @okoro/scripts run keys -- --out ${OUT_DIR} --format both"
  confirm "About to mint a NEW Ed25519 keypair into ${OUT_DIR}. Proceed?"
  if ! ( cd "${REPO_ROOT}" && pnpm --filter @okoro/scripts run keys -- \
      --out "${OUT_DIR}" --format both ); then
    log_step "generate" "FAILED — keypair generator exited non-zero"
    exit 5
  fi
  log_step "generate" "ok — keys at ${OUT_DIR}"
else
  log_step "generate" "DRY RUN — would invoke: pnpm --filter @okoro/scripts run keys -- --out ${OUT_DIR} --format both"
fi

# ── Step 2: print the operator commands for staged dual-publish (step 3 of runbook) ──
log_step "stage" "printing Railway commands for dual-publish stage"
cat <<EOF >&2

# === Stage rotation (runbook step 3) — RUN THESE BY HAND ON RAILWAY ===
# (operator: confirm the new public key + kid match the JSON line stdout
#  emitted by the generator above before executing.)

railway variables set OKORO_SIGNING_PUBLIC_KEY_NEXT="<new-pub-b64url>" --service ${SERVICE}
railway variables set OKORO_SIGNING_KID_NEXT="<new-kid>"               --service ${SERVICE}

# Restart the API service:
#   railway redeploy --service ${SERVICE}
# Then verify:
#   curl -fsS https://<your-okoro>/.well-known/jwks.json | jq '.keys | length'
# Expected: 2 (current + next). If it returns 1, the wellknown service has
# not yet been extended for dual-publish — see rotation-runbook.md TODO #1.

EOF

# ── Step 3: print the operator commands for cutover (step 4 of runbook) ────
log_step "cutover" "printing Railway commands for cutover"
cat <<EOF >&2

# === Cutover (runbook step 4) — RUN THESE ONLY AFTER STAGE VERIFIED ===

railway variables set OKORO_SIGNING_PRIVATE_KEY="<new-priv-b64url>" --service ${SERVICE}
railway variables set OKORO_SIGNING_PUBLIC_KEY="<new-pub-b64url>"   --service ${SERVICE}
railway variables set OKORO_SIGNING_KID="<new-kid>"                 --service ${SERVICE}

railway variables set OKORO_SIGNING_KEY_PREVIOUS_PUBLIC_KEY="<old-pub-b64url>" --service ${SERVICE}
railway variables set OKORO_SIGNING_KEY_PREVIOUS_KID="<old-kid>"               --service ${SERVICE}

railway variables delete OKORO_SIGNING_PUBLIC_KEY_NEXT --service ${SERVICE}
railway variables delete OKORO_SIGNING_KID_NEXT       --service ${SERVICE}

railway variables set OKORO_SIGNING_KEY_ROTATED_AT="$(date -u +%FT%TZ)" --service ${SERVICE}

# Restart:
#   railway redeploy --service ${SERVICE}
# Sanity:
#   psql "\$DATABASE_URL" -c 'SELECT "signatureKid" FROM "AuditEvent" ORDER BY "timestamp" DESC LIMIT 5;'

EOF

# ── Final: structured success line ─────────────────────────────────────────
log_step "done" "log written to ${LOG_FILE}"

if [[ "${JSON}" -eq 1 ]]; then
  printf '{"ok":true,"mode":"%s","log":"%s","ts":"%s"}\n' \
    "$([[ ${EXECUTE} -eq 1 ]] && echo execute || echo dry-run)" \
    "${LOG_FILE}" "${LOG_TS}"
else
  printf 'rotate-okoro-keys: mode=%s log=%s\n' \
    "$([[ ${EXECUTE} -eq 1 ]] && echo execute || echo dry-run)" \
    "${LOG_FILE}"
fi
