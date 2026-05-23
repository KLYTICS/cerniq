#!/usr/bin/env bash
# doctor.sh — diagnose the CERNIQ development environment.
#
# Distinct from `make preflight` (branch shippability) and `make health`
# (running-stack health). `doctor` answers "is THIS machine ready to run
# CERNIQ locally?" — the question a new contributor asks on first clone.
#
# Invoked by: `make doctor` (top-level Makefile).
# Standalone usage:  ./scripts/doctor.sh
#
# Exit codes:
#   0  green — environment ready to run `make dev`
#   1  yellow — works but missing optional / nice-to-have pieces
#   2  red — bring-up will fail; fix the listed items first

set -uo pipefail

# ---------------------------------------------------------------------------
# Pretty output (TTY-aware)
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
  C_RESET='\033[0m'; C_DIM='\033[2m'; C_BOLD='\033[1m'
  C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_GRAY='\033[90m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''
  C_GREEN=''; C_YELLOW=''; C_RED=''; C_GRAY=''
fi

# Result accumulator: comma-separated triples "status,label,detail".
RESULTS=()
HARDFAIL=0
WARN=0

ok()    { RESULTS+=("ok|$1|$2"); }
warn()  { RESULTS+=("warn|$1|$2"); WARN=$((WARN+1)); }
fail()  { RESULTS+=("fail|$1|$2"); HARDFAIL=$((HARDFAIL+1)); }
skip()  { RESULTS+=("skip|$1|$2"); }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

# 1. node version meets .nvmrc
check_node() {
  if ! command -v node >/dev/null 2>&1; then
    fail "node" "not on PATH — install Node 20.11+"
    return
  fi
  local actual; actual="$(node --version | sed 's/^v//')"
  local nvmrc=""; [ -f "$REPO_ROOT/.nvmrc" ] && nvmrc="$(tr -d ' \n' < "$REPO_ROOT/.nvmrc" | sed 's/^v//')"
  if [ -z "$nvmrc" ]; then
    ok "node" "$actual (no .nvmrc to compare)"
    return
  fi
  # Major version match is what matters; minor/patch drift is fine.
  local actual_maj="${actual%%.*}"
  local nvmrc_maj="${nvmrc%%.*}"
  if [ "$actual_maj" = "$nvmrc_maj" ]; then
    ok "node" "$actual (matches .nvmrc $nvmrc)"
  else
    warn "node" "$actual but .nvmrc says $nvmrc — mismatch may cause native-build issues"
  fi
}

# 2. pnpm version >= 9
check_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    fail "pnpm" "not on PATH — install via 'npm i -g pnpm@9' or https://pnpm.io"
    return
  fi
  local v; v="$(pnpm --version 2>/dev/null)"
  local maj="${v%%.*}"
  if [ "$maj" -ge 9 ] 2>/dev/null; then
    ok "pnpm" "$v"
  else
    warn "pnpm" "$v — package.json says >=9.0.0; upgrade with 'npm i -g pnpm@9'"
  fi
}

# 3. docker present + daemon running
check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    fail "docker" "not on PATH — install Docker Desktop"
    return
  fi
  if ! docker info >/dev/null 2>&1; then
    fail "docker" "installed but daemon is not running — start Docker Desktop"
    return
  fi
  # Compose v2 detection (from dev-up.sh).
  if docker compose version >/dev/null 2>&1; then
    ok "docker" "running with compose v2"
  elif command -v docker-compose >/dev/null 2>&1; then
    warn "docker" "running with legacy compose v1 — works but v2 is recommended"
  else
    warn "docker" "running but neither compose v2 nor v1 detected — 'make up' will fail"
  fi
}

