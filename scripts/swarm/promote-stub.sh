#!/usr/bin/env bash
# scripts/swarm/promote-stub.sh — promote an integration stub directory
# from packages/integrations/<slug>/ to packages/aegis-<slug>/ as a real
# pnpm workspace package.
#
# This is the canonical promotion path described in
# docs/INTEGRATION_ROADMAP.md and packages/integrations/README.md.
#
# Usage:
#   bash scripts/swarm/promote-stub.sh openai
#
# What it does:
#   1. Verifies packages/integrations/<slug>/ exists with package.json or README.md
#   2. Verifies packages/aegis-<slug>/ does NOT already exist
#   3. Moves the directory: packages/integrations/<slug> → packages/aegis-<slug>
#   4. Patches package.json name to @aegis/<slug>
#   5. Adds a minimal tsconfig.json extending the workspace base
#   6. Prints the next-step checklist (peer-claim, fill in TODOs, tests, etc.)
#
# Idempotent until the move happens. After the move, you own the work —
# subsequent calls will error out (which is correct: don't re-promote).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

if [ $# -ne 1 ]; then
  echo "Usage: bash scripts/swarm/promote-stub.sh <slug>" >&2
  echo "  e.g.  bash scripts/swarm/promote-stub.sh openai" >&2
  exit 64
fi

SLUG="$1"
STUB_DIR="packages/integrations/${SLUG}"
TARGET_DIR="packages/aegis-${SLUG}"

if [ ! -d "$STUB_DIR" ]; then
  echo "✖ Stub not found: $STUB_DIR" >&2
  echo "  Available stubs:" >&2
  ls -1 packages/integrations/ 2>/dev/null | grep -v README | sed 's/^/    /' >&2
  exit 1
fi

if [ -d "$TARGET_DIR" ]; then
  echo "✖ Target already exists: $TARGET_DIR" >&2
  echo "  Either you already promoted this, or a peer did. Check git log:" >&2
  echo "    git log --oneline -- $TARGET_DIR" >&2
  exit 1
fi

echo "→ Promoting $STUB_DIR → $TARGET_DIR"

# 1. Move the directory
git mv "$STUB_DIR" "$TARGET_DIR"

# 2. Patch package.json if it exists
PKG_JSON="$TARGET_DIR/package.json"
if [ ! -f "$PKG_JSON" ]; then
  echo "  ⚠ No package.json found — generating a minimal one"
  cat > "$PKG_JSON" <<EOF
{
  "name": "@aegis/${SLUG}",
  "version": "0.1.0",
  "private": false,
  "description": "AEGIS integration — ${SLUG}",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "eslint --max-warnings=0 src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aegis/sdk": "workspace:*"
  }
}
EOF
else
  # Patch name field — keep existing structure
  if command -v node >/dev/null 2>&1; then
    node -e "
      const fs=require('fs');
      const pkg=JSON.parse(fs.readFileSync('$PKG_JSON','utf8'));
      pkg.name='@aegis/${SLUG}';
      pkg.private=false;
      fs.writeFileSync('$PKG_JSON', JSON.stringify(pkg,null,2)+'\n');
      console.log('  ✓ Patched package.json: name → @aegis/${SLUG}');
    "
  else
    echo "  ⚠ node not in PATH — package.json name field not auto-patched"
    echo "    Manually: set \"name\": \"@aegis/${SLUG}\" in $PKG_JSON"
  fi
fi

# 3. Add tsconfig.json if missing
TSCONFIG="$TARGET_DIR/tsconfig.json"
if [ ! -f "$TSCONFIG" ]; then
  cat > "$TSCONFIG" <<'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
EOF
  echo "  ✓ Added tsconfig.json"
fi

echo ""
echo "✓ Promoted $STUB_DIR → $TARGET_DIR"
echo ""
echo "Next steps:"
echo "  1. Claim the promotion in claude-peers:"
echo "       ~/.claude/peers/bin/claude-peers claim 'aegis:int-${SLUG}: implement @aegis/${SLUG}' \\"
echo "         --paths '${TARGET_DIR}/**'"
echo ""
echo "  2. Verify pnpm picks it up:"
echo "       pnpm install"
echo "       pnpm --filter '@aegis/${SLUG}' typecheck"
echo ""
echo "  3. Implement the TODO bodies in ${TARGET_DIR}/src/index.ts"
echo ""
echo "  4. Add paired tests at ${TARGET_DIR}/src/index.spec.ts"
echo ""
echo "  5. Update apps/marketing/lib/integrations.ts:"
echo "       flip status from 'planned' or 'coming-soon' → 'beta' or 'available'"
echo ""
echo "  6. Append a changelog entry to apps/marketing/lib/changelog.ts"
echo ""
echo "  7. When done: bash scripts/swarm/handoff.sh"
echo "                 commit explicit-path"
echo "                 ~/.claude/peers/bin/claude-peers release aegis:int-${SLUG}"
