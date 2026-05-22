#!/usr/bin/env bash
# scripts/launch-runbook/check-discovery-mirror.sh
#
# Verifies that EVERY marketing page's /.well-known/* claims are routed
# by apps/api/src/modules/wellknown/wellknown.controller.ts. Catches the
# two failure modes that bit /security on 2026-05-16 (commit 6927dea):
#
#   - OVER-CLAIM: a marketing page advertises a /.well-known/* path that
#     no controller routes (auditor copy-pastes the URL → 404).
#   - UNDER-CLAIM: the controller routes a /.well-known/* path that
#     apps/marketing/app/security/page.tsx omits (under-sell of the
#     canonical discovery surface).
#
# Scope evolution:
#   - 87edb47 (initial): single-page check against /security/page.tsx
#   - this commit: multi-page over-claim sweep across all
#     apps/marketing/app/**/page.tsx + canonical under-claim check on
#     /security/page.tsx only.
#
# Pure bash + grep + awk + comm. Runs in <1s on a fresh clone.
# Exit 0 = perfectly mirrored. Exit 1 = drift. Exit 2 = misconfig.

set -u
cd "$(dirname "$0")/../.." || { echo "could not cd to repo root"; exit 2; }

VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; CYAN=""; BOLD=""; RESET=""
fi

CONTROLLER="apps/api/src/modules/wellknown/wellknown.controller.ts"
CANONICAL_PAGE="apps/marketing/app/security/page.tsx"

if [ ! -f "$CONTROLLER" ]; then
  printf "${RED}✗${RESET} controller missing: %s\n" "$CONTROLLER" >&2
  exit 2
fi
if [ ! -f "$CANONICAL_PAGE" ]; then
  printf "${RED}✗${RESET} canonical marketing page missing: %s\n" "$CANONICAL_PAGE" >&2
  exit 2
fi

# Routes from controller — extract @Get('foo') → /.well-known/foo (the
# wellknown controller uses @Controller('.well-known') so paths inside
# @Get are leaves, not absolutes).
routes_from_controller() {
  grep -oE "@Get\(['\"][^'\"]+['\"]\)" "$CONTROLLER" \
    | sed -E "s|@Get\(['\"]([^'\"]+)['\"]\)|/.well-known/\1|" \
    | sort -u
}

# /.well-known/* literals from a single marketing page.
# Regex anchors the trailing char to alphanumeric/underscore/hyphen so a
# path appearing at sentence-end ("see /.well-known/security.txt.") does
# NOT include the trailing period — that was this script's own first-run
# false positive (see commit 87edb47).
paths_from_page() {
  local page="$1"
  grep -oE "/\.well-known/[a-zA-Z0-9._-]*[a-zA-Z0-9_-]" "$page" 2>/dev/null \
    | sort -u
}

CONTROLLER_LIST=$(routes_from_controller)
if [ -z "$CONTROLLER_LIST" ]; then
  printf "${RED}✗${RESET} no @Get decorators found in %s\n" "$CONTROLLER" >&2
  exit 2
fi

# Auto-discover marketing pages that reference any /.well-known/* path.
# Caller doesn't need to maintain a list; new pages get covered automatically.
# Portable bash 3.2+ (no `mapfile` — macOS default Bash predates Bash 4).
MARKETING_PAGES=()
while IFS= read -r line; do
  [ -n "$line" ] && MARKETING_PAGES+=("$line")
done < <(grep -rlE "/\.well-known/" apps/marketing/app/ 2>/dev/null \
  | grep -E "\.tsx?$" | sort -u)

PAGE_COUNT="${#MARKETING_PAGES[@]}"
if [ "$PAGE_COUNT" -eq 0 ]; then
  printf "${YELLOW}!${RESET} no marketing pages contain /.well-known/* — skipping over-claim sweep.\n"
fi

printf "${BOLD}${CYAN}Discovery-endpoint mirror check${RESET}\n"
printf "  controller: %s\n" "$CONTROLLER"
printf "  scanning:   %d marketing page(s) under apps/marketing/app/\n\n" "$PAGE_COUNT"