# 4. dev ports available
check_ports() {
  local ports=(4000 3000 5432 6379)
  local taken=()
  for p in "${ports[@]}"; do
    if (echo > "/dev/tcp/127.0.0.1/$p") >/dev/null 2>&1; then
      taken+=("$p")
    fi
  done
  if [ ${#taken[@]} -eq 0 ]; then
    ok "ports" "4000/3000/5432/6379 all free"
  else
    # If postgres/redis are taken, they may already be `make up`'d — that's fine.
    local relevant=()
    for p in "${taken[@]}"; do
      case "$p" in
        4000|3000) relevant+=("$p") ;;
      esac
    done
    if [ ${#relevant[@]} -gt 0 ]; then
      warn "ports" "${relevant[*]} in use — 'make dev' will conflict"
    else
      ok "ports" "API/dashboard ports free; ${taken[*]} likely 'make up' state"
    fi
  fi
}

# 5. .env present (or just .env.example for first run)
check_env_file() {
  if [ -f "$REPO_ROOT/.env" ]; then
    ok ".env" "present"
  elif [ -f "$REPO_ROOT/.env.example" ]; then
    warn ".env" "missing — copy from .env.example: 'cp .env.example .env'"
  else
    fail ".env" ".env.example also missing — repo state is broken"
  fi
}

# 6. node_modules installed
check_node_modules() {
  if [ -d "$REPO_ROOT/node_modules" ]; then
    ok "deps" "node_modules present"
  else
    fail "deps" "node_modules missing — run 'pnpm install'"
  fi
}

# 7. Ed25519 key generator works
check_key_gen() {
  if [ ! -f "$REPO_ROOT/scripts/generate-cerniq-keys.ts" ]; then
    skip "keys" "generate-cerniq-keys.ts not found"
    return
  fi
  # Don't actually generate; just verify tsx + the script file exist.
  if [ -d "$REPO_ROOT/node_modules" ] && \
     [ -d "$REPO_ROOT/node_modules/.pnpm/node_modules" ]; then
    ok "keys" "generator script present (run 'pnpm tsx scripts/generate-cerniq-keys.ts' to populate)"
  else
    skip "keys" "deps not installed yet — re-run after 'pnpm install'"
  fi
}

# 8. peers binary
check_peers() {
  if [ -x "$HOME/.claude/peers/bin/claude-peers" ]; then
    ok "peers" "claude-peers binary present"
  else
    warn "peers" "claude-peers not on \$HOME/.claude/peers/bin — coordination disabled (single-session OK)"
  fi
}

# 9. preflight tool reachable
check_preflight() {
  if [ -f "$REPO_ROOT/tools/preflight/preflight.ts" ]; then
    ok "preflight" "tool present at tools/preflight/"
  else
    fail "preflight" "tools/preflight/preflight.ts missing — repo state is broken"
  fi
}

# 10. Makefile targets present (sanity)
check_make_targets() {
  if [ ! -f "$REPO_ROOT/Makefile" ]; then
    fail "make" "top-level Makefile missing"
    return
  fi
  local missing=()
  for t in dev up migrate test typecheck preflight preflight-fast doctor; do
    if ! grep -qE "^${t}:" "$REPO_ROOT/Makefile"; then
      missing+=("$t")
    fi
  done
  if [ ${#missing[@]} -eq 0 ]; then
    ok "make" "dev/up/migrate/test/typecheck/preflight/doctor all defined"
  else
    warn "make" "missing targets: ${missing[*]}"
  fi
}

# ---------------------------------------------------------------------------
# Run all checks
# ---------------------------------------------------------------------------

printf "%bCERNIQ doctor%b — environment diagnostic · %s\n" "$C_BOLD" "$C_RESET" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf "%b%s%b\n" "$C_DIM" "──────────────────────────────────────────────────────────────────" "$C_RESET"

check_node
check_pnpm
check_docker
check_ports
check_env_file
check_node_modules
check_key_gen
check_peers
check_preflight
check_make_targets

# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

i=0
for r in "${RESULTS[@]}"; do
  i=$((i+1))
  status="${r%%|*}"; rest="${r#*|}"; label="${rest%%|*}"; detail="${rest#*|}"
  case "$status" in
    ok)   sym="${C_GREEN}✅${C_RESET}" ;;
    warn) sym="${C_YELLOW}⚠${C_RESET} " ;;
    fail) sym="${C_RED}❌${C_RESET}" ;;
    skip) sym="${C_GRAY}⏭${C_RESET} " ;;
  esac
  printf "%b[%2d/%d]%b %b %-12s %s\n" "$C_DIM" "$i" "${#RESULTS[@]}" "$C_RESET" "$sym" "$label" "$detail"
done

printf "%b%s%b\n" "$C_DIM" "──────────────────────────────────────────────────────────────────" "$C_RESET"

PASS=$(printf '%s\n' "${RESULTS[@]}" | grep -c '^ok|' || true)
SKIP=$(printf '%s\n' "${RESULTS[@]}" | grep -c '^skip|' || true)

if [ "$HARDFAIL" -gt 0 ]; then
  printf "%b%bRED — %d blocker(s) · %d warning(s)%b\n" "$C_RED" "$C_BOLD" "$HARDFAIL" "$WARN" "$C_RESET"
  printf "Fix the ❌ items above; they will block 'make dev'.\n"
  exit 2
elif [ "$WARN" -gt 0 ]; then
  printf "%b%bYELLOW — %d warning(s)%b\n" "$C_YELLOW" "$C_BOLD" "$WARN" "$C_RESET"
  printf "Environment usable; consider addressing warnings before pushing.\n"
  exit 1
else
  printf "%b%bGREEN — %d pass · %d skip%b\n" "$C_GREEN" "$C_BOLD" "$PASS" "$SKIP" "$C_RESET"
  printf "Run 'make dev' to bring up the stack.\n"
  exit 0
fi
