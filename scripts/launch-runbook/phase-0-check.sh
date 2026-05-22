#!/usr/bin/env bash
# scripts/launch-runbook/phase-0-check.sh
#
# Executable spec for docs/LAUNCH_RUNBOOK.md § Phase 0. Each Phase 0 gap is
# a single grep or file-existence test; this script runs them and exits
# non-zero if any remain. Turns the runbook into a testable contract —
# Rule-10 termination criterion. See ./README.md for usage.

set -u
cd "$(dirname "$0")/../.." || { echo "could not cd to repo root"; exit 2; }

VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; CYAN=""; BOLD=""; RESET=""
fi

PASSES=0
FAILS=0
WARNS=0

check() {
  local name="$1" status="$2" detail="$3"
  case "$status" in
    PASS)
      printf "  ${GREEN}✓${RESET} %s\n" "$name"
      [ "$VERBOSE" = 1 ] && printf "     %s\n" "$detail"
      PASSES=$((PASSES+1))
      ;;
    FAIL)
      printf "  ${RED}✗${RESET} %s\n" "$name"
      printf "     %s\n" "$detail"
      FAILS=$((FAILS+1))
      ;;
    WARN)
      printf "  ${YELLOW}!${RESET} %s\n" "$name"
      [ "$VERBOSE" = 1 ] && printf "     %s\n" "$detail"
      WARNS=$((WARNS+1))
      ;;
  esac
}

printf "${BOLD}${CYAN}Phase 0 gap checks${RESET}  (docs/LAUNCH_RUNBOOK.md)\n\n"

# ---------------------------------------------------------------------------
# Gap 1 — No lazy principal creation in checkout webhook
#
# stripe.service.ts:551 already accepts either `session.metadata?.principalId`
# OR `session.client_reference_id` as a fallback (so Stripe Payment Links can
# inject the principal via the ?client_reference_id=xxx URL param when the
# marketing/dashboard side knows the visitor's ID). The remaining gap is
# cold-stranger flow: a visitor who has NEVER signed up has no principalId
# to put anywhere. The webhook would need to lazily create a Principal from
# session.customer_email when both lookups miss. Closes when prisma.principal.
# create (or principalService.findOrCreate) appears in the webhook handler.
# ---------------------------------------------------------------------------
STRIPE_FILE="apps/api/src/modules/billing/stripe.service.ts"
if [ ! -f "$STRIPE_FILE" ]; then
  check "Gap 1 — no lazy principal creation in checkout webhook" "WARN" \
    "$STRIPE_FILE not found — billing module restructured? Re-verify gap manually."
elif grep -qE "prisma\.principal\.create.*customer_email|principalService\.findOrCreate|principalRepo\.findOrCreate|principalService\.upsertFromCheckout" "$STRIPE_FILE"; then
  check "Gap 1 — lazy principal creation wired in webhook" "PASS" \
    "$STRIPE_FILE wires lazy principal creation (cold-stranger Flow A path works)."
else
  check "Gap 1 — no lazy principal creation in checkout webhook" "FAIL" \
    "$STRIPE_FILE accepts metadata.principalId / client_reference_id but does not lazily create from session.customer_email. Cold-stranger Payment Links still cannot complete checkout."
fi

# ---------------------------------------------------------------------------
# Gap 2 — No email service in apps/api/
#
# Closes when an EmailService (or equivalent provider client) is wired into
# apps/api/. The webhook handler must be able to deliver an API key to the
# customer's checkout email.
#
# Earlier version of this check matched bare-word "resend" anywhere in
# apps/api/src/ and hit a comment in idempotency.service.ts saying "clients
# legitimately resend" — false PASS. The fix: match actual provider imports
# (from 'X') OR class names ending in EmailService, not free-text uses.
# ---------------------------------------------------------------------------
EMAIL_PATTERN="from ['\"](resend|@sendgrid/mail|nodemailer|@aws-sdk/client-ses|@aws-sdk/client-sesv2|@react-email/[^'\"]+|postmark|mailgun\.js)['\"]|class [A-Za-z_]*EmailService\b|@Injectable[^@]*EmailService"
EMAIL_FILES=$(grep -rEl "$EMAIL_PATTERN" apps/api/src/ 2>/dev/null || true)
EMAIL_COUNT=$(printf "%s" "$EMAIL_FILES" | grep -c . || true)
if [ "$EMAIL_COUNT" -eq 0 ]; then
  check "Gap 2 — no email service in apps/api/" "FAIL" \
    "0 actual provider imports / EmailService class definitions in apps/api/src/. Pick a provider (Resend is the lowest-friction option) and wire it."
