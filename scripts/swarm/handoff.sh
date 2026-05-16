#!/usr/bin/env bash
# scripts/swarm/handoff.sh — generates a SESSION_HANDOFF.md entry skeleton
# from current git state + peer claim.
#
# Outputs to stdout. Pipe to a file, review, then APPEND (manually) to the
# top of docs/SESSION_HANDOFF.md per Law 3 (append-only).
#
# Usage:
#   bash scripts/swarm/handoff.sh > /tmp/handoff-draft.md
#   $EDITOR /tmp/handoff-draft.md
#   # paste at top of docs/SESSION_HANDOFF.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

PEERS_BIN="${HOME}/.claude/peers/bin/claude-peers"

DATE_UTC=$(date -u +%Y-%m-%d)
TIME_UTC=$(date -u +%H:%MZ)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
LAST_COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "none")
LAST_COMMIT_SUBJECT=$(git log -1 --pretty=format:'%s' 2>/dev/null || echo "(no commits)")

# Try to detect current peer claim slug
PEER_CLAIM=""
if [ -x "$PEERS_BIN" ]; then
  PEER_CLAIM=$("$PEERS_BIN" status 2>&1 | grep '(you)' | head -1 | sed 's/.*\[\(aegis:[^]]*\)\].*/\1/' || echo "")
fi

# Paths recently touched
TOUCHED_PATHS=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | head -20 || echo "")

cat <<EOF
# ${DATE_UTC} ${TIME_UTC} — <one-line summary>

**Slug:** ${PEER_CLAIM:-aegis:tribe-scope-discriminator}
**Branch:** \`${BRANCH}\`
**Last commit:** \`${LAST_COMMIT_SHA}\` — ${LAST_COMMIT_SUBJECT}

## What landed

- TODO bullet 1
- TODO bullet 2

## Tests

- \`pnpm --filter <pkg> typecheck\` — PASS
- \`pnpm --filter <pkg> test\` — N/N PASS
- \`pnpm test:parity\` — X/X PASS

## Paths touched

\`\`\`
${TOUCHED_PATHS:-(none — fill in)}
\`\`\`

## Memory updates

- [[memory-slug]] — updated / added / superseded

## Follow-ups (for peers)

- For peer <sid>: <action>
- For operator: <decision needed>

## Operator decisions surfaced / closed

- OD-XXX — <status change>

## Coordination broadcasts sent

- \`claude-peers msg all "..."\` — <thread-id>

---

EOF

echo "" >&2
echo "✓ Skeleton generated. Review, fill in TODOs, prepend to docs/SESSION_HANDOFF.md." >&2
echo "  Reminder: append-only per Law 3 — do not edit existing entries." >&2
