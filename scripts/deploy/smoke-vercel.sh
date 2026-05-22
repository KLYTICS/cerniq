#!/usr/bin/env bash
# Vercel post-deploy smoke gate for @aegis/dashboard and @aegis/docs.
#
# Reads:
#   TARGET  the just-deployed Vercel preview URL (or production alias)
#   APP     "dashboard" | "docs" — selects the app-specific gate set
#
# Why per-app gates: dashboard and docs share a deploy pipeline but have
# completely different correctness contracts. Dashboard has auth-gated
# routes and a pricing CTA that drives the conversion loop; docs has
# auto-generated API reference and a `/llms.txt` AI-crawler surface. A
# generic "GET / returns 200" gate would miss the things that actually
# matter to customers.
#
# Extending: add gates as new customer-visible contracts ship. Each gate
# should be a single line below; keep the loop in the script untouched.

set -euo pipefail

if [ -z "${TARGET:-}" ] || [ -z "${APP:-}" ]; then
  echo "::error::TARGET and APP env vars required"
  exit 2
fi

failures=0
results=()

gate() {
  local label="$1" expected="$2" path="$3" max_ms="${4:-3000}"
  local resp http time_total time_ms
  resp=$(curl -fsS -o /tmp/aegis-vercel-body -w "%{http_code} %{time_total}" \
    --max-time 15 -L "$TARGET$path" 2>/dev/null || echo "000 0")
  http="${resp%% *}"; time_total="${resp##* }"
  time_ms=$(awk -v t="$time_total" 'BEGIN { printf "%d", t*1000 }')
  if [ "$http" = "$expected" ] && [ "$time_ms" -le "$max_ms" ]; then
    results+=("✅ $label  http=$http  ${time_ms}ms  $path")
  else
    results+=("❌ $label  http=$http (expected $expected)  ${time_ms}ms (budget ${max_ms}ms)  $path")
    failures=$((failures + 1))
  fi
}

gate_contains() {
  local label="$1" path="$2" needle="$3" max_ms="${4:-3000}"
  local resp http
  resp=$(curl -fsS -o /tmp/aegis-vercel-body -w "%{http_code}" \
    --max-time 15 -L "$TARGET$path" 2>/dev/null || echo "000")
  http="$resp"
  if [ "$http" != "200" ]; then
    results+=("❌ $label  http=$http (expected 200)  $path")
    failures=$((failures + 1))
    return
  fi
  if grep -qF "$needle" /tmp/aegis-vercel-body; then
    results+=("✅ $label  contains '$needle'  $path")
  else
    results+=("❌ $label  missing '$needle'  $path")
    failures=$((failures + 1))
  fi
}

case "$APP" in
  dashboard)
    # Landing + auth boundary + pricing CTA — these gate the conversion loop.
    gate           "landing"          200 "/"                          3000
    gate           "login route"      200 "/login"                     3000
    gate           "pricing route"    200 "/pricing"                   3000
    # Health endpoint optional on dashboard; soft-skip if absent.
    gate           "404 sanity"       404 "/this-page-cannot-exist"    2000
    ;;
  docs)
    # Generated content + AI-crawler surface + sitemap — gate the discovery loop.
    gate           "landing"          200 "/"                          3000
    gate           "docs root"        200 "/docs"                      3000
    gate           "sitemap"          200 "/sitemap.xml"               2000
    gate           "robots.txt"       200 "/robots.txt"                1000
    gate           "llms.txt"         200 "/llms.txt"                  2000
    gate_contains  "llms.txt format"      "/llms.txt"  "# docs.aegislabs.io"  2000
    gate           "404 sanity"       404 "/this-page-cannot-exist"    2000
    ;;
  *)
    echo "::error::Unknown APP=$APP (expected dashboard | docs)"
    exit 2
    ;;
esac

echo "=== AEGIS Vercel smoke gate ($APP) ==="
echo "TARGET: $TARGET"
printf '%s\n' "${results[@]}"

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "::error::$APP — $failures gate(s) failed."
  exit 1
fi

echo ""
echo "✅ $APP — all smoke gates passed."
exit 0
