# AEGIS — PR Backlog Triage (2026-05-21)

> Operator-actionable merge order for the 26 open PRs. Generated from a
> 3-agent parallel audit (CI/infra, feat/refactor, deps/security) plus
> session-merged confirmation from this branch.
>
> **Repo state at write time**: `main` at `c4ddb01`. Active in-flight:
> PR #2 (`feat/sdk-verify-gateway-hardening`) at `1aa3960` —
> spec-sync trio GREEN, docs-parity workflow-fix pending CI re-run.
>
> **Peer-claim awareness**:
> - `aegis:husky-preflight-make-rewrite-fix` (sid 09b16195) — husky pre-commit
>   work in sibling worktree `~/Desktop/AEGIS-husky-fix`. Do not touch
>   `.husky/**` until released.
> - `aegis:platform-hygiene` (sid 9b6fe3f6) — shipped PR #37 (doctor:full
>   hermeticity) + PR #36 (eslint deps); now investigating warp runner
>   blackout + audit-chain CI. Do not touch `.github/workflows/audit-chain*.yml`
>   or warp-related runner config until released.
> - `aegis:pr-backlog-triage` (this session) — wrote this doc, owns
>   spec-sync + SDK V2 catch-up on feat branch.

---

## TL;DR — the leverage moves

| Order | PR  | Why this first                                                                   | Risk |
|------:|----:|----------------------------------------------------------------------------------|------|
| 1     | #37 | hermetic `doctor:full` preflight — every future PR's pre-push works on cold checkouts | low  |
| 2     | #15 | trivy-action SHA pin — closes the only **CRITICAL** Dependabot alert (1 line)    | low  |
| 3     | #20 | jose2go v1.5.0 → v1.8.0 — already MERGEABLE, closes 1H + 1M, 4 lines             | low  |
| 4     | #10 | api-key-rotation `buildReq` mock — 1-line test repair, unblocks 3 specs          | low  |
| 5     | #16 | W1 pnpm.overrides — closes 15 alerts (4H/9M/2L), 2 files, code-free              | low  |
| 6     | #11 | CLI lint + Go 1.24 toolchain — clears `lint` gate on every PR; **CLOSE #22** as superseded | low  |
| 7     | #39 | warp → ubuntu-latest contingency — unblocks runner-dependent jobs                 | low  |

After Tier 1: ~95% of CI gates flip green across the backlog, repo's CRITICAL
Dependabot alert closes, and ~17 of 49 alerts clear. Estimated 30-min operator
work + ~10 min CI per PR.

---

## The single biggest unblock: rebase the train

