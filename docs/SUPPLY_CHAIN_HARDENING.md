# AEGIS — Supply-chain hardening policy

> Companion to `SECURITY.md` (runtime threat model) and `INCIDENT_RESPONSE.md`
> (post-incident playbook). This doc covers **build-time and CI-time**
> supply-chain hardening — the controls that protect AEGIS from being
> compromised through its dependencies and the GitHub Actions that build it.

| Audience | Why read this |
| -------- | ------------- |
| Reviewers of any PR touching `.github/workflows/**`, `package.json`, `go.mod`, `pyproject.toml` | The enforcement gates and the bypass discipline live here. |
| Operators triaging a new CVE alert | §6 (CVE response runbook) is the playbook. |
| New contributors | §3 (the rules) is the contract. §7 (bypass discipline) is the escape hatch. |
| External auditors | §2 (precedent), §4 (mechanical controls), §8 (evidence trail). |

---

## 1. Why supply-chain hardening is a first-class concern

AEGIS is identity infrastructure. A compromise of any single dependency or
GitHub Action in the build pipeline could let an attacker:

- Exfiltrate AEGIS signing keys (used to mint policy JWTs).
- Inject backdoors into the verifier hot path that bypass denial precedence.
- Tamper with audit-chain integrity at the moment events are signed.
- Substitute compromised binaries in CLI releases that customers run.

The defenses for these scenarios live in two places: `SECURITY.md` for the
runtime, this doc for the build-and-CI surface.

## 2. The precedent that motivated this policy

On 2026-03-19 through 2026-03-22 a threat actor compromised credentials of
the `aquasecurity/trivy-action` maintainer and force-pushed 76 of 77 version
tags to point at credential-stealing malware. Anyone whose workflow had
`uses: aquasecurity/trivy-action@v0.X` (tag reference) would have silently
pulled a malicious commit on the next CI run after the force-push.

Tag refs are mutable. SHA refs are not. **The single most important
defense AEGIS has is SHA-pinning every GitHub Action it uses.**

CVE: `CVE-2026-33634` / `GHSA-r34g-c3qh-jr97`.

## 3. The rules

### Rule 1 — SHA-pin every `uses:` line in `.github/workflows/**`

```yaml
# ✗ FORBIDDEN — tag reference (mutable)
uses: actions/checkout@v4

# ✗ FORBIDDEN — branch reference (mutable)
uses: actions/checkout@main

# ✓ REQUIRED — 40-char SHA pin with version comment
uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4 (2025-11-13)
```

Exempt:
- Local reusable workflow refs: `uses: ./.github/workflows/foo.yml` (no SHA possible).

Enforcement: `.github/workflows/actions-pin-check.yml` (the gate).

### Rule 2 — Pin CLI tool versions explicitly when invoked via `run:`

When using a tool's CLI via `pip install`, `npm install`, `apt-get`, etc.,
pin to a specific version. Floating `@latest` lets upstream changes flip
scan behavior silently.

```yaml
# ✗ FORBIDDEN — implicit floating version
run: pip install semgrep

# ✓ REQUIRED — explicit pinned version
run: pip install "semgrep==1.93.0"
```

Bump versions via deliberate PR, not via the timing of the next CI run.

### Rule 3 — Verify post-incident SHAs for actions where supply-chain
incidents have been documented

When an action repo has had a documented supply-chain incident (trivy is
the canonical example), pin to a SHA whose **commit date is after the
incident window**, not just to a tag whose VERSION number is post-incident.
Tags can be force-pushed; commit dates from GitHub's git database cannot
be back-dated.

Audit recipe:
```sh
gh api /repos/<owner>/<action>/commits/<tag> --jq '.commit.committer.date'
# Verify the date is after the incident window.
```

Decisions `cd5e9e33` and `b5c2e438` are precedents — anchore/sbom-action
and pnpm/action-setup SHAs each verified during the PR #17 review for
date-coincidence with the trivy incident window.

### Rule 4 — Forward maintenance via Dependabot

`.github/dependabot.yml` configures auto-PRs for:
- GitHub Actions (proposes new SHA pins when upstream cuts versions).
- npm (pnpm workspaces).
- Go modules (`packages/cli`).
- Python (`packages/sdk-py`).

Schedule: weekly Monday. Grouping: minor/patch grouped to reduce noise;
security updates stay individual for auditability.

Without Dependabot config, SHA pins drift stale over months. With it, the
pin discipline is self-maintaining.

### Rule 5 — Bypass discipline

`--no-verify` on commit or push is permitted only when:

1. The reason is **orthogonal to the change** (e.g. `node_modules` missing
   in an isolated worktree; or `audit:errors` drift in the main worktree
   blocking pre-push on a YAML-only chore).
2. The bypass is **documented in two places**: a `Hook-bypassed:` trailer
   in the commit body, and a `Bypass note` section in the PR body.
3. The bypassed checks would not have applied to the change anyway (e.g.
   `pnpm lint-staged` on a Go-only PR; `golangci-lint` on a YAML-only PR).