else
  check "Gap 2 — email service present in apps/api/" "PASS" \
    "$EMAIL_COUNT file(s) import an email provider or define an EmailService. Run --verbose for paths."
  [ "$VERBOSE" = 1 ] && printf "%s\n" "$EMAIL_FILES" | sed 's/^/       /'
fi

# ---------------------------------------------------------------------------
# Gap 3 — No API-key auto-issuance in billing webhook
#
# onCheckoutCompleted (apps/api/src/modules/billing/stripe.service.ts) only
# updates planTier on an existing principal. For self-serve checkout, it
# must also issue a fresh API key (BCrypt-hashed at rest) and surface the
# plaintext key exactly once via Gap 2's email service.
# ---------------------------------------------------------------------------
KEYISSUE_FILES=$(grep -rEl "issueApiKey|provisionApiKey|generateApiKey|apiKey\.create|prisma\.apiKey\.create" apps/api/src/modules/billing/ 2>/dev/null || true)
KEYISSUE_COUNT=$(printf "%s" "$KEYISSUE_FILES" | grep -c . || true)
if [ "$KEYISSUE_COUNT" -eq 0 ]; then
  check "Gap 3 — no API-key auto-issuance in billing webhook" "FAIL" \
    "0 matches for issueApiKey|provisionApiKey|generateApiKey|apiKey.create|prisma.apiKey.create in apps/api/src/modules/billing/."
else
  check "Gap 3 — API-key issuance wired in billing" "PASS" \
    "$KEYISSUE_COUNT file(s) in billing module touch API-key issuance."
  [ "$VERBOSE" = 1 ] && printf "%s\n" "$KEYISSUE_FILES" | sed 's/^/       /'
fi

# ---------------------------------------------------------------------------
# Gap 4 — IDP SDK not installed in dashboard
#
# Operator decision #5. Per CLAUDE.md the dashboard login receiver is dark
# until an IDP SDK is installed. Three adapters are already wired in
# apps/api/ (auth0, clerk, workos); the dashboard just needs to install ONE
# of them and configure its tenant.
# ---------------------------------------------------------------------------
PKG="apps/dashboard/package.json"
AUTH0_OK=0; CLERK_OK=0; WORKOS_OK=0
if [ -f "$PKG" ]; then
  grep -q '"@auth0/nextjs-auth0"' "$PKG" && AUTH0_OK=1 || true
  grep -q '"@clerk/nextjs"' "$PKG" && CLERK_OK=1 || true
  grep -q '"@workos-inc/' "$PKG" && WORKOS_OK=1 || true
fi
TOTAL_IDP=$((AUTH0_OK + CLERK_OK + WORKOS_OK))
if [ "$TOTAL_IDP" -eq 0 ]; then
  check "Gap 4 — IDP SDK not installed in dashboard" "FAIL" \
    "Neither @auth0/nextjs-auth0 nor @clerk/nextjs nor @workos-inc/* found in $PKG. Pick one and pnpm add it."
else
  check "Gap 4 — IDP SDK installed in dashboard" "PASS" \
    "Installed: auth0=$AUTH0_OK clerk=$CLERK_OK workos=$WORKOS_OK"
fi

# ---------------------------------------------------------------------------
# Gap 5 — No admin path to create a Principal in production
#
# scripts/seed-dev.ts is forbidden in prod (its own header says so). Only
# wired prod principal-creation paths are the IDP adapter webhooks. Gap 5
# closes when EITHER an AdminGuard + AEGIS_ADMIN_TOKEN admin endpoint
# exists, OR Gap 4 closes (IDP-driven signup is sufficient for v1).
# ---------------------------------------------------------------------------
ADMIN_TOKEN_HITS=$(grep -rEl "AEGIS_ADMIN_TOKEN" apps/api/src/config/ 2>/dev/null || true)
ADMIN_TOKEN_COUNT=$(printf "%s" "$ADMIN_TOKEN_HITS" | grep -c . || true)
ADMIN_GUARD_HITS=$(grep -rEl "class AdminGuard|AdminGuard" apps/api/src/ 2>/dev/null || true)
ADMIN_GUARD_COUNT=$(printf "%s" "$ADMIN_GUARD_HITS" | grep -c . || true)
if [ "$ADMIN_TOKEN_COUNT" -eq 0 ] && [ "$ADMIN_GUARD_COUNT" -eq 0 ] && [ "$TOTAL_IDP" -eq 0 ]; then
  check "Gap 5 — no admin path to create a Principal in production" "FAIL" \
    "0 AEGIS_ADMIN_TOKEN matches, 0 AdminGuard matches, 0 IDP SDKs installed. v1 onboarding is blocked. Closing Gap 4 satisfies Gap 5."
