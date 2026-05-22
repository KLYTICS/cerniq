#!/usr/bin/env bash
# 00-preflight.sh — refuse to run unless the repo is in a safe state.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "[preflight] Checking repo state..."

# 1. Is this the AEGIS repo?
if [ ! -f CLAUDE.md ] || ! head -10 CLAUDE.md | grep -q -E '^# (AEGIS|OKORO)'; then
  echo "ERROR: this does not look like the AEGIS repo (no CLAUDE.md, or no recognizable heading)." >&2
  exit 1
fi

# 2. No stale index.lock
if [ -f .git/index.lock ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y .git/index.lock 2>/dev/null || stat -f %m .git/index.lock) ))
  if [ "$AGE" -lt 30 ]; then
    echo "ERROR: .git/index.lock is $AGE seconds old — another git process is active. Aborting." >&2
    exit 1
  fi
  echo "[preflight] Removing stale .git/index.lock (age=${AGE}s)"
  rm -f .git/index.lock
fi

# 3. Clean tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: working tree is dirty. Commit or stash before running." >&2
  git status --short >&2
  exit 1
fi

# 4. Detect active worktrees so we can warn about skipped branches
WORKTREE_COUNT=$(git worktree list | wc -l)
if [ "$WORKTREE_COUNT" -gt 1 ]; then
  echo "[preflight] $((WORKTREE_COUNT - 1)) extra worktree(s) detected."
  echo "            Branches checked out in those worktrees will be SKIPPED."
  echo "            Run 'git worktree prune' after stopping other agents to catch them."
  git worktree list
  echo
fi

# 5. Confirm we are on a branch (not detached)
if ! git symbolic-ref -q HEAD >/dev/null; then
  echo "ERROR: HEAD is detached. Check out a branch before running." >&2
  exit 1
fi

# 6. Confirm git user is set
if ! git config user.email >/dev/null; then
  echo "ERROR: git user.email not set. Configure git before running." >&2
  exit 1
fi

# 7. Optional Excel lock warning
if [ -f "docs/finance/.~lock.AEGIS_Financial_Model_v1.xlsx#" ]; then
  echo "WARNING: docs/finance/AEGIS_Financial_Model_v1.xlsx has an Excel lock."
  echo "         Close Excel before continuing if you want the file renamed."
fi

echo "[preflight] OK"
