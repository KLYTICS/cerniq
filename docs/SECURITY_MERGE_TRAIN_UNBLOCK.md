# Security merge-train unblock (2026-05-20 → 2026-06-30)

**Status:** active deadlock workaround. Sunset: 2026-06-30.

## What this is

The repo is in a chicken-and-egg state: `SCA · osv-scanner` in
`.github/workflows/security.yml` runs with `fail-on-vuln: true` against
`pnpm-lock.yaml`. The lockfile contains transitive CVEs (cookie, hono,
lodash, next, fast-uri, ws, undici, etc.). PR #16 fixes them via
`pnpm.overrides` — but PR #16 can't merge because osv-scanner is failing
on those same vulns. Therefore main can't get the fix, and therefore
every open PR (currently 23) inherits the broken state and cannot merge.

`osv-scanner.toml` at the repo root carries explicit `IgnoredVulns`
entries for each known-deadlocked CVE, each citing the resolving PR and
a sunset date 30 days out. This unblocks the merge train without
silencing the underlying detection — SARIF is still uploaded to the
GitHub Security tab.

## Why allow-list instead of disabling the gate

Three alternatives considered:

1. **Flip `fail-on-vuln: false`** — broadest unblock, but disables the
   gate entirely. Future CVEs would land silently. **Rejected.**

2. **Switch osv-scanner to advisory-only** (`continue-on-error: true`)
   — same problem as #1; the gate stops being a gate.

3. **Surgical `osv-scanner.toml` IgnoredVulns with sunset dates** —
   chosen approach. The gate still fails-closed on any new CVE not in
   the allow-list. The known-deadlock CVEs are explicitly named with
   their resolving PRs, so a reviewer can verify each entry is real.
   Sunset dates force re-evaluation.

## Sequencing the unblock

Once this PR merges, the suggested merge order for the existing backlog:

| Step | PR  | What lands                                                     |
|------|-----|----------------------------------------------------------------|
| 1    | THIS | osv-scanner.toml + this doc                                   |
| 2    | #15 | trivy-action SHA pin (closes CRITICAL CVE-2026-33634; +1/-1)   |
| 3    | #16 | pnpm.overrides W1 transitive sweep (closes 15 alerts)          |
| 4    | #17 | SHA-pin all GitHub Actions (33 refs, 13 distinct actions)      |
| 5    | #18 | SHA-pin enforcement gate (so future PRs can't unpin)           |
| 6    | #20 | Go jose2go bump (closes 1H + 1M Go alerts)                     |
| 7    | #19 | Replace deprecated semgrep-action with CLI                     |
| 8    | #11 | Repair CLI workflow Go toolchain (resolves govulncheck deadlock) |
| 9    | #8  | Close all 44 dependabot alerts (atomic commits)                |
| 10+  | rest | Triage by impact; rebase against the new clean main           |

After step 3 (PR #16 lands), most of the IgnoredVulns entries in
`osv-scanner.toml` can be removed. Do that in the same commit that
removes the deadlock — not in a separate PR — so the allow-list shrinks
in lockstep with the actual remediation.

## What this is NOT

- Not a permanent allow-list. Every entry has a sunset.
- Not a SOC2 control bypass. SARIF still uploads; auditors see the
  vulns in the GitHub Security tab.
- Not a substitute for fixing the underlying CVEs. It just orders the
  fixes so they can actually land.

## After 2026-06-30

If the backlog isn't drained by sunset, the file's entries expire and
CI fails again on every PR. That's intentional — the sunset is the
forcing function. The on-call action at sunset is one of:

1. Confirm all referenced PRs landed and the vulns are gone → remove
   the expired entries.
2. Confirm the vulns still exist → extend with explicit operator
   sign-off and a new sunset date (no longer than 30 days).
3. Escalate to forced pnpm.overrides if upstream hasn't patched.

## References

- `.github/workflows/security.yml` lines 71-85 (osv-scanner step)
- `osv-scanner.toml` (the allow-list itself)
- PR #15, #16, #17, #18, #20 (the remediation backlog)
- https://google.github.io/osv-scanner/configuration/ (config format)