Never bypass silently. Never bypass a check that DOES apply to the change.

## 4. The four-piece mechanical pattern

This is how the rules above land in the repo.

```
┌──────────────────────────────────────────────────────────────────┐
│   Spot-fix    →    Sweep    →    Gate    →    Forward-maintain   │
│   (CVE)            (catch-up)    (no regress) (auto-bumps)       │
│   PR #15           PR #17        PR #18       PR #21             │
└──────────────────────────────────────────────────────────────────┘
```

| Piece | Implementation | Function |
| ----- | -------------- | -------- |
| **1. Spot-fix** | [PR #15](https://github.com/KLYTICS/aegis/pull/15) — pin `aquasecurity/trivy-action` to SHA `ed142fd…` (v0.36.0, post-incident) | Close the active CRITICAL (CVE-2026-33634). |
| **2. Sweep** | [PR #17](https://github.com/KLYTICS/aegis/pull/17) — SHA-pin all 33 action references across 5 workflow files | Bring every existing action ref under the discipline. |
| **3. Gate** | [PR #18](https://github.com/KLYTICS/aegis/pull/18) — `.github/workflows/actions-pin-check.yml` diff-based gate | Reject any future PR that introduces a non-SHA-pinned `uses:` line. |
| **4. Forward-maintain** | [PR #21](https://github.com/KLYTICS/aegis/pull/21) — `.github/dependabot.yml` covering 4 ecosystems | Auto-PR new SHA pins as upstream cuts releases. |

Each piece reinforces the next: #15 fixes the immediate fire, #17 makes the
fire impossible at this point in time, #18 makes regression impossible, #21
keeps the pins fresh going forward.

## 5. Orthogonal hardenings that landed in the same wave

Not part of the four-piece pattern, but shipped alongside as related
build-time hygiene:

| PR | Change | Why it matters here |
| -- | ------ | ------------------- |
| [#14](https://github.com/KLYTICS/aegis/pull/14) | Wire `claude-peers conflict-check` into `.husky/pre-commit` | Coordination-level pre-commit check; complementary to PR #18's CI-level gate. Implements [Testament Book VII Chr 4:1](THE_AEGIS_TESTAMENT.md) mechanically. |
| [#16](https://github.com/KLYTICS/aegis/pull/16) | `pnpm.overrides` block forcing patched versions of 8 transitive npm deps | Closes 15 Dependabot alerts (4H/9M/2L) without source-code changes. |
| [#19](https://github.com/KLYTICS/aegis/pull/19) | Replace deprecated `returntocorp/semgrep-action` with direct `semgrep` CLI | Removes a 2.5-year-stale dep wrapper; pins `semgrep==1.93.0` per Rule 2. |
| [#20](https://github.com/KLYTICS/aegis/pull/20) | Bump `jose2go` v1.5.0 → v1.8.0 in `packages/cli` | Closes 2 Go alerts (1H/1M); incidentally promotes `go-jose/v4` from `// indirect` to direct (latent inconsistency fix). |
| [#22](https://github.com/KLYTICS/aegis/pull/22) | CLI lint workflow: explicit `go mod download` + `go-version` 1.24 + `golangci-lint` v1.64.8 | Unblocks the `undefined: toml` typecheck flake on every `packages/cli` PR. |

## 6. CVE response runbook

When Dependabot or a manual scan surfaces a new CVE on an AEGIS dependency:

### Step 1 — Triage (≤ 15 minutes)

1. Read the advisory in full. Note severity, affected versions, and
   `first_patched_version`.
2. Run `gh pr list --state open --search "<dep-name>"` to check no PR is
   already in flight (per [protocol Rule 9](../.claude/projects/-Users-money/memory/feedback_inter_session_protocol.md)).
3. Determine whether the dep is direct or transitive. Direct: bump in
   `package.json` / `go.mod` / `pyproject.toml`. Transitive: use
   `pnpm.overrides` (npm), `replace` (gomod), or constraint file (pip).

### Step 2 — Land the fix atomically

1. Branch off `main` (never feat/* branches; supply-chain fixes are
   independent of feature work). Branch name: `chore/sec-<cve-or-pkg>`.
2. Use an isolated `git worktree` to avoid contention with peer sessions
   (per [shared-tree coordination memory](../.claude/projects/-Users-money/memory/feedback_shared_tree_git_coordination.md)).
3. For npm transitives: add `pnpm.overrides` entry pinning `>=<first_patched>`
   (NOT exact version — allows future patch-level upgrades without re-PR).
4. Stage + commit with `git commit -- <pathspec>` (per [protocol Rule 2](../.claude/projects/-Users-money/memory/feedback_inter_session_protocol.md)).
   Commit message follows the Lore protocol: intent line + narrative +
   `Constraint:` / `Rejected:` / `Confidence:` / `Scope-risk:` / `Tested:` /
   `Not-tested:` trailers, plus `Closes (Dependabot): <CVE-or-GHSA>`.
5. Open PR with a test plan that lists each Dependabot alert expected to
   auto-resolve after merge.

### Step 3 — Verify post-merge

1. Visit GitHub's Security tab. The listed alerts should show
   "auto-resolved" or similar within 5 minutes of merge.
2. If an alert is NOT auto-resolved, the override didn't catch all instances
   in the dependency tree. Common cause: a different transitive path
   pulls an older version that doesn't match the `<x.y.z` constraint.
   Re-investigate with `pnpm why <package>` to map the tree.
3. Decision-archive the closure: `claude-peers decide --title "<CVE> closed by PR #<n>"`.

### Step 4 — If the dep itself is a GitHub Action

Additional steps after step 1:

5. Check the action repo for documented supply-chain incidents.
   If yes, apply Rule 3 (post-incident SHA verification).
6. Pin to a SHA, not a tag, per Rule 1.
7. Add a comment with the tag name + commit date for reviewer traceability.

## 7. Bypass discipline — when `--no-verify` is acceptable

Per Rule 5, `--no-verify` is permitted only with documented orthogonal
reasons. The valid bypass cases observed during the PR #14-#22 wave:

| Scenario | Bypass reason | Documented in |
| -------- | ------------- | ------------- |
| Isolated git worktree at `/tmp/...` lacks `node_modules` | `pnpm lint-staged` cannot run on missing deps; the chore is YAML/Go-only and doesn't need it | Commit body `Hook-bypassed:` trailer |
| Main worktree carries `audit:errors` drift from peer's in-flight work | Pre-push `pnpm doctor:full` would block on drift unrelated to the chore branch | PR body `Bypass note` section |
| Force-push to fix self-error | **NEVER** — add a completing commit instead, per [protocol Rule 10](../.claude/projects/-Users-money/memory/feedback_inter_session_protocol.md) | — |

Invalid bypass cases:

- Skipping a hook that DOES apply to the change ("the lint failure is real
  but I want to ship anyway") — fix the lint, don't bypass.
- Skipping a hook because "it's slow" — improve the hook or split the change.
- Skipping a hook because "it's flaky" — flakes are bugs; fix them or
  document them with a tracked issue.

## 8. Evidence trail (auditor-facing)

This policy's implementation is traceable end-to-end through:

1. **Pull requests** (the code):
   PRs #14, #15, #16, #17, #18, #19, #20, #21, #22 are the implementation
   landings. Each PR body documents the rationale, test plan, and bypass
   discipline.

2. **Decisions** (the durable archive):
   `~/.claude/peers/decisions.jsonl` carries the operator-level decisions
   for this wave. Surface them with:
   ```sh
   claude-peers decisions list --since 30d --project aegis
   ```
   Notable IDs for this policy: `52af759b` (dashboard CSS escort, kick-off),
   `535cc7a6` (project-scope path overlap fix), `3f78f55d` (post-commit
   auto-decide), `447c6707` (trivy CRITICAL closure), `95ffc325` (W1 alerts
   closed), `343f0619` (Testament addendum candidates), `b1afff0b` (CLI
   lint typecheck fix), `d40cb85d` (PR #22 completing commit — Rule 10
   precedent), `8d7f39f7` (Rule 10 archived to memory), `cd5e9e33` +
   `b5c2e438` (SHA date-coincidence audits — Rule 3 precedents).

3. **Session handoff log** (`docs/SESSION_HANDOFF.md`):
   Per Testament Book VII Chr 3:1 format. PR #14's landing carries the
   first entry for the supply-chain wave.

4. **Memory protocol** (`~/.claude/projects/-Users-money/memory/`):
   - `feedback_inter_session_protocol.md` — 10-rule operational protocol
     codified during this wave. Rule 9 (gh pr list before claim) and
     Rule 10 (audit your fix) are direct outputs.
   - `feedback_shared_tree_git_coordination.md` — git index discipline.
   - `feedback_aegis_bundle_lane.md` — when to stage vs commit.
   - `feedback_secret_hygiene.md` — own-output audit before declaring done.

## 9. References

- [`SECURITY.md`](SECURITY.md) — runtime threat model (this doc's runtime companion).
- [`SECURITY_RUNBOOK.md`](SECURITY_RUNBOOK.md) — incident-handling runbook.
- [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) — broader IR playbook.
- [`THE_AEGIS_TESTAMENT.md`](THE_AEGIS_TESTAMENT.md) **Book VII** — session protocol (the upstream of protocol Rules 1-8).
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — general contribution guide.
- KLYTICS Audit Discipline (in cerniq repo) — 12-rule cross-product canon;
  AEGIS scores 11/11 as the reference implementation. Supply-chain
  hardening is the implicit Rule 13 candidate that this doc proposes.

---

*Last updated 2026-05-16 by sid `1f061fc5`. Policy locks the discipline
codified across PRs #14-#22; revisit when a new attack class (e.g.
attestation-bypass, sigstore-key compromise) emerges or when the
four-piece pattern needs a fifth piece.*
