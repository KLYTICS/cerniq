# AEGIS → OKORO rename kit

Aggressive, in-place, case-preserving rename across the entire repo and all
local branches. Generated 2026-05-21 by Claude. **Read the entire file before
running anything.**

## What this does

- Replaces `AEGIS` → `OKORO`, `Aegis` → `Okoro`, `aegis` → `okoro` in every
  tracked text file except `pnpm-lock.yaml` and `apps/api/prisma/migrations/`.
- Renames every file and directory whose path contains `aegis` (any case).
- Emits a new Prisma migration that ALTERs the `aegis_app` / `aegis_owner`
  roles, `aegis_current_principal` / `aegis_rls_bypass_active` functions, and
  the `aegis.*` GUC namespace to their `okoro` equivalents.
- Loops over every local branch that is **not** currently checked out in
  another worktree and applies the same rename + commit per branch.
- Optionally renames the root folder `AEGIS` → `OKORO` at the end.

## What it does NOT do

- Touch existing migration files (CLAUDE.md immutability contract). Adds a new
  migration instead.
- Touch other worktrees (`/private/tmp/aegis-*`, `/Users/money/Desktop/AEGIS-*`,
  `.claude/worktrees/*`). Branches checked out in those worktrees are skipped.
  Stop those agents, prune the worktrees, then re-run `20-rename-all-branches.sh`
  to catch the remainder.
- Regenerate `pnpm-lock.yaml`. After the rename you must run `pnpm install`
  yourself so the lockfile picks up the new `@okoro/*` scope.
- Update real Stripe / Auth0 / DNS / KMS configurations. Operator-owned per
  CLAUDE.md. The script renames every reference in code/docs but you must
  rotate the actual provider configs out-of-band.
- Push anything. Every commit stays local. Push when you're ready.

## Order of operations

First make the scripts executable (one-time):

```bash
chmod +x scripts/rename-aegis-to-okoro/*.sh
```

Then from the repo root:

```bash
./scripts/rename-aegis-to-okoro/run.sh
```

`run.sh` calls these in order:

| Step | Script                             | What it does                                                                                  |
| ---- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| 1    | `00-preflight.sh`                  | Sanity: in repo, no index.lock, clean tree                                                    |
| 2    | `10-rename-checkout.sh`            | Renames text + paths in the current checkout (`aegis`→`okoro`, `aegislabs.io`→`okorolabs.io`) |
| 3    | `15-rebrand-domain-to-okoroapp.sh` | Second-pass domain rebrand `okorolabs.io`→`okoroapp.com` per OD-024 (exclusion-locked)        |
| 4    | `40-emit-prisma-migration.sh`      | Writes the new rename migration                                                               |
| 5    | `20-rename-all-branches.sh`        | Loops branches, runs steps 2-4, commits per branch                                            |
| 6    | `30-rename-folder.sh`              | Renames `AEGIS` → `OKORO` (must be last)                                                      |

**Why two passes for the apex domain?** `10-rename-checkout.sh` is a
case-preserving `aegis`→`okoro` substitution; it mechanically converts
`aegislabs.io` to `okorolabs.io`. The operator's chosen apex is
`okoroapp.com` (OPERATOR_DECISIONS.md OD-024, DECIDED 2026-05-21), not
`okorolabs.io`. `15-rebrand-domain-to-okoroapp.sh` is the second pass
that completes the cascade. It carries a locked exclusion list
(durable peers decision `1c0003a0`) protecting the decision-history
files that describe the operator's choice — those must keep
`okorolabs.io` to preserve the audit trail.

You can run any step on its own; each is idempotent. The orchestrator just
chains them.

## Pre-flight checklist (do these before running)

1. Stop every other Claude session and prune their worktrees:
   ```bash
   git worktree list
   git worktree prune
   ```
   Branches still checked out elsewhere will be skipped.
2. Close `docs/finance/AEGIS_Financial_Model_v1.xlsx` in Excel (it currently
   has a `.~lock.*` file). The script will rename the file; Excel won't.
3. Commit or stash your in-flight edits to `AGENTS.md`, `OPERATOR_DECISIONS.md`,
   `WORK_BOARD.md`, `docs/SESSION_HANDOFF.md`, `.cursor/`, and
   `docs/decisions/0020-cross-project-agent-orchestrator.md`. The script
   refuses to start if the tree isn't clean.
4. Make a backup. The script commits per branch and there's no undo button:
   ```bash
   cd ..
   cp -R AEGIS AEGIS.backup-2026-05-21
   ```

## Known caveats

- **README.md line 1** is already `# OKORO — Agent Gateway & Identity Stack`
  from a sandbox test. The script's substitution is a no-op for that line and
  catches the rest of the file. No action needed.
- **Provider-backed values are operator-owned.** The script will produce
  references like `sales@okorolabs.io` and `@okoro/api` in code, but the
  real domain, npm registry publishes, Stripe price IDs, Auth0 actions, and
  KMS keys must be updated by you.
- **Lockfile drift.** Until you run `pnpm install`, every `pnpm` command will
  complain about the lockfile being out of sync.
- **CI may go red.** Any pinned GitHub Actions referencing `aegis-` artifacts
  or images will need their pins updated. Search for `aegis` after running:
  ```bash
  git grep -i aegis
  ```
  Should return zero matches except inside `.git/` and `node_modules/`.
- **Migrations applied to existing environments.** The new migration ALTERs
  DB-level names. If a production environment has already applied the
  aegis-named objects, this migration will rename them in place. If your
  application starts using `okoro.principal_id` before the migration runs,
  every query will fail RLS. Coordinate the deploy: migration first, then code.
- **Audit-chain invariant.** The rename does not touch `AuditEvent` rows.
  Hash-chain verification continues to work because the data is unchanged;
  only schema-level names move.

## Rollback

`git reflog` and the per-branch commits make this fully reversible:

```bash
# list rename commits
git log --all --grep='chore: rename aegis to okoro' --oneline

# undo on current branch
git reset --hard HEAD~1

# undo across all branches that were renamed
./scripts/rename-aegis-to-okoro/rollback.sh    # (not generated; see 20-rename-all-branches.sh log)
```

If you took the `AEGIS.backup-2026-05-21` snapshot, you can also just
`rm -rf AEGIS && mv AEGIS.backup-2026-05-21 AEGIS`.