elif [ "$ADMIN_TOKEN_COUNT" -gt 0 ] || [ "$ADMIN_GUARD_COUNT" -gt 0 ]; then
  check "Gap 5 — admin path present" "PASS" \
    "AEGIS_ADMIN_TOKEN config: $ADMIN_TOKEN_COUNT file(s); AdminGuard: $ADMIN_GUARD_COUNT file(s)."
else
  check "Gap 5 — Principal-creation path via IDP (Gap 4 closure satisfies Gap 5)" "PASS" \
    "IDP SDK installed; IDP adapter handles Principal creation. Admin-API path not present, but not required."
fi

# ---------------------------------------------------------------------------
# Bonus — IDP adapters all wired to prisma.principal.create
# ---------------------------------------------------------------------------
ADAPTER_FILES="apps/api/src/modules/auth0/auth0.adapter.ts apps/api/src/modules/idp-clerk/clerk.adapter.ts apps/api/src/modules/idp-workos/workos.adapter.ts"
ADAPTERS_WIRED=0
ADAPTERS_FOUND=0
for f in $ADAPTER_FILES; do
  if [ -f "$f" ]; then
    ADAPTERS_FOUND=$((ADAPTERS_FOUND+1))
    if grep -q "prisma\.principal\.create" "$f"; then
      ADAPTERS_WIRED=$((ADAPTERS_WIRED+1))
    fi
  fi
done
if [ "$ADAPTERS_WIRED" -eq "$ADAPTERS_FOUND" ] && [ "$ADAPTERS_FOUND" -ge 1 ]; then
  check "Bonus — IDP adapters all call prisma.principal.create" "PASS" \
    "$ADAPTERS_WIRED of $ADAPTERS_FOUND adapter file(s) wire principal creation."
else
  check "Bonus — IDP adapter wiring" "WARN" \
    "$ADAPTERS_WIRED of $ADAPTERS_FOUND adapter files wire prisma.principal.create. Acceptable if a stale adapter was intentionally left unwired."
fi

# ---------------------------------------------------------------------------
# Bonus — dashboard has UpgradeButton for in-dashboard Flow B checkout
# ---------------------------------------------------------------------------
UPGRADE_BTN="apps/dashboard/app/billing/_components/UpgradeButton.tsx"
if [ -f "$UPGRADE_BTN" ]; then
  check "Bonus — dashboard has UpgradeButton for Flow B" "PASS" \
    "$UPGRADE_BTN exists."
else
  check "Bonus — dashboard has UpgradeButton for Flow B" "FAIL" \
    "$UPGRADE_BTN not found. In-dashboard checkout has no UI entry point."
fi

# ---------------------------------------------------------------------------
# Bonus — marketing CTAs route to mailto (Phase 0 honesty)
# ---------------------------------------------------------------------------
MKT_PAGE="apps/marketing/app/page.tsx"
if [ -f "$MKT_PAGE" ] && grep -q "planMailto" "$MKT_PAGE"; then
  check "Bonus — marketing CTAs route to mailto" "PASS" \
    "$MKT_PAGE uses planMailto helper for paid-plan CTAs."
else
  check "Bonus — marketing CTAs route to mailto" "FAIL" \
    "planMailto not found in $MKT_PAGE. Marketing copy may have regressed to Flow-A speculation."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf "\n"
TOTAL=$((PASSES + FAILS + WARNS))
if [ "$FAILS" -eq 0 ]; then
  printf "${BOLD}${GREEN}Phase 0: all gaps closed${RESET}  ($PASSES/$TOTAL pass, $WARNS warn, $FAILS fail)\n"
  printf "v1 launch path unblocked. Next: operator dry-run of docs/LAUNCH_RUNBOOK.md Day 4.\n"
  exit 0
else
  printf "${BOLD}${RED}Phase 0: $FAILS gap(s) remaining${RESET}  ($PASSES/$TOTAL pass, $WARNS warn, $FAILS fail)\n"
  printf "v1 launch path blocked. See FAIL lines above for the missing wire-up.\n"
  exit 1
fi
