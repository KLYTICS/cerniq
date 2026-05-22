---
title: Cross-Cutting FAANG Review — 2026-05-05
reviewer: okoro:cross-cutting-review (sid auditor, peer-claim)
scope: Read-only audit across active peer write zones (round-17 trial-exhausted, terminal-orchestration, local-bringup-validation)
posture: typecheck green (0 errors), 1 jest suite RED, 12 review findings
---

# Round-17 Cross-Cutting Review

**Verdict: ship-blocked on F-01 only.** All other findings are P1/P2 — do not gate the round but should land in round-18 sweeps.

## Green-light verification

| Gate | Result |
|---|---|
| `pnpm tsc --noEmit` (apps/api) | ✅ exit 0, 0 errors |
| `jest --testPathPattern="(trial\|plans\|error-catalog\|audit-chain\|jwt\|dpop)"` | ❌ 46/47 pass — `plans.spec.ts` RED (F-01) |
| CLAUDE.md invariant #2 (verify hot path portability) | ✅ `verify.algorithm.ts` imports only `verify.ports`, no Nest/Prisma/ioredis. TrialService is called from `verify.service.ts` (Nest adapter), correct. |

---

## P0 findings (ship-block)

### F-01 — `plans.spec.ts` RED after ADR-0014 cap bump
**File:** `apps/api/src/modules/billing/plans.spec.ts:10`
**Owner:** peer `c4f241c5` (round-17-trial-exhausted)
**What:** Round-17 changed `FREE.monthlyVerifyQuota` `1_000 → 10_000` per ADR-0014. The spec still asserts the 1K boundary:
```
expect(isVerifyCallAllowed(plan, 999)).toEqual({ allowed: true, remaining: 1 });
expect(isVerifyCallAllowed(plan, 1_000)).toEqual({ allowed: false, remaining: 0, ... });
```
Actual receives `remaining: 9001` at n=999.
**Fix:** Update boundary asserts to `9_999 → remaining: 1` and `10_000 → denied`. Also add an explicit assertion that `FREE.monthlyVerifyQuota === 10_000` so future ADR drift fails this spec immediately rather than at the boundary.
**Also:** the `Object.keys(PLANS)` test (line 5) still expects `['DEVELOPER', 'ENTERPRISE', 'FREE', 'GROWTH']` — when round-18 lands the SCALE enum migration, this assertion bricks every other test in the file. Recommend converting to `expect(Object.keys(PLANS)).toEqual(expect.arrayContaining([...]))` now to defang.

---

## P1 findings (round-18 sweep)

### F-02 — `trial.service.ts` reset() leaves Redis stale on DEL failure
**File:** `apps/api/src/modules/billing/trial.service.ts:222-235`
**Severity:** P1 — silent payment-blocker for paying customers.
**What:** `reset()` is called on Stripe webhook upgrade. If Redis `DEL` raises, the warning is logged and the DB UPDATE proceeds. Result: `Principal.trialExhaustedAt = null` and `trialUsedCount = 0` in Postgres, but Redis still holds the stale lifetime count (e.g. 10_001). Next `checkAndIncrement` call:
1. DB short-circuit (line 92) skips because `trialExhaustedAt` is null,
2. Redis INCR returns `10_002`,
3. `> TRIAL_LIFETIME_CAP` → deny `TRIAL_EXHAUSTED`,
4. Customer who just paid $49 gets HTTP 402.
**Fix:** Use `redis.set(key, '0')` instead of `del` (idempotent reset to known state). Or fail-closed: if Redis DEL throws, throw — better to surface the upgrade failure to the webhook handler than to ship a corrupted state. Stripe will retry the webhook.
**Test gap:** add a spec that injects a Redis client whose `del` rejects, asserts subsequent `checkAndIncrement` returns `exhausted: false`.

### F-03 — `plans.ts` overage field name vs unit mismatch
**File:** `apps/api/src/modules/billing/plans.ts:51, 103-104, 122-123`
**Severity:** P1 — billing correctness landmine.
**What:** Field is `overagePerCallCents: 8` but the comment clarifies the unit is *ten-thousandths of a dollar* ($0.0008), not cents. Anything that reads the field by name (Stripe metering, dashboard display, internal billing reports) and trusts the suffix will be off by 100×.
**Fix:** Either (a) rename to `overagePerCallMicroDollars` (or `_E4`) and update callers, or (b) keep the name but change the value to a `number` representing actual cents and accept the precision loss for now ($0.0008 → 0.08 cents). Option (a) is operator's quality bar.
**Verify:** grep `overagePerCallCents` across the workspace — `apps/api/src/modules/billing/stripe.service.ts` and any dashboard pricing surface need audit.