TOTAL_OVER=0
TOTAL_UNDER=0
TOTAL_MATCH=0
DIRTY_FILES=()

# Per-page over-claim sweep. Bash 3.2-safe iteration of (possibly empty) array.
for ((i = 0; i < PAGE_COUNT; i++)); do
  page="${MARKETING_PAGES[$i]}"
  PAGE_LIST=$(paths_from_page "$page")
  if [ -z "$PAGE_LIST" ]; then continue; fi

  OVER_CLAIM=$(comm -23 <(printf "%s\n" "$PAGE_LIST") <(printf "%s\n" "$CONTROLLER_LIST"))
  OVER_COUNT=$(printf "%s" "$OVER_CLAIM" | grep -c . || true)

  MATCHED=$(comm -12 <(printf "%s\n" "$PAGE_LIST") <(printf "%s\n" "$CONTROLLER_LIST"))
  MATCH_COUNT=$(printf "%s" "$MATCHED" | grep -c . || true)

  TOTAL_OVER=$((TOTAL_OVER + OVER_COUNT))
  TOTAL_MATCH=$((TOTAL_MATCH + MATCH_COUNT))

  rel_page="${page#./}"
  if [ "$OVER_COUNT" -gt 0 ]; then
    DIRTY_FILES+=("$rel_page")
    printf "  ${RED}✗${RESET} %s — %d over-claim(s):\n" "$rel_page" "$OVER_COUNT"
    printf "%s\n" "$OVER_CLAIM" | sed 's/^/      /'
  elif [ "$VERBOSE" = 1 ]; then
    printf "  ${GREEN}✓${RESET} %s — %d match(es), 0 over-claim\n" "$rel_page" "$MATCH_COUNT"
  fi
done

if [ "$TOTAL_OVER" -eq 0 ]; then
  [ "$VERBOSE" = 1 ] || printf "  ${GREEN}✓${RESET} %d page(s) clean — no over-claims.\n" "$PAGE_COUNT"
fi

# Under-claim check — canonical page only.
printf "\n${CYAN}Under-claim check (canonical: %s):${RESET}\n" "$CANONICAL_PAGE"
CANONICAL_PATHS=$(paths_from_page "$CANONICAL_PAGE")
UNDER_CLAIM=$(comm -13 <(printf "%s\n" "$CANONICAL_PATHS") <(printf "%s\n" "$CONTROLLER_LIST"))
UNDER_COUNT=$(printf "%s" "$UNDER_CLAIM" | grep -c . || true)
TOTAL_UNDER="$UNDER_COUNT"

if [ "$UNDER_COUNT" -gt 0 ]; then
  printf "  ${YELLOW}!${RESET} controller routes the following endpoint(s) but %s omits them:\n" "$CANONICAL_PAGE"
  printf "%s\n" "$UNDER_CLAIM" | sed 's/^/      /'
  printf "  ${YELLOW}Effect:${RESET} discovery surface under-sold.\n"
  printf "  ${YELLOW}Fix:${RESET} add to the ENDPOINTS array with a one-line description.\n"
else
  printf "  ${GREEN}✓${RESET} all %d controller route(s) advertised on /security.\n" \
    "$(printf "%s" "$CONTROLLER_LIST" | grep -c .)"
fi

# Summary.
printf "\n"
if [ "$TOTAL_OVER" -eq 0 ] && [ "$TOTAL_UNDER" -eq 0 ]; then
  printf "${BOLD}${GREEN}✓ Discovery mirror clean${RESET} across %d page(s).\n" "$PAGE_COUNT"
  exit 0
fi

printf "${BOLD}${RED}✗ Discovery mirror drift${RESET}  over-claim=%d (%d page%s)  under-claim=%d\n" \
  "$TOTAL_OVER" "${#DIRTY_FILES[@]}" "$([ "${#DIRTY_FILES[@]}" -ne 1 ] && echo 's')" "$TOTAL_UNDER"
exit 1