**Every CONFLICTING / UNSTABLE PR** in the backlog shares one common red gate:
`SCA · osv-scanner / osv-scan`. Main's PR #29 (`1f9bd6e chore(security): break
osv-scanner merge-train deadlock with sunset allow-list`) landed the fix
(`[[PackageOverrides]]`-keyed sunset list per the `feedback_security_tooling.md`
memory note). The remaining 20 PRs predate #29 in their head SHAs.

**Mechanical fix**: `gh pr checkout <N> && git rebase origin/main && git push -f`
flips osv-scanner FAILURE → SUCCESS across the entire batch with zero code changes.

The other chronic red gates are also mostly clear now:
- `OpenAPI ↔ Zod`, `OpenAPI ↔ Prisma`, `Denial precedence enum (ADR-0004)` — fixed by PR #32 (M-056 onion-peel) merged to main.
- `lint` (CLI) — addressed by PR #11.
- `parity (docs ↔ types)` — addressed by `468c3bf` on this branch (builds @aegis/types + @aegis/sdk before parity tests).

---

## Per-PR table (sorted by recommended action)

Status legend: ✅ = recommend merge as-is after Tier 0 (rebase), 🔄 = needs
rebase + light edit, ❓ = operator decision required, ❌ = close as superseded,
⚠️ = invariant or security concern flagged.

### Tier 1 — Merge first (highest leverage, smallest risk)

| PR  | Action | Title                                              | Files | +/-     | Notes |
|----:|:------:|----------------------------------------------------|------:|--------:|-------|
| #37 | ✅     | `chore(doctor): hermetic doctor:full preflight`    |     1 | +42/-3  | Unblocks pre-push hook for every future PR. Single file. PEER-shipped, ready. |
| #15 | ✅     | `chore(ci): pin trivy-action SHA ed142fd (v0.36.0)` |    1 | +1/-1   | Closes the only CRITICAL Dependabot alert (supply-chain compromise). 1 line. |
| #20 | ✅     | `chore(deps/go): jose2go v1.5.0 → v1.8.0`          |     2 | +4/-4   | 2 Go alerts closed (1H + 1M). Already MERGEABLE. |
| #10 | ✅     | `fix(test): repair api-key-rotation buildReq mock` |     1 | +6/-1   | Adds `headers: {}` to mock so 3 specs stop throwing on `req.header('x-aegis-api-key')`. |
| #16 | 🔄     | `chore(deps): W1 transitive sweep via pnpm.overrides` | 2  | +33/-99 | 15 alerts in 2 files (undici×5, fast-uri×2, lodash×3, qs, cookie, ip-address, postcss, js-yaml). Aligned with PR #29 `[[PackageOverrides]]` pattern. Rebase needed. |
| #11 | ✅     | `ci(cli): CLI workflow — toolchain + lint debt + goreleaser` | 18 | +79/-54 | Go 1.22→1.24, golangci-lint v1.59→v1.64.5, 36 lint findings, `builds[].dir`. Pair with: **CLOSE #22**. |
| #39 | ✅     | `ci(runners): warp-* → ubuntu-latest contingency` |     ? | ?       | Unblocks runner-dependent CI while Warp pool dies. PEER-owned (in flight). |

### Tier 2 — Merge after Tier 1 (compound leverage)

| PR  | Action | Title                                              | Notes |
|----:|:------:|----------------------------------------------------|-------|
| #28 | 🔄     | `feat(infra): push-to-main deploy + grouped Dependabot + continuous E2E` | Compound leverage: grouped Dependabot collapses N CVE PRs into 1. Workflows fail-soft without secrets. Needs operator setup (Railway/Vercel secrets, branch protection, gh-pages, staging principal). |
| #34 | 🔄     | `fix(api): re-enable silently-skipped e2e + correlation echo bug` | **REAL SECURITY FIX**: `HttpExceptionFilter` was echoing client-controlled `x-request-id`, defeating `CorrelationMiddleware` sanitization (200-byte attacker bytes in headers). Plus widens jest `testRegex` to unmask 4 silently-skipped suites. |
| #13 | 🔄     | `feat(webhooks): lock payload contracts + drift observability` | Closes a documented silent-failure class. Producer-side typed builders + delivery-time re-validation + drift metric. Renames 2 miswired event constants. 20-case parity spec included. |
| #17 | 🔄     | `chore(ci): SHA-pin all GitHub Actions across workflows (33 refs)` | Pairs with #15. Defers trivy-action to #15. Will conflict with #19 on semgrep-action line (#19 deletes it). |
| #19 | ✅     | `chore(ci): replace deprecated semgrep-action with direct CLI` | Pins `semgrep==1.93.0`; preserves rule set + SARIF output. Independent. |
| #12 | ❓     | `fix(ci): audit-chain workflow fails fast on missing secrets` | **Merging is safe** — cron stays failing until operator populates secrets (OD-017). PR explicitly documents this. **⚠️ Coordinate with peer 9b6fe3f6 who is investigating audit-chain CI failures.** |
| #23 | ✅     | `docs(security): SUPPLY_CHAIN_HARDENING.md capstone` | 1-file doc. Defer until #14-#22 settle so references stay accurate. |

### Tier 3 — Needs operator decision or upstream work

| PR  | Action | Title                                              | Decision needed |
|----:|:------:|----------------------------------------------------|-----------------|
| #25 | ❓     | `feat(types,sdk-ts,dashboard): canonical DenialContextKind` | Base branch is `feat/sdk-verify-gateway-hardening` (not main). Stacked on PR #2. **Decide**: re-base on main, or fold into PR #2's Round 10. Public SDK contract addition. |
| #30 | ❓     | `feat(verifier-rp): verifyAuditChain offline verification` | **DUPLICATION**: `@aegis/audit-verifier` package already exists. **Decide**: keep both packages, or refactor verifier-rp to delegate to audit-verifier. |
| #31 | ❓     | `feat(examples): RP compliance dashboard demo` | Uses `@aegis/audit-verifier`. Soft-blocked on #30 duplication decision. |
| #18 | ✅     | `ci: SHA-pin enforcement gate (diff-based)` | Land **after** #15 + #17 so existing actions are already pinned (avoids retroactive noise). |
| #21 | ✅     | `chore(ci): Dependabot config for 4 ecosystems` | Land **after** #28 so the grouped strategy is in place; otherwise generates a daily CVE-PR flood. |
| #14 | 🔄     | `chore(husky): conflict-check pre-commit` | **⚠️ Peer-claimed**: husky pre-commit work is owned by peer 09b16195 in sibling worktree. Coordinate before rebase. |
| #4  | 🔄     | `fix(infra): enterprise quality pass` | Large diff (24 files, +1390/-296). Touches hooks (peer-overlap risk), dup `/v1/v1/...` route fix, RFC 8037 JWK fields, e2e sync. **NEEDS_REBASE + careful coordination.** |
| #9  | 🔄     | `fix(audit): repair SOC2 third-party verification (M-038)` | Large (42 files, +2407/-326). Three sequential SOC2 fixes (kid stamp, prev-hash chain columns + migration, ndjson-v2 wire shape). KMS pin (correctness fix). **Separate audit/M-038 track** — surface to next handoff. |
| #24 | ❓     | `ci(cli): goreleaser monorepo cwd fix` | Likely superseded by #11. Verify before closing. |
| #38 | ✅     | `docs(handoff): post-merge audit of PR #35` | **ALREADY MERGED** as `c4ddb01`. Skip from action list. |

