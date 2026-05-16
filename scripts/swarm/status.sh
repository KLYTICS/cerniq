#!/usr/bin/env bash
# scripts/swarm/status.sh — one-screen situational awareness.
#
# Pulls peer claims, git state, recent commits, and inbox count so a new
# Claude session can build a mental model in <30 seconds.
#
# Read-only. Safe to run as often as you want. No side effects.

set -euo pipefail

# Resolve repo root from the script's own location so this works under
# .claude/worktrees/* clones as well as the canonical checkout.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

PEERS_BIN="${HOME}/.claude/peers/bin/claude-peers"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
dim()  { printf '\033[2m%s\033[0m\n' "$1"; }
hr()   { printf '─%.0s' {1..72}; echo; }

bold "AEGIS swarm status — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
dim  "repo: $REPO_ROOT"
hr

# ── Git state ──────────────────────────────────────────────────────
bold "Git"
echo "  branch: $(git rev-parse --abbrev-ref HEAD)"
echo "  upstream: $(git rev-parse --abbrev-ref @{u} 2>/dev/null || echo '(none)')"

# Unstaged + untracked count without -uall to avoid memory issues
unstaged_count=$(git status --short | wc -l | tr -d ' ')
echo "  unstaged + untracked files: $unstaged_count"

ahead=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)
behind=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
echo "  vs upstream: ahead=$ahead behind=$behind"

hr

# ── Recent commits across all branches (last 6h) ──────────────────
bold "Recent commits — last 6h, all branches"
git log --all --since="6 hours ago" --oneline --no-decorate 2>&1 | head -15 \
  | sed 's/^/  /' || echo "  (none)"

hr

# ── Active peer claims (this repo only) ───────────────────────────
bold "Active peer claims — aegis"
if [ -x "$PEERS_BIN" ]; then
  "$PEERS_BIN" status 2>&1 | grep -E '^\s*\[aegis' | head -10 \
    | sed 's/^/  /' || echo "  (none)"
else
  echo "  (claude-peers CLI not found at $PEERS_BIN)"
fi

hr

# ── Inbox ──────────────────────────────────────────────────────────
bold "Inbox"
if [ -x "$PEERS_BIN" ]; then
  unread_line=$("$PEERS_BIN" inbox 2>&1 | head -1 || true)
  echo "  $unread_line"
else
  echo "  (claude-peers CLI not found)"
fi

hr

# ── Files I should NOT touch without claim ─────────────────────────
bold "Always-coordinate files (Law 4 — Shared files)"
echo "  pnpm-lock.yaml, package.json, WORK_BOARD.md, SESSION_HANDOFF.md,"
echo "  OPERATOR_DECISIONS.md, CLAUDE.md, apps/api/prisma/schema.prisma,"
echo "  packages/types/src/index.ts, apps/api/src/modules/verify/algorithm/verify.algorithm.ts"

hr

# ── Quick reference ───────────────────────────────────────────────
bold "Next steps"
echo "  1. Read docs/SWARM_ORCHESTRATION.md (if not loaded this session)"
echo "  2. Copy scripts/swarm/templates/CLAIM.md → /tmp/, fill it in"
echo "  3. $PEERS_BIN claim '<slug>' --paths '<paths>'"
echo "  4. Work the plan"
echo "  5. bash scripts/swarm/handoff.sh >> /tmp/handoff-draft.md"

hr
