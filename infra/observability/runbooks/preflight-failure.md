# Runbook — preflight gate failure

## Alert

- **Source**: `make preflight` / `make preflight-fast` / `make preflight-prod` reports `exit 2` (gating fail) or `exit 1` (warning).
- **Tool**: `tools/preflight/preflight.ts`
- **Index**: see `tools/preflight/README.md` for the full check list.

## Symptom

CI gate or local pre-deploy check returned non-zero. Specific check IDs in the failed lines tell you what to open below.

## Impact

| Exit | Meaning                             | Decision                                                                 |
| ---- | ----------------------------------- | ------------------------------------------------------------------------ |
| 0    | all checks pass                     | ship                                                                     |
| 1    | warnings present, no gating failure | ship with care; address warnings before next deploy                      |
| 2    | gating failure                      | **DO NOT SHIP** — a gating check protects an invariant or public surface |
| 3    | preflight tool itself errored       | open this runbook's "Preflight internal error" section                   |

A gating fail (exit 2) means at least one of: tsc errors, lint errors, error-catalog drift, migration immutability violation, or cross-package parity drift. Each of these is a CLAUDE.md invariant or quality gate the operator agreed to enforce.

## Diagnose

The orchestrator prints one line per check. The `❌` lines are the gating failures; `⚠` are warnings. Each fail line includes a `fix:` remediation hint. If the hint isn't enough, jump to the per-check section below.

```bash
make preflight-fast
# or, more granular:
pnpm -F @cerniq/api exec tsx tools/preflight/preflight.ts --json | jq '.checks[] | select(.status=="fail" or .status=="warn")'
```

## Per-check remediation

### `tsc-api` ❌

**Means**: `pnpm -F @cerniq/api exec tsc --noEmit` returned non-zero.
**Common causes**:

- A peer added a dependency to `apps/api/package.json` without running `pnpm install`. Fix: `pnpm install` then re-run preflight.
- An optional dependency type package isn't materializing (e.g., `Cannot find type definition file for 'cron'` — peer just added `@nestjs/schedule` but `@types/cron` not installed). Fix: `pnpm install` again, or add `"types": ["node"]` to `apps/api/tsconfig.json` `compilerOptions` to opt out of implicit type roots.
- Real type error in your branch. Fix: `pnpm -F @cerniq/api exec tsc --noEmit` and read the report.

### `lint-api` ⚠ or ❌

**Warn**: ESLint config can't load a plugin (env issue, not lint). Fix: `pnpm install` to materialize the missing plugin (commonly `eslint-plugin-security`).
**Fail**: real ESLint errors or warnings beyond `--max-warnings=0`. Fix: `pnpm -F @cerniq/api lint --fix` for auto-fixable, hand-fix the rest. Never bump `--max-warnings` to silence it.

### `migration-immutability` ❌

**Means**: a Prisma migration that's already been applied to staging/prod has been modified locally.
**Why this matters**: applied migrations are part of the chain — modifying one in place causes silent schema drift between environments. The script that catches this lives at `scripts/check-migration-immutability.ts`.
**Fix**: restore the migration files from git (`git restore apps/api/prisma/migrations/<dir>/`), then add a NEW migration for your change (`pnpm -F @cerniq/api exec prisma migrate dev --name <new_change>`).

### `error-catalog-audit` ❌

**Means**: a `throw new <X>Error(` somewhere in `apps/api/src` references a class not registered in `apps/api/src/common/errors/error-catalog.ts`.
**Why this matters**: the SDK derives retry semantics from the catalog. An uncataloged error reaches the wire as `internal_error` (the redacted fallback), losing retry hints and breaking SDK retry logic.
**Fix**: open `apps/api/src/common/errors/error-catalog.ts`, add an entry for the class with `code`, `httpStatus`, `retryable`, `backoff`, `customerMessage` (no internals), `category`. Then `pnpm -F @cerniq/scripts audit:errors` to confirm. See the related runbook: [`error-catalog-drift.md`](./error-catalog-drift.md).

### `cross-package-parity` ❌

**Means**: at least one of the 4 specs in `tests/cross-package/` failed:

- `denial-precedence-enum.spec.ts` — `DENIAL_REASON_PRECEDENCE` (canonical) drifted from API engine, OpenAPI spec, or verifier-rp.
- `error-catalog-parity.spec.ts` — server catalog drifted from TS-generated or Python-generated mirror.
- `audit-chain-parity.spec.ts` — audit signer/verifier algorithms drifted.
- `sdk-api-jwt-parity.spec.ts` — SDK JWT issuance shape drifted from API expectation.

**Fix**: `pnpm vitest run tests/cross-package` to see which spec failed. Each spec's failure message points at the diverged surface. Don't "fix" by mutating the spec — fix the drift in the offending source file.

### `env-vars` ⚠ (or ❌ with `--prod`)

**Means**: one or more required prod env vars are missing.
**Required set**: `DATABASE_URL`, `REDIS_URL`, `AUDIT_ED25519_PRIVATE_KEY_B64`, `AUDIT_ED25519_PUBLIC_KEY_B64`, `JWT_ED25519_PRIVATE_KEY_B64`, `JWT_ED25519_PUBLIC_KEY_B64`, `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`.
**Fix**: pull from Railway `railway variables list -s cerniq-api` and confirm each is set. For local: `cp .env.example .env` and fill in. For CI: add as repo secrets.

