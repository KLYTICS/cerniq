#!/usr/bin/env bash
# launch-smoke.sh — post-deploy smoke test for any CERNIQ surface.
#
# Each surface block is independent and idempotent. Run after the
# corresponding LAUNCH.md section deploys the surface.
#
# Usage:
#   ./scripts/launch-smoke.sh api           # checks Railway-deployed API
#   ./scripts/launch-smoke.sh docs          # checks cerniq.io + docs.cerniq.io
#   ./scripts/launch-smoke.sh dashboard     # checks app.cerniq.io
#   ./scripts/launch-smoke.sh sdk-ts        # npm view + npx happy-path
#   ./scripts/launch-smoke.sh sdk-py        # pip install + import
#   ./scripts/launch-smoke.sh cli           # brew install + cerniq doctor
#   ./scripts/launch-smoke.sh all           # all of the above sequentially
#
# Required env (depending on surface):
#   CERNIQ_API_BASE         e.g. https://api.cerniq.io
#   CERNIQ_DOCS_BASE        e.g. https://docs.cerniq.io
#   CERNIQ_APP_BASE         e.g. https://app.cerniq.io
#   CERNIQ_PROD_API_KEY     read-only API key used for verify smoke
#
# Exit codes:
#   0  all checks pass
#   1  at least one check failed (details printed)
#   2  invalid invocation

set -uo pipefail

if [ -t 1 ]; then
  R='\033[31m'; G='\033[32m'; Y='\033[33m'; B='\033[1m'; X='\033[0m'
else
  R=''; G=''; Y=''; B=''; X=''
fi

FAILED=0
ok()    { printf "  ${G}✓${X} %s\n" "$1"; }
fail()  { printf "  ${R}✗${X} %s — %s\n" "$1" "$2"; FAILED=$((FAILED+1)); }
section() { printf "\n${B}▸ %s${X}\n" "$1"; }

usage() {
  cat <<EOF
Usage: $0 <surface>
Surfaces: api | docs | dashboard | sdk-ts | sdk-py | cli | all
EOF
  exit 2
}

# Curl with a sane timeout, follow redirects, capture both status and body.
fetch() {
  local url="$1"; shift
  curl -fsS --max-time 10 -o /tmp/cerniq-smoke-body.txt -w "%{http_code}" "$@" "$url" 2>/tmp/cerniq-smoke-err.txt
}

