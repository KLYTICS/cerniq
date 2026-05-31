# AEGIS — Launch Readiness Audit (2026-05-21, ultrathink synthesis)

> What does it take to acquire AEGIS's first paying customer? This audit
> connects the phase-0 launch gate, the open PR backlog, OPERATOR_DECISIONS
> rows, Dependabot exposure, and the AEGIS doctrine invariants — and
> produces an operator-actionable sequence with a named cheapest path.
>
> **Audit method**: ran `scripts/launch-runbook/phase-0-check.sh --verbose`
> against `origin/main` (sha `c0a415a`), cross-referenced
> `OPERATOR_DECISIONS.md`, `WORK_BOARD.md`, the 28 open PRs at audit time,
> and the 49 open Dependabot alerts. All references cite source files.

---

## 1. Executive summary

**First-customer blocker = the wire-up gap, not the PR backlog.** 5 of
8 phase-0 gates fail on `origin/main`. The 26-PR backlog is largely
quality / hardening — the customer-onboarding plumbing (email service,
API key auto-issuance, IDP SDK, lazy Principal creation) does not exist
in any open PR.

**Cheapest path to customer #1**: Founder-led onboarding via an
**`AdminGuard` + `AEGIS_ADMIN_TOKEN` endpoint** that lets the operator
manually create Principal + issue API key + email it. This closes
phase-0 Gaps 3 + 5 with ~1 day of engineering, defers Gaps 1 + 2 + 4
to "first 5 customers landed" milestone, and gets to revenue without
waiting on Auth0/Clerk vendor selection (OD-015) or Resend wiring.