### F-04 — `trial.service.ts` `getStatus()` magic-value sentinel for not-found
**File:** `apps/api/src/modules/billing/trial.service.ts:165-177`
**Severity:** P1 — silent failure mode (CLAUDE.md invariant #4).
**What:** Principal-not-found returns `{planTier: 'FREE', used: -1, cap: -1, ...}`. Caller cannot distinguish "not found" from "FREE on a fresh account where Redis is down and DB has -1 default". Memory `feedback_apex_quality_bar` #5 says no fabricated data.
**Fix:** Change return type to `Promise<TrialStatus | null>` and return `null` when principal is missing. Force callers to handle the not-found case explicitly.

### F-05 — error-catalog `customerMessage` uses smart quote
**File:** `apps/api/src/common/errors/error-catalog.ts:190`
**Severity:** P1 — encoding bug at customer surface.
**What:** `'Action not in agent's allowed scopes.'` uses U+2019 RIGHT SINGLE QUOTATION MARK. Non-ASCII in error envelopes can break log shippers, certain SDK display layers (especially CLI tools without UTF-8 stdout), and CSV exports. All other entries use ASCII.
**Fix:** Replace with ASCII apostrophe.

### F-06 — error-catalog lookup is bundler-fragile
**File:** `apps/api/src/common/errors/error-catalog.ts:247-251`
**Severity:** P1 — silent regression risk in SDK builds.
**What:** `error.constructor.name` becomes `"a"` after a default minifier pass. `apps/api` doesn't minify so this works in prod today, but `packages/sdk-ts` (tsup) may. SDK consumers that try to map server errors via the same catalog (planned per docs) will get `internal_error` for everything if minification kicks in.
**Fix:** Add a `static readonly errorCode = 'auth_required'` discriminator on each OkoroError subclass and look up by that. Or, ship a Jest test that asserts `new AuthenticationError().constructor.name === 'AuthenticationError'` so the build pipeline catches name mangling.

---

## P2 findings (note + move on)

### F-07 — `trial.service.ts:102` `void planTier` is dead code
Comment says "keep ref so future logging can disambiguate" — that's not load-bearing today and will trip eslint `no-unused-expressions`. Either remove or actually log it.

### F-08 — Double-gate on FREE: PLAN_LIMIT_EXCEEDED vs TRIAL_EXHAUSTED
**File:** `plans.ts:84-86` (author flagged comment).
With `monthlyVerifyQuota: 10_000` AND `TRIAL_LIFETIME_CAP: 10_000`, both `UsageGuardService` (PLAN_LIMIT_EXCEEDED) and `TrialService` (TRIAL_EXHAUSTED) fire at the same boundary. Denial precedence (CLAUDE.md invariant #6) puts PLAN_LIMIT_EXCEEDED *before* the chain — so for FREE-tier customers, they will ALWAYS see `PLAN_LIMIT_EXCEEDED` (HTTP 402) and never `TRIAL_EXHAUSTED`. The customer-facing message "Plan monthly verify quota exceeded" is misleading for a lifetime cap. Round-18 should set `FREE.monthlyVerifyQuota: Number.POSITIVE_INFINITY` and let `TrialService` own the gate, OR move the precedence so TrialService runs before UsageGuard for FREE tier specifically.

### F-09 — TRIAL_EXHAUSTED reason `REDIS_UNAVAILABLE` leaks infra detail
`trial.service.ts:100, 114` returns `reason: 'REDIS_UNAVAILABLE'` from a fail-closed path. The error-catalog renders the customer message correctly (`trial_exhausted` / "Free trial verify cap reached..."), but the `reason` field is on the `TrialCheckResult` — confirm it does NOT cross the API boundary into the verify response. If it does, customer learns we use Redis, which is an implementation-detail leak.

### F-10 — `TERMINAL_ORCHESTRATION.md:54` row I unresolved path
"file path needs verification" is shipped in a doc claimed as source-of-truth. Either run the verification and update, or flag explicitly as `STATUS: investigate`. Currently a TODO masquerading as guidance.

### F-11 — Migration ordering risk for `trial_counter`
`apps/api/prisma/migrations/20260505000300_add_trial_counter/migration.sql` is new (untracked listing). Confirm it's strictly additive (`ADD COLUMN ... DEFAULT 0 NOT NULL`) and won't lock the principal table — read by FK from many tables in a 135-prod-table system. Operator's pattern (per memory `forge_cross_bible_rules`) requires backfill + immutability check.

### F-12 — Spec quoting: `plans.spec.ts:5` is brittle to enum growth
Already covered as a sub-point of F-01 but worth its own ID for tracking.

---

## Cross-peer coordination notes

| Peer | What I observed | Recommended action |
|---|---|---|
| `c4f241c5` (round-17-trial-exhausted) | Code is FAANG-quality reasoning + comments. F-01, F-02, F-03 land in your scope. | Fix F-01 before `pnpm check`; F-02 + F-03 add to your round-17 deliverable since they're in the files you already own. |
| `cb622ccf` (terminal-orchestration) | Doc is best-in-class. F-10 is yours. F-08 surfaces a doc-level inconsistency between ADR-0014 and the actually-running denial chain — you may want to add a note to §3 or §8. | Run the §3 row I path verification; add an OPERATOR-INPUT or CLAUDE.md-update line for F-08's double-gate. |
| `bba1b6c1` (local-bringup-validation) | Read-only on `apps/api/src` per claim — out of scope for this review. F-01 will fail your e2e if `pnpm check` is in your bringup gate. | Re-run jest after `c4f241c5` lands the F-01 fix. |

## What I did NOT review (out of time / scope)

- The 3,400-line schema.prisma diff (28 migrations, 16K+ insertions) — recommend a dedicated schema-only review.
- The Cedar/OPA wasm evaluators (new files) — would need a security-focused pass.
- The webhook secret cipher (new) — F flagged in TERMINAL_ORCHESTRATION.md as separate P0.
- Cross-package vitest (`pnpm check`) — only ran apps/api jest.

## Re-run commands

```bash
cd ~/Desktop/OKORO/apps/api
pnpm jest plans.spec.ts                                 # F-01 verifier
pnpm jest --testPathPattern="(trial|plans|error-catalog|audit-chain|jwt|dpop)"
cd ~/Desktop/OKORO
make preflight                                          # full ship gate
```

---

## Addendum — wiring verification pass (2026-05-05, post-initial-review)

After the 12 findings landed I ran a full wiring verification on the round-17 surface. **The wiring is enterprise-grade**; two findings need severity correction.

### What I verified is correctly wired ✅

| Wire | Where | Status |
|---|---|---|
| `TrialService` → `BillingModule` providers + exports | `apps/api/src/modules/billing/billing.module.ts:26-27` | ✅ both |
| `TrialService` → `verify.service.ts` injection + call | `verify.service.ts:125` (G-2b gate) | ✅ correct precedence — fires AFTER G-2 PlanLimit and BEFORE algorithm |
| `Principal.trialUsedCount` + `trialExhaustedAt` columns | `schema.prisma:70-71` + migration `20260505000300_add_trial_counter` | ✅ strictly additive (`NOT NULL DEFAULT 0` + nullable timestamp), partial index on non-null `trialExhaustedAt` |
| `TRIAL_EXHAUSTED` enum value | `verify.ports.ts:20`, `verify.dto.ts:73`, `packages/types/constants.ts:76` | ✅ all three boundaries in sync |
| Algorithm purity (CLAUDE.md invariant #2) | `verify.algorithm.ts` imports only `verify.ports` types | ✅ zero NestJS/Prisma/ioredis — CF Workers safe |
| Generated cross-package error catalog | `packages/types/src/error-catalog.generated.ts:185-187` includes `trial_exhausted` | ✅ SDK can lookup by stable `code` string |
| Verify suite green | `jest --testPathPattern="verify"` → 53/53 pass | ✅ G-2b path covered in `verify.service.spec.ts` |

### Severity corrections to original findings

**F-08 (P1 → P2): Denial precedence is correct; product-message is the bug.**
The G-2 → G-2b ordering is *intentional and correct*:
- Heavy single-month evaluator hits 10K verifies in week 1 → `PLAN_LIMIT_EXCEEDED` fires (monthly quota = 10K). Resets next calendar month, customer keeps using free tier.
- Slow-burn evaluator (5K/mo × 2 months) clears G-2 in month 2 → G-2b `TRIAL_EXHAUSTED` fires correctly at lifetime cap.
The actual bug: a heavy evaluator gets the customer message `"Plan monthly verify quota exceeded. Upgrade or wait for the next period."` — the *"or wait"* clause is **wrong** for someone who has 0 lifetime budget remaining; they cannot wait, they must upgrade. **Recommended fix:** in `verify.service.ts` G-2 gate, when `planTier === 'FREE'` and `trialUsedCount + monthlyUsage >= TRIAL_LIFETIME_CAP`, surface `TRIAL_EXHAUSTED` instead of `PLAN_LIMIT_EXCEEDED`. Single conditional, no precedence change, customer gets accurate upgrade prompt.

**F-06 (P1 → P2): Bundler-fragility scope is narrower than written.**
SDK consumers use `packages/types/src/error-catalog.generated.ts` which keys by stable `code` string, not class name. The `error.constructor.name` lookup in `apps/api/src/common/errors/error-catalog.ts:249` is only consumed by the global exception filter inside the Nest API, which doesn't minify. The recommendation (add `static readonly errorCode`) still hardens the surface against a future minification change but it's not a present-day silent bug. Severity is P2 (defense-in-depth), not P1.

### Re-scored summary

| Severity | Findings |
|---|---|
| P0 (ship-block) | F-01 |
| P1 (round-18) | F-02, F-03, F-04, F-05 |
| P2 (defense-in-depth / polish) | F-06, F-07, F-08, F-09, F-10, F-11, F-12 |

The round-17 mechanical work is **structurally enterprise-grade** — module wiring, schema additivity, precedence ordering, framework purity, cross-package enum sync, and test coverage are all clean. F-01 is the only thing standing between the working tree and a green ship gate.

---

*Generated 2026-05-05 by cross-cutting reviewer peer claim. No source files modified. Addendum added after wiring verification pass.*

---

## Addendum 2 — preflight gate audit (2026-05-06)

Ran `make preflight-fast`: 8 pass · 5 warn · 0 fail · 1 skip. Hard gates green; warnings reveal one new finding.

### F-13 (P1) — `eslint-plugin-security` referenced but not installed
**File:** `eslint.config.mjs:5,33,47-51`
**Severity:** P1 — security lint rules silently disabled.
**What:** `eslint.config.mjs` imports `eslint-plugin-security` and registers 5 rules (`detect-eval-with-expression: error`, `detect-pseudoRandomBytes: error`, `detect-unsafe-regex: error`, `detect-non-literal-regexp: warn`, `detect-object-injection: off`). The plugin is **not declared** in any `package.json` (root, apps/api, or packages/eslint-config) and is **not installed** in any `node_modules`. Result: every `eslint` invocation crashes with `ERR_MODULE_NOT_FOUND` before any rule runs. CI may treat the crash as a warning (preflight does) and ship anyway.
**Evidence:** `pnpm eslint src --quiet` from `apps/api/` fails immediately. Preflight reports it as a warning ([4/14] line) — masking that **zero security lint rules currently run**.
**Fix:** `pnpm add -D -w eslint-plugin-security` (root devDependency since the config is at root). After install, lint will run all 4 active rules. Likely surfaces real findings — recommend triaging output as a follow-up before merging the install.
**Why this matters:** the operator's quality bar (CLAUDE.md "Crypto code requires a paired .spec.ts; no Math.random in production paths") relies on these lint rules to *enforce* the bar in CI. Right now CI cannot enforce it; reviewers can.

### Other preflight warnings (informational, not findings)

| Warning | Status | Action owner |
|---|---|---|
| 12 env vars unset | expected in dev — gates `make preflight-prod` | operator (Stripe price IDs per ADR-0014) |
| 14 OD open (OD-003 closed) | tracked in `OPERATOR_DECISIONS.md` | operator |
| Perf baseline = targets only | needs real measurements | future round |
| Architecture drift: `setInterval` in audit-retention | TERMINAL_ORCHESTRATION.md row H | next session |
| KMS_PROVIDER unset (skip) | dev expected; preflight-prod will gate | operator + Terminal G |

### Things preflight verified ✅ (counter-balancing the warnings)

- `tsc @okoro/api`: 0 errors
- error catalog audit: all `throw` sites cataloged
- migration immutability: 4 migrations clean
- ADR-0014 cascade: 11 denial reasons (TRIAL_EXHAUSTED present at correct precedence)
- webhook secret-at-rest: AES-256-GCM cipher wired
- alert ↔ runbook parity: 32 refs all resolve
- multi-tenant + outbox + cedar + audit-signer + pq + webhook-cipher specs: 88/88 pass

### Final tally

| Severity | Findings | Owners |
|---|---|---|
| P0 (ship-block) | F-01 | c4f241c5 (acknowledged round-19 phase-1) |
| P1 (round-18+) | F-02, F-03, F-04, F-05, **F-13** | c4f241c5 (F-02/04/05 ack'd) · operator (F-13) · billing peer (F-03) |
| P2 (defense-in-depth) | F-06, F-07, F-08, F-09, F-10, F-11, F-12 | mixed |

Round-17 mechanical work is structurally enterprise-grade. F-13 is the highest-leverage open item *not* already claimed by a peer — fixing it unmasks security lint that the CI gate currently hides.

---

*Addendum 2 generated 2026-05-06 after preflight gate run.*
