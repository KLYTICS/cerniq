#!/usr/bin/env bash
# scripts/launch-runbook/check-discovery-mirror.sh
#
# Verifies apps/marketing/app/security/page.tsx ENDPOINTS array is a 1:1
# mirror of apps/api/src/modules/wellknown/wellknown.controller.ts @Get
# decorators. Catches the two failure modes that bit /security on
# 2026-05-16 (commit 6927dea):
#
#   - OVER-CLAIM: marketing advertises a /.well-known/* path that
#     no controller routes (auditor copy-pastes the URL → 404).
#   - UNDER-CLAIM: controller routes a /.well-known/* path that
#     marketing omits (under-sell of the discovery surface).
#
# Pure bash + grep + awk + comm. Runs in <1s on a fresh clone.
# Exit 0 = perfectly mirrored. Exit 1 = drift. Exit 2 = misconfig.
#
# Usage:
#   bash scripts/launch-runbook/check-discovery-mirror.sh [--verbose]

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
PAGE="apps/marketing/app/security/page.tsx"

if [ ! -f "$CONTROLLER" ]; then
  printf "${RED}✗${RESET} controller missing: %s\n" "$CONTROLLER" >&2
  exit 2
fi
if [ ! -f "$PAGE" ]; then
  printf "${RED}✗${RESET} marketing page missing: %s\n" "$PAGE" >&2
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

# Paths from marketing ENDPOINTS array — extract any /.well-known/* literal
# (regardless of where it appears: inside the ENDPOINTS array literal, in
# code comments mentioning a path, or in hero/section prose). We accept
# all of these as "page claims this endpoint exists" because they're all
# customer-readable.
#
# Regex anchors the trailing char to alphanumeric/underscore/hyphen so a
# path appearing at sentence-end ("see /.well-known/security.txt.") does
# NOT include the trailing period — that was the script's own first-run
# false positive that this comment commemorates.
paths_from_marketing() {
  grep -oE "/\.well-known/[a-zA-Z0-9._-]*[a-zA-Z0-9_-]" "$PAGE" \
    | sort -u
}

CONTROLLER_LIST=$(routes_from_controller)
PAGE_LIST=$(paths_from_marketing)

if [ -z "$CONTROLLER_LIST" ]; then
  printf "${RED}✗${RESET} no @Get decorators found in %s\n" "$CONTROLLER" >&2
  exit 2
fi
if [ -z "$PAGE_LIST" ]; then
  printf "${YELLOW}!${RESET} no /.well-known/* paths found in %s\n" "$PAGE" >&2
  printf "  (page may have been restructured; manual review recommended)\n" >&2
  exit 1
fi

# Over-claim: in page but not in controller.
OVER_CLAIM=$(comm -23 <(printf "%s\n" "$PAGE_LIST") <(printf "%s\n" "$CONTROLLER_LIST"))

# Under-claim: in controller but not in page.
UNDER_CLAIM=$(comm -13 <(printf "%s\n" "$PAGE_LIST") <(printf "%s\n" "$CONTROLLER_LIST"))

# Matched: in both.
MATCHED=$(comm -12 <(printf "%s\n" "$PAGE_LIST") <(printf "%s\n" "$CONTROLLER_LIST"))

OVER_COUNT=$(printf "%s" "$OVER_CLAIM"  | grep -c . || true)
UNDER_COUNT=$(printf "%s" "$UNDER_CLAIM" | grep -c . || true)
MATCH_COUNT=$(printf "%s" "$MATCHED"     | grep -c . || true)

printf "${BOLD}${CYAN}Discovery-endpoint mirror check${RESET}\n"
printf "  controller: %s\n" "$CONTROLLER"
printf "  page:       %s\n\n" "$PAGE"

if [ "$VERBOSE" = 1 ] || [ "$OVER_COUNT" -gt 0 ] || [ "$UNDER_COUNT" -gt 0 ]; then
  printf "${CYAN}Routes in controller:${RESET}\n"
  printf "%s\n" "$CONTROLLER_LIST" | sed 's/^/  /'
  printf "\n${CYAN}Paths in marketing page:${RESET}\n"
  printf "%s\n" "$PAGE_LIST" | sed 's/^/  /'
  printf "\n"
fi

if [ "$OVER_COUNT" -gt 0 ]; then
  printf "${RED}✗ Over-claim — page advertises endpoint(s) the controller does NOT route:${RESET}\n"
  printf "%s\n" "$OVER_CLAIM" | sed 's/^/  /'
  printf "  ${YELLOW}Effect:${RESET} auditor copies the URL → 404.\n"
  printf "  ${YELLOW}Fix:${RESET} remove from %s ENDPOINTS array, or add an @Get to %s.\n\n" "$PAGE" "$CONTROLLER"
fi

if [ "$UNDER_COUNT" -gt 0 ]; then
  printf "${YELLOW}! Under-claim — controller routes endpoint(s) the page does NOT advertise:${RESET}\n"
  printf "%s\n" "$UNDER_CLAIM" | sed 's/^/  /'
  printf "  ${YELLOW}Effect:${RESET} buyers under-estimate the discovery surface.\n"
  printf "  ${YELLOW}Fix:${RESET} add to %s ENDPOINTS array with a one-line description.\n\n" "$PAGE"
fi

if [ "$OVER_COUNT" -eq 0 ] && [ "$UNDER_COUNT" -eq 0 ]; then
  printf "${BOLD}${GREEN}✓ Mirror clean${RESET} — %d endpoint(s) match 1:1.\n" "$MATCH_COUNT"
  exit 0
fi

# Final summary on drift.
printf "${BOLD}${RED}✗ Mirror drift${RESET} — %d match / %d over-claim / %d under-claim\n" \
  "$MATCH_COUNT" "$OVER_COUNT" "$UNDER_COUNT"
# Over-claim is a customer-facing 404 → blocks. Under-claim is a quality
# nag that prevents sales-velocity. Both fail the gate.
exit 1
