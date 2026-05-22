#!/usr/bin/env bash
# AEGIS API post-deploy smoke gate.
#
# Encodes infra/railway/README.md § 5 — runs against $API (the just-deployed
# production base URL) and fails loudly on any deviation from the production
# contract. CI's deploy-api.yml runs this; an on-call human can also run it
# locally with `API=https://api.aegislabs.io bash scripts/deploy/smoke-api.sh`.
#
# Exit codes:
#   0  all gates passed
#   1  at least one gate failed (rolls back automatically in CI)
#   2  $API not set
#
# What this gates (in order):
#   1. /v1/health/live              — process liveness, < 300 ms
#   2. /v1/health/ready             — DB + Redis reachable
#   3. /.well-known/jwks.json       — JWT public key published
#   4. /.well-known/audit-signing-key — audit signing key published
#   5. /.well-known/pricing.json    — public pricing mirror (conversion loop)
#   6. /docs                         — MUST 404 in prod (Swagger off)
#   7. /v1/verify                    — must reject unauthenticated with 401
#                                      (verify-only key is the auth boundary)

set -euo pipefail

if [ -z "${API:-}" ]; then
  echo "::error::API env var not set (e.g. API=https://api.aegislabs.io)"
  exit 2
fi

failures=0
results=()

# Helpers ─────────────────────────────────────────────────────────────────
gate() {
  # $1 = label, $2 = expected http code, $3 = url, $4 = max latency ms
  local label="$1" expected="$2" url="$3" max_ms="${4:-2000}"
  local resp http time_total
  resp=$(curl -fsS -o /tmp/aegis-smoke-body -w "%{http_code} %{time_total}" \
    --max-time 10 "$url" 2>/dev/null || echo "000 0")
  http="${resp%% *}"; time_total="${resp##* }"
  local time_ms; time_ms=$(awk -v t="$time_total" 'BEGIN { printf "%d", t*1000 }')
  if [ "$http" = "$expected" ] && [ "$time_ms" -le "$max_ms" ]; then
    results+=("✅ $label  http=$http  ${time_ms}ms")
  else
    results+=("❌ $label  http=$http (expected $expected)  ${time_ms}ms (budget ${max_ms}ms)")
    failures=$((failures + 1))
  fi
}

gate_jq() {
  # $1 = label, $2 = url, $3 = jq predicate (must return true), $4 = max ms
  local label="$1" url="$2" predicate="$3" max_ms="${4:-2000}"
  local resp http time_total
  resp=$(curl -fsS -o /tmp/aegis-smoke-body -w "%{http_code} %{time_total}" \
    --max-time 10 "$url" 2>/dev/null || echo "000 0")
  http="${resp%% *}"; time_total="${resp##* }"
  local time_ms; time_ms=$(awk -v t="$time_total" 'BEGIN { printf "%d", t*1000 }')
  if [ "$http" != "200" ]; then
    results+=("❌ $label  http=$http (expected 200)  ${time_ms}ms")
    failures=$((failures + 1))
    return
  fi
  if jq -e "$predicate" /tmp/aegis-smoke-body >/dev/null 2>&1; then
    results+=("✅ $label  http=$http  ${time_ms}ms  jq($predicate)")
  else
    local body; body=$(head -c 200 /tmp/aegis-smoke-body)
    results+=("❌ $label  jq predicate failed: $predicate  body=$body")
    failures=$((failures + 1))
  fi
}

# Gates ───────────────────────────────────────────────────────────────────
gate     "liveness"            200 "$API/v1/health/live"                  300
gate     "readiness"           200 "$API/v1/health/ready"                 2000
gate_jq  "JWKS public"             "$API/.well-known/jwks.json"          '.keys | length >= 1'   1000
gate_jq  "audit-signing-key"       "$API/.well-known/audit-signing-key"  '.kty == "OKP"'         1000
gate_jq  "pricing.json"            "$API/.well-known/pricing.json"       '.tiers | length >= 2'  1000
gate     "swagger off in prod" 404 "$API/docs"                            1000
gate     "verify rejects unauth" 401 "$API/v1/verify"                     1000

# Report ──────────────────────────────────────────────────────────────────
echo "=== AEGIS deploy smoke gate ==="
echo "API: $API"
printf '%s\n' "${results[@]}"

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "::error::$failures gate(s) failed — automatic rollback will trigger."
  exit 1
fi

echo ""
echo "✅ All smoke gates passed."
exit 0
