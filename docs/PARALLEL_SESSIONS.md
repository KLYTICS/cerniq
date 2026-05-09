# AEGIS — Concurrent Session Protocol

> **Reality:** several Claude sessions and contractors regularly work in this
> repo at the same time. The audit chain in `docs/SESSION_HANDOFF.md` shows
> rounds where two or three sessions landed merging changes from independent
> claims. This file documents the protocol that makes that work without merge
> conflicts or silent regressions.

---

## 1. The four-rule contract

1. **Claim before you write.** Run `claude-peers claim aegis <module-id>` before
   editing files outside the trivial-doc-fix scope. Other sessions see your
   claim via `claude-peers status`.
2. **Stay in your paths.** Each module ticket in `WORK_BOARD.md` lists the file
   paths it owns. Do not write outside them without messaging the holder of
   the conflicting claim.
3. **Surface, don't swallow.** When you discover a peer regression in code you
   weren't claimed against (typecheck error, broken test), fix it minimally
   and call it out in `docs/SESSION_HANDOFF.md` so the original author can
   review. Never delete or rewrite peer work to make your own land cleanly.
4. **Append a handoff entry on landing.** Newest at top in
   `docs/SESSION_HANDOFF.md`. Include: claim id, what shipped, what you
   touched outside your owned paths (and why), and what you left for next
   session.

---

## 2. Coordinator-only files

Some files are touched by every session — they're the natural rendezvous point
and need conflict-free coordination:

| File | Why it's shared | Protocol |
| --- | --- | --- |
| `apps/api/src/app.module.ts` | Every new module registers here | Each session leaves a one-line "add to imports" note in their handoff entry. The coordinator session batches them into a single edit. |
| `apps/api/src/config/config.schema.ts` | Every new env var declared here | Same — leave a note, coordinator merges. Use unique sections so concurrent edits don't conflict. |
| `apps/api/prisma/schema.prisma` | Every schema change | Migrations are forward-only (see `IMMUTABILITY.md`). Two sessions adding migrations on the same day is fine — directory names are timestamp-prefixed. |
| `apps/api/src/common/observability/metrics.service.ts` | New Prometheus counters | Append-only; just add at the bottom of the class and the registry block. |
| `WORK_BOARD.md` | The claim ledger | One session at a time, transactional via `claude-peers claim`. |
| `docs/SESSION_HANDOFF.md` | The history | Newest at top; never edit peer entries (correct via a NEW entry that references theirs). |

---

## 3. The peer CLI cheat sheet

```sh
claude-peers status                        # Who's working in this repo right now
claude-peers claim aegis <module-id> \
  --note "<what you'll do>" --ttl 7200     # Acquire a claim (2h TTL)
claude-peers release aegis:<module-id>     # Release when done
claude-peers msg <session-id> "<text>"     # Talk to a peer
claude-peers inbox                         # Read messages addressed to you
claude-peers heartbeat                     # Refresh your TTL during long work
claude-peers stop                          # Terminate your active claims (panic stop)
```

The advisory layer is friendly — claims are advisory, not exclusive locks.
Two sessions can both claim if they both have a reason; the protocol relies
on each agent reading the other's claim notes and respecting paths.

---

## 4. Coordinator pattern — when you're orchestrating

When a session takes the coordinator role (orchestrating sub-agents):

1. **Disjoint paths up front.** Plan the work so each sub-agent owns a path
   prefix that no other agent will touch. The coordinator owns the shared
   files (`app.module.ts`, `config.schema.ts`).
2. **Self-contained briefs.** Each sub-agent prompt includes the relevant
   invariants from `CLAUDE.md`, the path scope (owned + forbidden),
   acceptance criteria, the exact files to read first, and a coordinator-note
   pattern for shared-file changes.
3. **Sub-agent sandbox quirks.** Sub-agents may hit Write-tool denial in
   sandboxed environments. The coordinator should be ready to take over
   directly. Round 14 (gate1-coordinator) is an example: 3 of 4 sub-agents
   reported plan-only; the coordinator picked up the work using their gap
   analyses to align with concurrent peer code.
4. **Integration phase last.** After sub-agents return, the coordinator
   batches `app.module.ts` / `config.schema.ts` edits, runs `pnpm check`,
   and writes a single SESSION_HANDOFF entry covering the whole round.

---

## 5. Conflict resolution

The git working tree is the contention point. When two sessions race:

- **Same file, different sections** → merge cleanly. Run `pnpm check` after.
- **Same file, same section** → the second session reads the first's diff
  before continuing. If both are correct, merge by hand. If they conflict
  semantically, message the first session and pick one.
- **Schema migrations on the same day** → both land. The directory
  timestamp prefix ensures order is unambiguous. Apply in chronological
  order.
- **Both sessions ran `pnpm install`** → the lockfile may have churn.
  Re-run from the second session and commit the resulting `pnpm-lock.yaml`.

---

## 6. What to do if you find dangling work

Common situation: 100+ unstaged files from previous peer sessions that
never got committed. The default posture:

1. **Don't blanket-stage everything.** That tangles your work with theirs
   and makes the diff unreviewable.
2. **Stage only files you authored or intentionally fixed.** Leave the
   rest in the working tree for the original session to land.
3. **Document what you saw.** A SESSION_HANDOFF entry that mentions
   "peer X has Y unstaged in modules Z/W" tells future sessions what to
   expect — and tells the original peer their work is still visible.
4. **For typecheck/lint regressions in peer code:** fix minimally if the
   regression blocks your work. Note it explicitly. Otherwise leave it
   for the owner.

---

## 7. Trust but verify

A session's SESSION_HANDOFF entry is what they *intended* to do. The actual
state of the repo is the source of truth. Before assuming a previous session
landed something you depend on:

```sh
git status --short                          # Is it actually committed?
git log --oneline -- <path-or-glob>         # When did it land?
pnpm check                                  # Does it still build green?
```

Memory-only assumptions about peer work age fast. The codebase doesn't lie.

---

## 8. When the protocol fails

Symptoms:
- Two sessions both land migrations targeting the same column
- A coordinator file (`app.module.ts`) gets reverted in a merge
- Tests pass locally but fail in CI because a peer's uncommitted file
  isn't in the workflow's clone

Recovery:
- The most recent committed state is canon. Reset uncommitted work that
  conflicts; re-apply your changes on top.
- If two migrations conflict, merge them into a third "fixup" migration
  and revert the originals' SQL to no-ops (this is the ONLY case where
  a committed migration may be edited — see `IMMUTABILITY.md` § "Forced
  reconciliation").
- Talk it out via `claude-peers msg`. The coordination cost of a 30-second
  message is far below the cost of an unwound merge.
