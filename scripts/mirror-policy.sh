#!/usr/bin/env bash
# mirror-policy.sh — decides which refs propagate from the Radicle canonical
# out to GitHub / GitLab mirrors.
#
# Called by .github/workflows/mirror-from-radicle.yml per ref the mirror job
# discovers on the Radicle remote. Return 0 to mirror, non-zero to skip.
#
# This file IS the public-surface policy for CERNIQ/AEGIS source code. The
# Radicle canonical always holds everything; the mirrors are a curated view.
set -euo pipefail

should_mirror_ref() {
  local ref="$1"  # e.g. "refs/heads/main", "refs/heads/feat/foo", "refs/tags/v0.1.0"

  # Policy: main + tags only.
  # Rationale: clean public face during the AEGIS → CERNIQ rebrand. WIP,
  # agent worktrees, and housekeeping branches stay on the Radicle canonical
  # for contributors who clone via `rad clone`. Outside viewers see the
  # signed mainline and tagged releases — nothing half-formed.
  #
  # To broaden later, add cases above the catch-all. To narrow (e.g. require
  # signed tags only), filter inside the tag arm by name pattern.
  case "$ref" in
    refs/heads/main)  return 0 ;;
    refs/tags/*)      return 0 ;;
    *)                return 1 ;;
  esac
}

# CLI mode: print "mirror" or "skip" for each ref passed on stdin (one per line).
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  while read -r ref; do
    if should_mirror_ref "$ref"; then
      echo "mirror $ref"
    else
      echo "skip   $ref"
    fi
  done
fi