### `operator-decisions` ⚠

**Means**: at least one row in `OPERATOR_DECISIONS.md` is `OPEN`.
**Critical-path detection**: the check specifically flags OD-003 (pricing) — DECIDED 2026-05-05 via ADR-0014, so this should now report "OD-003 DECIDED — critical path clear". If it doesn't, OPERATOR_DECISIONS.md needs syncing.
**Fix**: review the OPEN rows; for each, either decide (move to § 3 with resolution + ADR link) or extend the due date. The defaults ship if silent past the due date.

### `optional-kms-provider` ⚠

**Means**: `KMS_PROVIDER` env is set to `aws|gcp|vault` but the corresponding SDK isn't in `node_modules`.
**Why**: KMS SDKs live in `optionalDependencies` so dev environments don't have to install all four. Production picks one.
**Fix**: `pnpm install` to materialize. If still missing after install, the SDK has no prebuilt binary for your platform — see the SDK's own install docs.

### `perf-baseline-freshness` ⚠

**Means**: `apps/api/perf-baseline.json` has only SLO targets (no real measurements) OR is more than 30 days old.
**Why**: regressions are invisible without a baseline.
**Fix**: spin up the dev stack (`make dev` + `pnpm -F @cerniq/scripts seed:demo`), then `pnpm bench:verify --output apps/api/perf-baseline.json`. Re-run after any change to `verify.algorithm.ts` or its dependencies.

### `architecture-drift` ⚠

**Means**: `apps/api/src/modules/compliance/audit-retention.service.ts` still uses `setInterval` instead of the framework `@Cron` decorator.
**Why**: round 15 shipped retention with self-arming `setInterval` as an interim because `@nestjs/schedule` wasn't yet wired. Once Terminal H lands `@nestjs/schedule`, the swap is mechanical and the framework cron is the right long-term shape (introspectable, lifecycle-managed).
**Fix**: see Terminal H in `docs/TERMINAL_ORCHESTRATION.md`. After swap, remove `setInterval` and `unref()` calls; the warning clears automatically.

### `peer-claims` ℹ

**Means**: informational — count of active claims via `claude-peers status`.
**Action**: none unless the count surprises you. Multiple peers claiming overlapping paths is the kind of signal that warrants a `peers msg` before you commit.

### `stack-signature` ℹ

**Means**: informational — current ts/spec/module/model/error counts.
**Action**: none. Useful as a snapshot for handoff entries.

## Preflight internal error (exit 3)

**Means**: the preflight tool itself crashed (not a check failure).
**Common causes**:

- `tsx` not installed in the workspace ESM context the tool was launched from. Fix: launch via `make preflight-fast` (uses `pnpm -F @cerniq/api exec tsx`) or absolute path.
- Path resolution issue when `pnpm -F @cerniq/api exec tsx tools/preflight/preflight.ts` is run from `apps/api/` cwd (relative path resolves wrong). Fix: pass the absolute path `$(CURDIR)/tools/preflight/preflight.ts`. The Makefile target already does this.
- The `claude-peers` binary isn't on `$HOME/.claude/peers/bin/`. The `peer-claims` check soft-skips in this case; only fails if invocation throws.

## Mitigate

- **For exit 2 in CI**: block the merge. Fix the failing check on the same branch; re-run.
- **For exit 1 in CI**: allow merge with reviewer ack ("acknowledged warnings: …") in the PR description. Track each warning to closure within the next sprint.
- **For exit 3**: file an issue against `tools/preflight/`. Re-run with `--json` to capture structured output.

## Eradicate

The preflight tool is the gate, not the fix. Eradication is per-check (see sections above). After fixing, re-run `make preflight` to confirm green.

## Verify recovery

```bash
make preflight-fast
echo $?   # 0 = pass, 1 = warn (shippable), 2 = fail (do not ship)
```

For full confidence (includes vitest cross-package parity):

```bash
make preflight
```

## Escalate

- **Persistent gating fail across multiple sessions**: the underlying invariant change may need an ADR. See `docs/SPRINT_PROTOCOL.md` § 6.3 (Architecture Change Protocol).
- **Preflight false positive**: file PR against `tools/preflight/preflight.ts`. False positives degrade trust in the gate — fix fast.
- **`${ESCALATION_CONTACT}`** if a check is wrong about a security-critical surface (denial precedence, audit chain, multi-tenant isolation).

## Postmortem trigger

**No** for one-off gating fails caught and fixed pre-merge. **Yes** if a gating fail reaches production (the gate didn't fire, or someone bypassed it) — that's a quality-bar incident.

## See also

- `tools/preflight/README.md` — what each check does, how to extend.
- `docs/TERMINAL_ORCHESTRATION.md` § 5 — the FAANG quality-bar checklist this preflight encodes.
- `docs/SPRINT_PROTOCOL.md` § 6.1 — the per-PR CI gates (preflight is the executable subset).
