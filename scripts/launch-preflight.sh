#!/usr/bin/env bash
# launch-preflight.sh — gate before executing LAUNCH.md §4 (API deploy).
#
# Wraps tools/preflight/preflight.ts and adds launch-specific guards:
#   - on `main`, not a feature branch
#   - working tree clean (no uncommitted edits)
#   - origin in sync with local
#   - the operator decisions in OPERATOR_DECISIONS.md needed for launch are DECIDED
#   - the env vars listed in infra/deploy/launch-env-checklist.md §A are set in
#     CURRENT shell (sanity check before paste into Railway)
#
# Usage:
#   ./scripts/launch-preflight.sh                # full gate
#   ./scripts/launch-preflight.sh --offline      # skip pnpm audit + registry checks
#
# Exit codes:
#   0  green — proceed to LAUNCH.md §4
#   1  warnings — review before proceeding
#   2  red — DO NOT DEPLOY

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# TTY colors
if [ -t 1 ]; then
  R='\033[31m'; G='\033[32m'; Y='\033[33m'; D='\033[2m'; B='\033[1m'; X='\033[0m'
else
  R=''; G=''; Y=''; D=''; B=''; X=''
fi

OFFLINE=0
for arg in "$@"; do
  case "$arg" in
    --offline) OFFLINE=1 ;;
    *) echo "unknown flag: $arg"; exit 2 ;;
  esac
done

FAILED=0
WARNED=0
section() { printf "\n${B}▸ %s${X}\n" "$1"; }
ok()      { printf "  ${G}✓${X} %s\n" "$1"; }
warn()    { printf "  ${Y}!${X} %s\n" "$1"; WARNED=$((WARNED+1)); }
fail()    { printf "  ${R}✗${X} %s\n" "$1"; FAILED=$((FAILED+1)); }

# 1. Git state
section "Git state"
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [ "$branch" = "main" ]; then
  ok "on main"
else
  fail "on '$branch' — launch must run from main"
fi

if git diff --quiet && git diff --cached --quiet; then
  ok "working tree clean"
else
  fail "uncommitted changes present (run 'git status')"
fi

untracked="$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')"
if [ "$untracked" = "0" ]; then
  ok "no untracked files"
else
  warn "$untracked untracked file(s) — review with 'git status'"
fi

git fetch origin --quiet || warn "git fetch failed (offline?)"
local_sha="$(git rev-parse HEAD)"
origin_sha="$(git rev-parse origin/main 2>/dev/null || echo "")"
if [ "$local_sha" = "$origin_sha" ]; then
  ok "in sync with origin/main"
elif [ -n "$origin_sha" ]; then
  fail "local main diverges from origin/main (local=$local_sha origin=$origin_sha)"
else
  warn "could not read origin/main"
fi

# 2. Operator decisions required for launch
section "Operator decisions (OPERATOR_DECISIONS.md)"
required_decisions=("OD-003" "OD-021" "OD-024")
for od in "${required_decisions[@]}"; do
  status_line="$(grep -E "^\| $od " OPERATOR_DECISIONS.md | head -1 || echo "")"
  if echo "$status_line" | grep -qE "DECIDED|ACCEPT"; then
    ok "$od decided"
  else
    fail "$od not DECIDED — launch blocked"
  fi
done

# 3. Run the existing preflight orchestrator (tools/preflight/preflight.ts)
section "tools/preflight/preflight.ts --prod"
flags="--prod"
if [ "$OFFLINE" = "1" ]; then
  flags="$flags --skip=audit,registry"
fi
if pnpm tsx tools/preflight/preflight.ts $flags; then
  ok "preflight gate green"
else
  ec=$?
  if [ "$ec" = "1" ]; then
    warn "preflight warnings present"
  else
    fail "preflight failed (exit=$ec)"
  fi
fi

# 4. Launch env-var sanity (current shell only — informational; real values go in Railway)
section "Required env vars (current shell — informational)"
required_envs=("CERNIQ_SIGNING_PRIVATE_KEY" "JWT_ED25519_PRIVATE_KEY_B64" "CERNIQ_WEBHOOK_SECRET_DEK_B64")
for v in "${required_envs[@]}"; do
  if [ -n "${!v:-}" ]; then
    ok "$v set (length=${#v})"
  else
    warn "$v unset in current shell — make sure it's in Railway"
  fi
done

# 5. Migration immutability + parity
section "Workspace parity gates"
if pnpm check:migrations >/dev/null 2>&1; then
  ok "check:migrations"
else
  fail "check:migrations failed"
fi
if pnpm check:openapi-zod >/dev/null 2>&1; then
  ok "check:openapi-zod"
else
  fail "check:openapi-zod failed"
fi
if pnpm check:openapi-prisma >/dev/null 2>&1; then
  ok "check:openapi-prisma"
else
  fail "check:openapi-prisma failed"
fi

# Summary
printf "\n${B}═══ Launch pre-flight summary ═══${X}\n"
if [ "$FAILED" -gt 0 ]; then
  printf "${R}✗ %d FAILED — DO NOT DEPLOY${X}\n" "$FAILED"
  [ "$WARNED" -gt 0 ] && printf "${Y}! %d warnings${X}\n" "$WARNED"
  exit 2
fi
if [ "$WARNED" -gt 0 ]; then
  printf "${Y}! %d warnings — review before deploying${X}\n" "$WARNED"
  exit 1
fi
printf "${G}✓ all clear — proceed to LAUNCH.md §4${X}\n"
exit 0
