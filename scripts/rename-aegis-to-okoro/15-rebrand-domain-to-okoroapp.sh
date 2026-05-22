#!/usr/bin/env bash
# 15-rebrand-domain-to-okoroapp.sh — second-pass domain rebrand.
#
# Background: 10-rename-checkout.sh applied a case-preserving text
# substitution that converted `okorolabs.io` (the historical apex) to
# `okorolabs.io` (the mechanical default). The operator's chosen apex
# is `okoroapp.com` (see OPERATOR_DECISIONS.md OD-024, DECIDED
# 2026-05-21). This script executes that decision as a separate pass
# so the substitution is mechanical, auditable, and idempotent.
#
# Locked exclusion list (durable peers decision 1c0003a0,
# operator-confirmed 2026-05-22): decision-history files must keep the
# old `okorolabs.io` token so the audit trail reads "operator chose to
# MOVE FROM okorolabs.io TO okoroapp.com" — not "okoroapp.com was
# always the apex". Excluded paths:
#
#   - docs/decisions/0021-*           (ADR-0021 + addendums)
#   - WORK_BOARD.md                   (M-061..M-064 module descriptions)
#   - OPERATOR_DECISIONS.md           (OD-024 row + cross-ref)
#   - docs/SESSION_HANDOFF.md         (cloudflare-rename-sync-pass entry)
#   - RENAME_IN_PROGRESS.md           (active rename notice)
#   - scripts/rename-okoro-to-okoro/  (this kit; including this script)
#
# Idempotent: running twice is a no-op. Safe to call directly or via
# run.sh between 10-rename-checkout and 40-emit-prisma-migration.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "[rebrand-domain] branch=$CURRENT_BRANCH"

OLD='okorolabs\.io'
NEW='okoroapp.com'

# Pre-count: how many matches exist before we run.
BEFORE=$(git grep -c -E "$OLD" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
BEFORE_FILES=$(git grep -l -E "$OLD" 2>/dev/null | wc -l | tr -d ' ')
echo "[rebrand-domain] before: $BEFORE matches across $BEFORE_FILES files"

if [ "$BEFORE" -eq 0 ]; then
  echo "[rebrand-domain] nothing to do (already at okoroapp.com)"
  exit 0
fi

#
# 1. SUBSTITUTION
#
# Exclusions:
#   - decision-history files (locked by OD-024 + peers decision 1c0003a0)
#   - kit scripts (this file lives here; substitution would self-rewrite)
#   - immutable migrations, lockfile, build artifacts, binaries
#
echo "[rebrand-domain] [1/2] substituting $OLD → $NEW"

git ls-files \
  | grep -Ev '^(docs/decisions/0021-|WORK_BOARD\.md$|OPERATOR_DECISIONS\.md$|docs/SESSION_HANDOFF\.md$|RENAME_IN_PROGRESS\.md$|scripts/rename-okoro-to-okoro/)' \
  | grep -Ev '^(apps/api/prisma/migrations/|pnpm-lock\.yaml$|\.yarn/|node_modules/|dist/|build/|\.next/|\.turbo/|coverage/)' \
  | grep -Ev '\.(png|jpg|jpeg|gif|ico|webp|pdf|docx|xlsx|pptx|woff2?|ttf|otf|eot|zip|tar|gz|bz2|7z|mp3|mp4|mov|webm|class|jar|so|dylib|dll|exe|wasm)$' \
  | while IFS= read -r f; do
      [ -f "$f" ] || continue
      if file --mime "$f" 2>/dev/null | grep -q 'charset=binary'; then continue; fi
      # Skip files that don't contain the old token (avoids touching mtime
      # on every tracked file). grep returns nonzero if no match.
      if ! grep -q "$OLD" "$f" 2>/dev/null; then continue; fi
      perl -i -pe 's/okorolabs\.io/okoroapp.com/g' "$f"
    done

#
# 2. SUMMARY
#
AFTER=$(git grep -c -E "$OLD" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
AFTER_FILES=$(git grep -l -E "$OLD" 2>/dev/null | wc -l | tr -d ' ')
SUBSTITUTED=$((BEFORE - AFTER))

echo "[rebrand-domain] [2/2] summary for $CURRENT_BRANCH"
echo "[rebrand-domain] substituted: $SUBSTITUTED matches"
echo "[rebrand-domain] after: $AFTER matches across $AFTER_FILES files"

if [ "$AFTER" -gt 0 ]; then
  echo "[rebrand-domain] (expected: matches inside the locked exclusion list)"
  echo "[rebrand-domain] remaining files:"
  git grep -l -E "$OLD" 2>/dev/null | sed 's/^/  /'
fi
