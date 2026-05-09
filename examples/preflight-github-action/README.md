# `examples/preflight-github-action/` — wire AEGIS preflight to GitHub Actions

> Drop-in CI integration for the `tools/preflight/` ship-readiness gate.
> Runs on every PR + push, posts a sticky comment with the JSON output,
> and fails the build on gating failures (exit 2) while still allowing
> ship-with-warning (exit 1) to land with reviewer ack.

---

## What this gives you

- **Per-PR sticky comment** — one comment per PR, updated in place on
  every push, showing pass/warn/fail counts + the table of checks.
- **Hard gate on exit 2** — gating failures (tsc, lint, migration
  immutability, parity drift, etc.) block merge.
- **Soft gate on exit 1** — warnings (env vars, operator decisions,
  architecture drift) fail the job *visibly* but don't auto-block; the
  PR description must include `acknowledged warnings:` for branch
  protection rules to allow merge.
- **Fast path** — pre-commit checks run `--fast` (no vitest); CI
  upgrades to the full run.

---

## Files in this example

| Path | Purpose |
|---|---|
| `.github/workflows/preflight.yml` | Workflow you copy to your repo |
| `comment-template.md` | The sticky-comment Markdown template |
| `README.md` | This file |

---

## Install

```bash
# From the AEGIS repo root
mkdir -p .github/workflows
cp examples/preflight-github-action/.github/workflows/preflight.yml \
   .github/workflows/preflight.yml
```

Then in your repo's branch protection rules, require the `preflight` job
to pass. Optional: also require a label `acked: warnings` on PRs that
exit 1.

---

## How it works

1. **Checkout + install** — standard pnpm setup (uses `pnpm/action-setup` + cached modules).
2. **Run preflight** — executes `make preflight ARGS="--json"` and writes the result to `preflight.json`.
3. **Parse + render** — extracts pass/warn/fail counts, builds a
   Markdown table from the `checks[]` array.
4. **Sticky comment** — uses `marocchino/sticky-pull-request-comment` to
   post one comment per PR, updated in place.
5. **Set exit code** — the job exits with the same code as preflight;
   GitHub treats exit 2 as failure, exit 1 as failure-with-warning.

---

## Behavior matrix

| preflight exit | GH job status | Sticky comment | Branch protection |
|---|---|---|---|
| 0 (pass) | ✅ green | "READY TO SHIP" | merge allowed |
| 1 (warn) | ❌ failed | "SHIP WITH CARE — N warnings" + table | merge blocked unless `acked: warnings` label OR PR description contains `acknowledged warnings:` |
| 2 (fail) | ❌ failed | "DO NOT SHIP — N gating failures" + table + remediation hints | merge blocked unconditionally |
| 3 (internal error) | ❌ failed | "preflight tool errored — investigate" | merge blocked |

---

## Customizing

- **Skip slow checks in PR mode** — change `ARGS="--json"` to
  `ARGS="--json --fast"` in the PR job. Keep full run on the
  `push: main` job for the merge-queue gate.
- **Run prod gate on release** — add a third job triggered by
  `workflow_dispatch` or `release.published` with `ARGS="--json --prod"`.
- **Slack mirroring** — replace the sticky comment step with one that
  posts to Slack via webhook on exit 1+.

---

## Troubleshooting

**Job fails with "make: command not found"** — the runner image needs
GNU make. Add `runs-on: ubuntu-latest` (which includes it) or install
explicitly: `apt-get install -y make`.

**Sticky comment isn't updating** — confirm `permissions: pull-requests:
write` is set on the job. Check that the `marocchino/sticky-pull-request-
comment` step has a stable `header` value (the dedup key).

**JSON parse fails** — check the preflight output for stderr leakage.
The runner should redirect to file: `make preflight ARGS="--json" > preflight.json`.

---

## See also

- `tools/preflight/README.md` — what each check does, how to extend.
- `infra/observability/runbooks/preflight-failure.md` — per-check
  remediation guide engineers will reference when their PR fails the
  gate.
- `docs/SPRINT_PROTOCOL.md` § 6.1 — the FAANG quality bar this gate
  encodes.
