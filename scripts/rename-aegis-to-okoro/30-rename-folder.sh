#!/usr/bin/env bash
# 30-rename-folder.sh — rename the root folder OKORO -> OKORO.
# Run this from the PARENT directory (e.g. /Users/money/Desktop), AFTER
# every other step has completed and you've verified `pnpm check` is green.
set -euo pipefail

PARENT="$(pwd)"
if [ ! -d "$PARENT/OKORO" ]; then
  echo "ERROR: expected $PARENT/OKORO to exist. Run this from the parent of the OKORO folder." >&2
  echo "Hint:  cd /Users/money/Desktop && bash OKORO/scripts/rename-okoro-to-okoro/30-rename-folder.sh" >&2
  exit 1
fi

if [ -e "$PARENT/OKORO" ]; then
  echo "ERROR: $PARENT/OKORO already exists. Refusing to clobber." >&2
  exit 1
fi

echo "About to rename:"
echo "  $PARENT/OKORO   ->   $PARENT/OKORO"
echo
echo "After the rename:"
echo "  - Your shell may need to cd into the new path."
echo "  - Any editor/IDE workspace pointing at OKORO must be repointed at OKORO."
echo "  - The Cowork app's selected folder will need to be reselected."
echo "  - The 26 worktrees pointing at OKORO sub-paths (\.claude/worktrees/*)"
echo "    will need 'git worktree repair' from inside the renamed folder."
echo
read -r -p "Proceed? [y/N] " confirm
case "$confirm" in
  y|Y|yes|YES) ;;
  *) echo "aborted"; exit 1 ;;
esac

mv "$PARENT/OKORO" "$PARENT/OKORO"
echo "OK: renamed."
echo
echo "Now run from inside the new folder:"
echo "  cd $PARENT/OKORO"
echo "  git worktree repair"
echo "  pnpm install"
echo "  pnpm check"
