# launch-runbook executable spec

Companion to [`docs/LAUNCH_RUNBOOK.md`](../../docs/LAUNCH_RUNBOOK.md). Turns the runbook's prose-shaped Phase 0 gap claims into bash-shaped tests so the runbook is *executable*, not just readable.

The thing it solves: prose runbooks have no test surface. A step can be wrong for hours/days before an operator runs it and discovers the gap. The 2026-05-16 round-1 vs round-2 cycle of `docs/LAUNCH_RUNBOOK.md` corrections (`fcbfb4d` then `b6ea8b6`) demonstrated this: round 1 prescribed `POST /v1/principals` + `AEGIS_ADMIN_TOKEN` + `seed:admin` — none of which existed in code. A grep would have caught it; an executable check would have caught it at every CI run.

## phase-0-check.sh

The single load-bearing primitive. Runs five Phase 0 gap checks (Gaps 1-5 from the runbook) plus three bonus consistency checks. Each check is one `grep` or one `test -f`. When a gap closes in code, the corresponding check flips from FAIL to PASS without runbook prose needing to be edited.

```sh
bash scripts/launch-runbook/phase-0-check.sh             # summary mode
bash scripts/launch-runbook/phase-0-check.sh --verbose   # show evidence for each pass
```

Exit codes:

- `0` — all Phase 0 gaps closed; v1 launch path unblocked
- `1` — one or more gaps remain; see the failure summary
- `2` — script misconfiguration (wrong cwd, missing repo files, etc.)

## When to run it

- **Before drafting any LAUNCH_RUNBOOK edit.** If you're about to write "operator runs X", grep for X first. This script automates that grep for the five canonical gaps.
- **As a pre-PR check** when the branch claims to close a Phase 0 gap. If `phase-0-check.sh` still reports the gap as FAIL, the claim is false.
- **As a smoke test post-IDP-install.** When the operator wires Auth0 v4 (or Clerk, or WorkOS), this script confirms Gap 4 flips from FAIL to PASS.

## Adding new checks

Each check is a single-purpose grep with a clear PASS/FAIL semantic. Follow the pattern in `phase-0-check.sh`:

```sh
if grep -q "pattern" path/to/file; then
  check "name" "PASS" "evidence string"
else
  check "name" "FAIL" "what's missing + where to look"
fi
```

The script is intentionally framework-free — pure bash + grep + standard utilities. No `pnpm`, no `node`, no `tsx`. The runbook gate must work on a fresh clone in seconds, not after a 30s install.

## What this is NOT

- It is not a CI gate (yet). Add it to `pnpm doctor` via `scripts/doctor.ts` if you want it to block pushes.
- It does not test runtime behavior — only static code presence. The Auth0 invite end-to-end is still operator-tested.
- It does not replace the runbook prose. Prose explains *why* a gap matters; this script tests *whether* it is closed.