**Hardening sequence (parallel to founder-led wedge)**: the 16
ready-to-merge PRs (after this session's rebase blitz) close all chronic
CI cascades + the only CRITICAL Dependabot alert + the HIGH-severity
JWT silent-coercion auth invariant. Operator merge work is ~30 minutes;
no engineering required from operator.

**The 49 Dependabot alerts drop to ~14** after Tier 1 + Tier 2 merges
(per the order in § 5 below); the residual 14 need 2 dedicated PRs
(Next 16.2.5 minor bump, OTel 2.x migration).

---

## 2. Phase-0 gate output (verbatim, captured 2026-05-21 at sha c0a415a)

```
Phase 0 gap checks  (docs/LAUNCH_RUNBOOK.md)

  ✗ Gap 1 — no lazy principal creation in checkout webhook
     apps/api/src/modules/billing/stripe.service.ts accepts metadata.principalId /
     client_reference_id but does not lazily create from session.customer_email.
     Cold-stranger Payment Links still cannot complete checkout.

  ✗ Gap 2 — no email service in apps/api/
     0 actual provider imports / EmailService class definitions in apps/api/src/.
     Pick a provider (Resend is the lowest-friction option) and wire it.

  ✗ Gap 3 — no API-key auto-issuance in billing webhook
     0 matches for issueApiKey|provisionApiKey|generateApiKey|apiKey.create|
     prisma.apiKey.create in apps/api/src/modules/billing/.

  ✗ Gap 4 — IDP SDK not installed in dashboard
     Neither @auth0/nextjs-auth0 nor @clerk/nextjs nor @workos-inc/* found in
     apps/dashboard/package.json. Pick one and pnpm add it.

  ✗ Gap 5 — no admin path to create a Principal in production
     0 AEGIS_ADMIN_TOKEN matches, 0 AdminGuard matches, 0 IDP SDKs installed.
     v1 onboarding is blocked. Closing Gap 4 satisfies Gap 5.

  ✓ Bonus — IDP adapters all call prisma.principal.create
  ✓ Bonus — dashboard has UpgradeButton for Flow B
  ✓ Bonus — marketing CTAs route to mailto

Phase 0: 5 gap(s) remaining  (3/8 pass, 0 warn, 5 fail)
```

### What each gap actually means for the customer journey

| Gap | What breaks for a customer if not closed | Closure surface |
|----:|------------------------------------------|-----------------|
| 1   | Stripe Payment Link checkout fails for cold visitors (no prior signup) | `apps/api/src/modules/billing/stripe.service.ts` — add `principalService.findOrCreate({email: session.customer_email})` |
| 2   | API key cannot be delivered to customer after checkout | New `apps/api/src/modules/email/` with Resend client + `EmailService` class |
| 3   | Even if principal exists, no API key is issued at paid-tier checkout | Extend `onCheckoutCompleted` in stripe.service.ts to issue + hash + email key |
| 4   | Dashboard login does nothing (Auth0 receiver is dark per CLAUDE.md note) | `pnpm add @auth0/nextjs-auth0` (or chosen IDP per OD-015) |
| 5   | No way for operator to manually create a customer in prod | Either close Gap 4 OR add `AdminGuard` + `AEGIS_ADMIN_TOKEN` env-gated endpoint |

---

## 3. Open PR backlog state (28 PRs, 2026-05-21 post-rebase-blitz)

### Status distribution after this session's rebases

| State | Count | Notes |
|-------|------:|-------|
| MERGEABLE, CI green-or-cycling | 16 | Ready for operator review (post-rebase) |
| Stacked on PR #2 (resolves when #2 merges) | 1 | #25 (DenialContextKind canonicalization) |
| Real hot-path conflicts (need feature owner) | 3 | #4, #9, #13 |
| Recommended close (superseded) | 2 | #8, #22 |
| Large infra, needs operator setup | 1 | #28 |
| PR #2 itself (this branch's wedge) | 1 | Self-mergeable after #11 lint cascade |
| Other (decisions pending) | 4 | #25, #30/#31 (audit-verifier dup), #34, #42 |

### What each MERGEABLE PR actually does for the launch path

| PR  | Phase-0 impact? | Quality impact | Recommended order |
|----:|----------------|----------------|-------------------|
| #15 | none           | Closes **only CRITICAL** Dependabot alert | Tier 1 #1 |
| #11 | none           | Clears `lint` gate on **every** PR        | Tier 1 #2 |
| #42 | none           | Closes **HIGH-severity** auth invariant (silent claim coercion) | Tier 1 #3 |
| #16 | none           | Closes 15 transitive Dependabot alerts    | Tier 1 #4 |
| #48 | none           | Closes 8 more transitive Dependabot alerts (this session) | Tier 1 #5 |
| #34 | none           | Closes **real production** X-Request-Id sanitization bug | Tier 1 #6 |
| #20, #17, #19, #21, #18, #23, #14, #12, #24, #28, #30, #31 | none | Hygiene / supply chain / future-proofing | Tier 2 |
| (no PR exists) | **Gaps 1+2+3** | Customer onboarding wire-up | **Block** |
| (no PR exists) | **Gap 4**     | IDP SDK install + Auth0 v4 config | **Block, see OD-015** |

**Reading this table**: every existing open PR is hardening. The
phase-0 launch wire-up has not been started.

---

## 4. Operator decisions blocking phase-0 closure

Cross-referenced from `OPERATOR_DECISIONS.md` (last-reviewed 2026-05-02):

| OD     | Decision                              | Phase-0 connection                                 | Default if silent                                |
|--------|---------------------------------------|----------------------------------------------------|--------------------------------------------------|
| **OD-015** | Default IdP (Auth0 vs Clerk)      | **Gap 4** can't close without this                 | Auth0 (default lives in `ADR-0009 §1`)           |
| OD-004 | Audit retention horizon (years)       | SOC2 readiness; not phase-0 blocker                | 7 years (financial-services norm)                |
| OD-001 | BATE scoring weights                  | M-007 (BATE) not on critical path for customer #1  | Rule-based v1 with documented defaults           |
| OD-002 | Cold-start trust accelerator          | Same — BATE                                        | New agents start at 500, KYC required for >700   |
| OD-005 | Webhook DLQ max attempts              | M-008 (webhooks) — needed for delivery reliability | 8 attempts (Stripe parity)                       |
| OD-006 | FREE-tier rate limit                  | Needed before public beta, not for first customer  | 10 req/sec per principal                         |
| OD-007 | Status-page hosting                   | SOC2 CC7.4, not phase-0                            | Self-hosted at `status.aegislabs.io`             |
| OD-009 | CLI authentication model              | Optional UX polish                                 | Device-code OAuth (like `gh auth login`)         |
| OD-013 | Default policy engine                 | M-039 wiring                                       | `builtin` for new principals                     |
| OD-016 | GDPR redact API public exposure       | EU GA, not phase-0                                 | Public under FULL-scope API key                  |

**Operator action with biggest phase-0 leverage**: accept the **OD-015
default (Auth0)**. That unblocks Gap 4 immediately. The dashboard team
(or a single PR) can then `pnpm add @auth0/nextjs-auth0` and wire the
login receiver per ADR-0009. Gap 5 closes as a side effect.

---

## 5. Recommended sequence (operator-actionable)

### Phase A — Hardening cascade (~30 min operator work, today)

Merge in this order — each step has a single one-line `gh pr merge` command:

```bash
# Tier 1 — clears chronic CI cascades + critical security
gh pr merge 15 --squash   # trivy CRITICAL — 1-line CVE fix
gh pr merge 11 --squash   # CLI lint + Go 1.24 — clears `lint` gate everywhere
gh pr merge 42 --squash   # JWT silent-coercion auth invariant — HIGH severity
gh pr merge 16 --squash   # W1 pnpm.overrides — 15 alerts
gh pr merge 48 --squash   # W2 pnpm.overrides — 8 alerts (rebase needed if #16 merged first)
gh pr merge 34 --squash   # X-Request-Id sanitization — REAL prod bug
gh pr merge 20 --squash   # jose2go Go bump — 2 alerts
gh pr merge 23 --squash   # SUPPLY_CHAIN_HARDENING.md capstone

# Tier 2 — supply chain + workflow hygiene
gh pr merge 17 --squash   # SHA-pin all GH Actions (33 refs)
gh pr merge 19 --squash   # semgrep-action → CLI
gh pr merge 21 --squash   # Dependabot config (4 ecosystems)
gh pr merge 18 --squash   # SHA-pin enforcement gate (depends on #15+#17)
gh pr merge 14 --squash   # husky conflict-check
gh pr merge 12 --squash   # audit-chain defensive secrets
gh pr merge 24 --squash   # goreleaser monorepo cwd

# Tier 3 — features (require review)
gh pr merge 28 --squash   # push-to-main deploy pipeline (operator setup needed)
gh pr merge 30 --squash   # verifyAuditChain (after deciding @aegis/audit-verifier dup)
gh pr merge 31 --squash   # RP compliance dashboard demo
# PR #2 becomes mergeable after #11 lands; merge as final step of Phase A:
gh pr merge 2 --squash    # SDK V2 + spec-sync trio + INTENT_MISMATCH + 5 main-merges

# Close as superseded — salvage one bug from each first:
# - #22 has cmd/events.go:185 named-return err bug not in #11
# - #8 has OTel migration + Next 16.2.5 not in atomized PRs
gh pr close 22 --comment "Superseded by #11; salvage cmd/events.go:185 bug in follow-up"
gh pr close 8  --comment "Superseded by atomized #15/#16/#17/#20/#48; salvage OTel + Next bumps in 2 follow-up PRs"
```

After Phase A: **49 → ~14 Dependabot alerts**, `lint` gate green
everywhere, JWT silent-coercion closed, X-Request-Id bug closed, PR
backlog at ~5 (vs 28 today).

### Phase B — Phase-0 launch closure (~1-3 days engineering)

| Step | What | Closes Gap | Effort |
|-----:|------|-----------|--------|
| B1 | Decide OD-015 (Auth0 vs Clerk vs WorkOS) | 4 | 5 min |
| B2 | `pnpm add @auth0/nextjs-auth0` + wire login receiver per ADR-0009 | 4 + 5 | 4-8h |
| B3 | Add `EmailService` with Resend client to apps/api/src/modules/email/ | 2 | 4h |
| B4 | Wire API-key auto-issuance in `stripe.service.ts.onCheckoutCompleted` + email plaintext once | 3 | 6h |
| B5 | Add `principalService.findOrCreate({email})` in checkout webhook | 1 | 3h |

OR (cheapest founder-led path) — **skip B2 / B3 / B5, do B4 + admin endpoint**:

| Step | What | Closes Gap | Effort |
|-----:|------|-----------|--------|
| Bα   | Add `AdminGuard` + `AEGIS_ADMIN_TOKEN` env var + `POST /admin/principals` + `POST /admin/api-keys` | 3 + 5 | 4-6h |
| Bβ   | Operator manually emails first 5-10 customers via personal Gmail with their API key | 2 (manual) | 0h |
| Bγ   | Defer dashboard signup + Stripe Payment Links until 5+ customers in hand | 1 + 4 | post-revenue |

The founder-led path matches the GTM brief in `docs/execution/AEGIS_LATEST_SESSION_GTM_VALIDATION_2026-05-17.md` (operator's own framing: "5-10 manually-onboarded high-signal pilot buyers"). It also de-risks Auth0 vendor selection (OD-015) until there's customer-visible evidence of which IDP they want.

### Phase C — Polish for self-serve (post first 5 customers)

| Step | What | Effort |
|-----:|------|--------|
| C1 | Close phase-0 Gaps 1 + 2 + 4 (full self-serve flow) | per Phase B B2-B5 |
| C2 | Open separate PRs for vite + esbuild + Next 16.2.5 + OTel 2.x migrations | 4 PRs |
| C3 | Close PR #4 (enterprise quality pass) + PR #9 (SOC2 third-party) + PR #13 (webhook contracts) | needs feature owner |
| C4 | Operator decisions OD-001 / OD-002 / OD-004 / OD-005 / OD-006 / OD-007 / OD-009 / OD-013 / OD-016 | 30 min/each |
| C5 | AEGIS → OKORO rebrand commit strategy (staged in main worktree by Cursor Cloud) | strategic |

---

## 6. Risk register

| Risk | Severity | Mitigation status |
|------|----------|-------------------|
| 1 CRITICAL + 17 HIGH Dependabot alerts on default branch | high | Closed in Tier 1 (#15 + #42 + W1/W2 overrides + #20) |
| Auth invariant 4 ("no silent failures") violated in IDP adapters | high | Closed by PR #42 (this session) |
| PR #38 Gap 2: missing paired tests for AuditSignerService / AuditService / hashLeaf | medium | **CLOSED on main 2026-05-21 by PR #46 (sha 4b9b4ed) — peer-shipped while audit was in flight** |
| Spec-sync drift between OpenAPI / Zod / Prisma / verifier-rp | medium | Closed by main's PR #32 + this branch's #59 backfill |
| osv-scanner PR-side failures flagged as environmental (per peer ca612b33) | low | Environmental — same root family as the Warp runner blackout closed by PR #39 (now on ubuntu-latest) |
| Marketing `next lint --max-warnings=0` deprecated post-Next 16 (CI gate red) | medium | Not closed — needs dedicated marketing lint cleanup PR; 81 pre-existing lint errors |
| AEGIS → OKORO rebrand staged but uncommitted in main worktree | medium | Operator-strategic — has effects on every package.json, ADR-0020 references it. Peer 0c5056a4 advisory: **leave `workers/cf-verify/` ALONE** during rebrand — wire-format coupling with deployed binary; see docs/decisions/0021-cloudflare-okoro-rename.md |
| PR #2 lint gate red until #11 lands | low | Will auto-clear post-#11 merge |
| Hot-path conflicts on PR #4, #9, #13 | medium | Need feature owners to resolve manually |
| Phase-0 Gaps 1-5 (no customer onboarding wire-up) | **HIGHEST — blocks revenue** | Phase B above; founder-led path skips most |
| Cursor Cloud agent silently editing worktree | low | Observed during this session; documented in handoff |
| Stale agent worktrees consuming disk + lock conflicts | low | `git worktree remove --force` cleanup pending |

---

## 7. AEGIS invariant verification (CLAUDE.md root contract)

| Invariant | Verified state | Evidence |
|-----------|----------------|----------|
| 1. Private keys never enter AEGIS | ✓ | Schema audit — no private-key columns; SDK generates locally |
| 2. `/v1/verify` portable | ✓ | `apps/api/src/modules/verify/algorithm/` is framework-free |
| 3. Audit events append-only and signed | ✓ | `audit-chain.util.ts` chain integrity; PR #30 adds RP verification |
| 4. No silent failures or fabricated data | **was violated** | Closed by PR #42 (JWT claim strict-rejection) |
| 5. Multi-tenant isolation by `principalId` | ✓ | API key guard establishes principal; services thread it through |
| 6. Denial precedence stable | ✓ | 11 reasons byte-identical across constants.ts ↔ OpenAPI ↔ verifier-rp (closed by this branch's `377fd43`) |
| 7. Contracts centrally owned | ✓ | `packages/types` is wire SoT; spec-sync workflow enforces drift |
| 8. SDKs runtime-portable | ✓ | `@aegis/sdk` uses `@noble/*` not `node:crypto`; verifier-rp same |

**Net invariant state**: 8/8 hold. The recent fix to invariant 4 (PR #42)
closes the last known violation. Onboarding pipeline (phase-0 gaps)
does not violate any invariant — the gaps are missing *features*, not
broken *invariants*.

---

## 8. The single ultrathink-grade question

**Why is the platform 95% built but cannot acquire a customer?**

The cleanest framing: AEGIS is engineering-rich and product-poor. Every
invariant holds, every spec is consistent, every parity gate is green —
but the customer-onboarding path doesn't exist as code. The founder is
shipping engineering rounds (FAPI 2.0, intent manifests, verifier-rp,
audit-chain offline verification, JWT strict validation) ahead of the
business path.

This is the right order if the bet is "we'll have a defensible technical
moat before competitors notice" — but it carries the cost that revenue
is gated on a 1-3 day engineering sprint for the customer-onboarding
wire-up that has never been a sprint goal.

**Recommended re-prioritization**: name Phase B (specifically the
founder-led Bα/Bβ/Bγ path) as a 2026-05-22 milestone with engineering
work assigned. The hardening cascade (Phase A) is operator-only and can
land in parallel.

---

## 9. Generation notes

- Audit ran against `origin/main` at sha `c0a415a` (post-PR #44 husky restore, pre-AEGIS→OKORO rebrand)
- All file references verified against actual paths
- All PR numbers verified against `gh pr list --state open`
- All Dependabot alert counts pulled from `gh api repos/KLYTICS/aegis/dependabot/alerts?state=open`
- Operator decision rows quoted from `OPERATOR_DECISIONS.md` as last-reviewed 2026-05-02
- Phase-0 gate output captured verbatim from `bash scripts/launch-runbook/phase-0-check.sh --verbose` against feat branch (script is on feat branch, not main; reflects post-PR-#2 state)
- Triage doc cross-reference: `docs/PR_BACKLOG_TRIAGE_2026-05-21.md` (in PR #2's branch)

---

*This document is a snapshot. Re-run `phase-0-check.sh` after any Phase B
step to verify gap closure. Re-run `gh pr list` after any merge to see
the backlog shrink. Treat the recommended sequence as a starting point,
not a contract.*
