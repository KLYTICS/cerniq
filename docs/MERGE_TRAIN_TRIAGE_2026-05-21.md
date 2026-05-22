---
title: OKORO — Merge-train triage (2026-05-21)
triaged-on: 2026-05-21
triager: sid=busy-khorana-7281c7 (autonomous, read-only)
scope: 8 DIRTY PRs blocking the supply-chain hardening wave
result: 1 SUPERSEDED (close), 7 STALE-FORK (re-extract from current main)
---

# OKORO — Merge-train triage (2026-05-21)

A focused triage of the 8 DIRTY pull requests as of 2026-05-21. The
finding: **none of them are real merge conflicts in the substance
sense**. All 8 forked on or before 2026-05-09 (9+ days before the M-014
docs platform shipped on 2026-05-18) and inherited 79 unintended
deletions of `apps/docs/*` files. Rebasing those deletions onto current
main would be silently destructive (it would un-land M-014).

The correct fix is **re-extraction** — cherry-pick the real changes
onto a fresh branch off current main, leaving the stale deletions
behind. One PR (#26) is already SUPERSEDED by [PR #32](https://github.com/KLYTICS/okoro/pull/32) and should
just close.

## TL;DR action table (sorted by priority)

| PR | Title | Action | Blocks | Notes |
|----|-------|--------|--------|-------|
| [#26](https://github.com/KLYTICS/okoro/pull/26) | fix(spec-sync) M-056 regression | **Close** | unblocks #32 | Superseded by [#32](https://github.com/KLYTICS/okoro/pull/32) (broader scope; mergeable) |
| [#9](https://github.com/KLYTICS/okoro/pull/9) | fix(audit): SOC2 third-party verification (M-038) | Re-extract | SOC2 compliance | Compliance-critical; 39 real modifications + 79 stale deletions |
| [#2](https://github.com/KLYTICS/okoro/pull/2) | SDK VerifyGateway: 4-round enterprise hardening | Re-extract | Core SDK feature | 206 new files of substantive work |
| [#25](https://github.com/KLYTICS/okoro/pull/25) | feat(types,sdk-ts,dashboard): canonical DenialContextKind | Re-extract | Dashboard wiring | 177 new files; type-system feature |
| [#13](https://github.com/KLYTICS/okoro/pull/13) | feat(webhooks): payload contracts + drift observability | Re-extract | Webhook obs | Cross-cutting; needed for multi-tenant story |
| [#4](https://github.com/KLYTICS/okoro/pull/4) | fix(infra): enterprise quality pass | Re-extract | Infra hardening | 27 real code mods; auth + compliance |
| [#8](https://github.com/KLYTICS/okoro/pull/8) | chore(deps): close all 44 Dependabot alerts | Re-extract | Dep health | Batch with #16 |
| [#16](https://github.com/KLYTICS/okoro/pull/16) | chore(deps): W1 transitive sweep via pnpm.overrides | Re-extract | Dep health | 6 real mods; closes 15 alerts (4H/9M/2L) |
| [#14](https://github.com/KLYTICS/okoro/pull/14) | chore(husky): wire conflict-check pre-commit | Re-extract | Peer tooling | Smallest scope; 7 real mods |

## The root cause is structural, not substantive

All 8 PRs forked on 2026-05-09 from a main that did NOT have
`apps/docs/`. M-014 (Fumadocs documentation platform) shipped on
2026-05-18 with ~100 files of new content. The unaware branches
diff against current main as `+changes + 79 deletions in apps/docs/*`.

GitHub's "DIRTY" merge-state status correctly identifies that a
straight rebase would conflict, but the conflict resolution would
silently re-delete the docs platform — exactly the opposite of what
the PR author intended.

## Recommended re-extraction recipe

For each PR (other than #26 which just closes):

```bash
# 1. Identify the substantive commits on the stale branch
git log origin/main..origin/<stale-branch> --oneline

# 2. Branch fresh from current main
git checkout -b <fresh-branch-name> origin/main

# 3. Cherry-pick the substantive commits (NOT the M-014-delete merges)
git cherry-pick <commit1> <commit2> ...
# Resolve conflicts on the real code only; do NOT re-introduce
# apps/docs/* deletions.

# 4. Verify the diff is what you expected
git diff origin/main..HEAD --stat

# 5. Push and open fresh PR
git push -u origin <fresh-branch-name>
gh pr create --title "<retitled or same>" --body "Re-extracted from #<original> onto post-M-014 main. See triage docs/MERGE_TRAIN_TRIAGE_2026-05-21.md."

# 6. Close the original PR with a pointer to the fresh one
gh pr close <original> --comment "Re-extracted as #<new>; this PR's stale-fork apps/docs/* deletions would un-land M-014. See docs/MERGE_TRAIN_TRIAGE_2026-05-21.md."
```

## Why not rebase + force-push?

A rebase of these branches onto current main would NOT silently
re-delete the docs platform — git would surface the conflicts. But
the conflict-resolution effort is substantial (79 files × 8 PRs = 632
conflict resolutions, most of which are "keep main's version"). Each
resolution carries a small risk of subtle mistakes. Re-extraction is
both faster and safer: you keep only what you wrote, leaving the rest
of the codebase untouched.

## Priority order

If operator capacity is limited and only a few re-extractions can
happen this week, prioritize:

1. **[#26](https://github.com/KLYTICS/okoro/pull/26) close** — 30 seconds, removes confusion, clears the
   "spec-sync regression fix" double-PR situation.
2. **[#9](https://github.com/KLYTICS/okoro/pull/9) (M-038 SOC2 audit chain)** — compliance-critical,
   lands SOC2 third-party verification work.
3. **[#16](https://github.com/KLYTICS/okoro/pull/16) (W1 dep sweep)** — closes 15 Dependabot alerts
   immediately (4 HIGH, 9 MEDIUM, 2 LOW). Highest security ROI per
   minute of re-extraction effort.
4. **[#25](https://github.com/KLYTICS/okoro/pull/25) (DenialContextKind)** — feature work that other
   sessions may be waiting on.
5. Everything else as bandwidth allows.

## What this triage does NOT do

This is a read-only triage. No PRs were rebased, force-pushed, closed,
or modified. The operator (or next session) executes from this map.
