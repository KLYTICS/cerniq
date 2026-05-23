# `scripts/swarm/` — coordination helpers for N parallel Claude sessions

Operational tooling that implements `docs/SWARM_ORCHESTRATION.md`. Three scripts, two templates.

## Scripts

| Script | One-line | When to run |
|---|---|---|
| `status.sh` | One-screen situational awareness | First action of every session |
| `handoff.sh` | Generates a `docs/SESSION_HANDOFF.md` entry skeleton | Before releasing your peer claim |
| `promote-stub.sh <slug>` | Promotes `packages/integrations/<slug>/` → `packages/aegis-<slug>/` workspace package | When a peer claims an integration stub |

All scripts are idempotent and safe to dry-run. They never `git add`, `git commit`, or `git push` on your behalf — those stay manual per Law 2 (explicit-path staging).

## Templates

| Template | When |
|---|---|
| `templates/CLAIM.md` | Copy-paste before submitting a `claude-peers claim` |
| `templates/HANDOFF.md` | Copy-paste when writing a `SESSION_HANDOFF.md` entry |

## Making the scripts executable

The scripts ship as plain files (so they survive worktree clones cleanly). Make them executable on first use:

```sh
chmod +x scripts/swarm/*.sh
```

Or invoke them via the interpreter directly:

```sh
bash scripts/swarm/status.sh
bash scripts/swarm/handoff.sh
bash scripts/swarm/promote-stub.sh openai
```

## Quick start for a new Claude session

```sh
# 1. Situational awareness
bash scripts/swarm/status.sh

# 2. Read the protocol (~5 min)
cat docs/SWARM_ORCHESTRATION.md | less

# 3. Plan your claim from template
cp scripts/swarm/templates/CLAIM.md /tmp/my-claim.md
$EDITOR /tmp/my-claim.md

# 4. Submit the claim
~/.claude/peers/bin/claude-peers claim "<slug>: <one-line>" --paths "<paths>"

# 5. Work the plan, then handoff
bash scripts/swarm/handoff.sh >> /tmp/handoff-draft.md
$EDITOR /tmp/handoff-draft.md
# (append to docs/SESSION_HANDOFF.md after review)
```

## Future scripts (TODO)

These would be valuable additions when a peer claims `aegis:coord-swarm-tooling-v2`:

- `claim-amend.sh` — extend an active claim's paths without re-issuing
- `conflict-pre-commit.sh` — git pre-commit hook checking staged paths against active claim
- `dry-run-release.sh` — preview the broadcast message before releasing
- `sync-memory.sh` — automated diff of memory entries vs current code state, flag drift

These are *not* in scope for v1.0.0 of the scaffold. They become high-leverage at N>=10 peer sessions.