### Close as superseded

| PR  | Reason |
|----:|--------|
| #8  | Bundled approach superseded by atomized PRs (#15 trivy, #16 W1 overrides, #17 SHA-pin, #20 jose2go). **Salvage**: extract OTel 2.x migration + Next 16.2.6 bump as 2 standalone PRs before closing (~16 alerts otherwise lost). |
| #22 | Superseded by #11. **Salvage**: cherry-pick the `cmd/events.go:185` named-return err-propagation bug fix that #22 has but #11 doesn't — this is a real production bug, not just lint debt. |

---

## ⚠️ Invariant risks to flag for operator

### HIGH: JWT claim adapter silent-coercion regression (from PR #38 audit)

PR #38's session handoff flagged a **silent failure** introduced in already-merged
PR #35: adapters in `auth0/clerk/mcp` use `typeof === 'string'` checks that
silently coerce 4 input shapes to `''`. This **violates root CLAUDE.md
invariant 4** ("No silent failures and no fabricated data") for an auth path.

**Action**: open a follow-up fix PR with paired tests for each adapter's
input-shape contract. **Do not defer** — silent coercion in auth is a security
issue, not a code-quality nit.

### MEDIUM: PR #35 missing paired tests

PR #35 added new error paths in `AuditSignerService`, `AuditService`, and
`hashLeaf` without paired tests. Per CLAUDE.md Quality bar: "Crypto, auth,
billing, policy, audit, and tenant-boundary changes require paired tests in
the same change." Should be backfilled as part of the same follow-up.

### LOW: husky pre-commit make exit-code

Peer 09b16195 owns the fix. Track via their PR.

---

## Coverage gap: 49 → ~16 alerts after Tier 1+2 merges

After merging #15 + #16 + #20 + (#8's salvaged OTel/Next splits):
- ✅ #1 critical (trivy)
- ✅ #2, #3 jose2go
- ✅ #4-#20 (cookie, js-yaml, undici×5, qs, lodash×3, postcss, fast-uri×2, ip-address)
- ✅ #28-#31 OTel
- ✅ #32-#44 Next.js

**Remaining gaps (W2 sweep needed)**:
- `esbuild` (3 alerts)
- `hono` (3 alerts)
- `vite` (3 alerts)
- `brace-expansion`, `tmp`, `ws`, `protobufjs`, `uuid` (~5 alerts)

Total residual: ~14 alerts. Operator should plan a "W2 transitive sweep" PR
after the W1 batch lands.

---

## Likely lockfile / file-collision pairs

When merging in order, watch for these:

| First                | Second               | Conflict on              | Resolution |
|----------------------|----------------------|--------------------------|------------|
| #16                  | #8                   | `pnpm.overrides` block   | Close #8   |
| #16                  | #9                   | `pnpm-lock.yaml` (KMS)   | Rebase #9  |
| #16                  | #4                   | `pnpm-lock.yaml`         | Rebase #4  |
| #20                  | #8                   | `go.sum`                 | Close #8   |
| #17                  | #15                  | trivy-action line        | #15 wins (precedence) |
| #17                  | #19                  | semgrep-action line      | #19 (delete) wins |
| #17                  | #28                  | workflow YAML            | Rebase #28 |
| #14                  | #4                   | `.husky/pre-commit`      | Coordinate (peer-owned) |
| #9                   | #4                   | `api-key-rotation.controller.spec.ts` | Rebase #4 |

---

## Operator next-30-minutes runbook

1. Merge **#37** (peer-shipped, ready).
2. Merge **#15** (1 line, closes CRITICAL).
3. Merge **#10** (1 line, test repair).
4. Merge **#20** (already MERGEABLE).
5. Rebase + merge **#16** (15 alerts in 2 files).
6. After Tier 1 cascades through CI: each remaining PR should auto-flip
   osv-scanner → SUCCESS once rebased. The remaining red gates per PR are
   then real, not chronic.
7. Open follow-up issue for the **PR #38 Gap 1 JWT silent-coercion** —
   highest doctrinal-risk follow-up.
8. Schedule a "W2 transitive sweep" PR for the residual ~14 alerts.

---

## What this triage did NOT cover

- **PR #2** (this branch) — self-evaluated separately; status: 4 commits merged
  from main today, spec-sync trio GREEN locally, docs-parity workflow-fix
  pending CI confirm at `468c3bf`. Re-fetch CI status on the latest SHA.
- **Issue / Dependabot alerts** — only triaged the alert-→-PR mapping;
  did not audit the alerts themselves for false positives.
- **Branch-protection rule changes** — operator-owned; not in this scope.
- **Stripe / Auth0 / KMS / WorkOS credential population** — out of scope per
  OPERATOR_DECISIONS.md.

---

*Generated by 3 parallel triage agents (CI/infra: 8 PRs, feat/refactor: 7
PRs, deps/security: 8 PRs) + session synthesis. Source-of-truth check time
recorded at the top.*