# -------- api ----------------------------------------------------------------
smoke_api() {
  section "API ($CERNIQ_API_BASE)"
  : "${CERNIQ_API_BASE:?set CERNIQ_API_BASE}"

  # 1. health (no auth, always 200)
  status=$(fetch "$CERNIQ_API_BASE/v1/health") || true
  if [ "$status" = "200" ]; then ok "GET /v1/health → 200"; else fail "GET /v1/health" "status=$status"; fi

  # 2. ready (no secret needed when stack is up)
  status=$(fetch "$CERNIQ_API_BASE/v1/health/ready") || true
  if [ "$status" = "200" ]; then ok "GET /v1/health/ready → 200"; else fail "GET /v1/health/ready" "status=$status (DB or Redis down)"; fi

  # 3. version
  status=$(fetch "$CERNIQ_API_BASE/v1/health/version") || true
  body="$(cat /tmp/cerniq-smoke-body.txt)"
  if [ "$status" = "200" ] && echo "$body" | grep -qE "version|gitSha"; then
    ok "GET /v1/health/version → 200 ($(echo "$body" | head -c 80))"
  else
    fail "GET /v1/health/version" "status=$status"
  fi

  # 4. /.well-known/audit-signing-key (P0 per OD-024 / SOC2)
  status=$(fetch "$CERNIQ_API_BASE/.well-known/audit-signing-key") || true
  body="$(cat /tmp/cerniq-smoke-body.txt)"
  if [ "$status" = "200" ] && echo "$body" | grep -qE "\"kty\"\s*:\s*\"OKP\""; then
    ok "GET /.well-known/audit-signing-key (Ed25519 JWK present)"
  else
    fail "GET /.well-known/audit-signing-key" "status=$status"
  fi

  # 5. /.well-known/pricing.json (public pricing mirror)
  status=$(fetch "$CERNIQ_API_BASE/.well-known/pricing.json") || true
  body="$(cat /tmp/cerniq-smoke-body.txt)"
  if [ "$status" = "200" ] && echo "$body" | grep -q "tier"; then
    ok "GET /.well-known/pricing.json"
  else
    fail "GET /.well-known/pricing.json" "status=$status"
  fi

  # 6. HSTS header on a normal response
  hsts=$(curl -sI --max-time 5 "$CERNIQ_API_BASE/v1/health" | tr -d '\r' | grep -i "^strict-transport-security:" || true)
  if [ -n "$hsts" ]; then ok "HSTS present"; else fail "HSTS header" "missing on /v1/health"; fi

  # 7. verify smoke (only if API key is present)
  if [ -n "${CERNIQ_PROD_API_KEY:-}" ]; then
    status=$(fetch "$CERNIQ_API_BASE/v1/verify" -X POST \
      -H "X-CERNIQ-API-Key: $CERNIQ_PROD_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"token":"smoke","amount":0}') || true
    # we don't care about the verdict, just that the endpoint is reachable + auth works
    if [ "$status" = "400" ] || [ "$status" = "200" ]; then
      ok "POST /v1/verify reachable (status=$status, smoke not a real token — 400 expected)"
    else
      fail "POST /v1/verify" "status=$status"
    fi
  fi
}

# -------- docs ---------------------------------------------------------------
smoke_docs() {
  section "Docs"
  for base in "https://cerniq.io" "${CERNIQ_DOCS_BASE:-https://docs.cerniq.io}"; do
    status=$(fetch "$base/") || true
    if [ "$status" = "200" ]; then ok "GET $base/ → 200"; else fail "GET $base/" "status=$status"; fi
  done

  # /robots.txt — public site hygiene
  status=$(fetch "https://cerniq.io/robots.txt") || true
  if [ "$status" = "200" ]; then ok "GET /robots.txt"; else fail "GET /robots.txt" "status=$status"; fi
}

# -------- dashboard ----------------------------------------------------------
smoke_dashboard() {
  section "Dashboard"
  : "${CERNIQ_APP_BASE:?set CERNIQ_APP_BASE (e.g. https://app.cerniq.io)}"

  status=$(fetch "$CERNIQ_APP_BASE/") || true
  if [ "$status" = "200" ] || [ "$status" = "307" ] || [ "$status" = "302" ]; then
    ok "GET / → $status (login redirect or landing)"
  else
    fail "GET /" "status=$status"
  fi

  status=$(fetch "$CERNIQ_APP_BASE/login") || true
  if [ "$status" = "200" ]; then ok "GET /login → 200"; else fail "GET /login" "status=$status"; fi

  # CSP header presence
  csp=$(curl -sI --max-time 5 "$CERNIQ_APP_BASE/" | tr -d '\r' | grep -i "^content-security-policy:" || true)
  if [ -n "$csp" ]; then ok "CSP header present"; else fail "CSP header" "missing"; fi
}

# -------- sdk-ts -------------------------------------------------------------
smoke_sdkts() {
  section "SDK-TS (npm)"
  if ! command -v npm >/dev/null 2>&1; then fail "npm" "not on PATH"; return; fi

  # Published?
  if npm view "@cerniq/sdk" version >/dev/null 2>&1; then
    v=$(npm view "@cerniq/sdk" version)
    ok "@cerniq/sdk published, latest=$v"
  else
    fail "@cerniq/sdk" "not found on npm"
    return
  fi

  # Happy-path import via npx
  tmp=$(mktemp -d)
  pushd "$tmp" >/dev/null
  npm init -y >/dev/null
  if npm install --no-audit --no-fund "@cerniq/sdk" >/dev/null 2>&1; then
    node -e "const { Cerniq } = require('@cerniq/sdk'); if (typeof Cerniq !== 'function') process.exit(1)" \
      && ok "require('@cerniq/sdk').Cerniq is a constructor" \
      || fail "@cerniq/sdk Cerniq export" "missing or not a function"
  else
    fail "@cerniq/sdk install" "npm install failed"
  fi
  popd >/dev/null
  rm -rf "$tmp"
}

# -------- sdk-py -------------------------------------------------------------
smoke_sdkpy() {
  section "SDK-Py (PyPI)"
  if ! command -v python3 >/dev/null 2>&1; then fail "python3" "not on PATH"; return; fi
  if ! command -v pip >/dev/null 2>&1 && ! python3 -m pip --version >/dev/null 2>&1; then
    fail "pip" "not available"; return
  fi

  tmp=$(mktemp -d)
  python3 -m venv "$tmp/venv"
  # shellcheck disable=SC1091
  source "$tmp/venv/bin/activate"
  if python3 -m pip install --quiet cerniq; then
    if python3 -c "from cerniq import Cerniq" 2>/dev/null; then
      ok "pip install cerniq + 'from cerniq import Cerniq'"
    else
      fail "cerniq import" "Cerniq class not exported"
    fi
  else
    fail "pip install cerniq" "package not on PyPI yet"
  fi
  deactivate || true
  rm -rf "$tmp"
}

# -------- cli ----------------------------------------------------------------
smoke_cli() {
  section "CLI"
  if command -v cerniq >/dev/null 2>&1; then
    v=$(cerniq --version 2>/dev/null || echo "unknown")
    ok "cerniq on PATH (version=$v)"
    if cerniq doctor 2>&1 | tail -5 | grep -qE "READY|green|ok"; then
      ok "cerniq doctor reports ready"
    else
      fail "cerniq doctor" "unexpected output (review LAUNCH.md §9.3)"
    fi
  else
    fail "cerniq" "not on PATH (brew install klytics/cerniq/cerniq, or download from GitHub Releases)"
  fi
}

# -------- driver -------------------------------------------------------------
[ "$#" -eq 1 ] || usage

case "$1" in
  api)        smoke_api ;;
  docs)       smoke_docs ;;
  dashboard)  smoke_dashboard ;;
  sdk-ts)     smoke_sdkts ;;
  sdk-py)     smoke_sdkpy ;;
  cli)        smoke_cli ;;
  all)        smoke_api; smoke_docs; smoke_dashboard; smoke_sdkts; smoke_sdkpy; smoke_cli ;;
  *)          usage ;;
esac

printf "\n"
if [ "$FAILED" -gt 0 ]; then
  printf "${R}✗ %d smoke failure(s)${X}\n" "$FAILED"
  exit 1
fi
printf "${G}✓ smoke green${X}\n"
exit 0
