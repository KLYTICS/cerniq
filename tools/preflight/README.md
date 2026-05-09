# `tools/preflight/` — AEGIS ship-readiness orchestrator

> Single executable. **One go/no-go gate** before deploy. Encodes
> `docs/TERMINAL_ORCHESTRATION.md` §5 (FAANG checklist) and round-15's
> quality surfaces into one sequence of checks.

---

## TL;DR

```bash
# fastest: only the checks that don't shell out to vitest
tsx tools/preflight/preflight.ts --fast

# full run (includes cross-package parity vitest)
tsx tools/preflight/preflight.ts

# CI-friendly JSON for downstream scoring
tsx tools/preflight/preflight.ts --json

# pre-prod gate — fail on missing prod env vars
tsx tools/preflight/preflight.ts --prod
```

Exit codes:

| Code | Meaning | Decision |
|---|---|---|
| **0** | all checks pass | ✅ ship |
| **1** | warnings present, no gating failure | ⚠ ship with care |
| **2** | gating failure (tsc, lint, parity, etc.) | ❌ DO NOT SHIP |
| **3** | internal error in the preflight itself | investigate |

---

## What it checks

| # | id | category | fast? | what passes | remediation |
|---|---|---|---|---|---|
| 1 | `stack-signature` | info | ✓ | repo headcount: ts files, specs, modules, prisma models, error catalog entries | n/a |
| 2 | `peer-claims` | info | ✓ | `claude-peers list --repo aegis` snapshot | n/a |
| 3 | `tsc-api` | gating | ✓ | `pnpm -F @aegis/api exec tsc --noEmit` → 0 | fix the type errors it reports |
| 4 | `lint-api` | gating | ✓ | `pnpm -F @aegis/api lint` → 0 warnings | `pnpm -F @aegis/api lint --fix` for auto-fixable |
| 5 | `migration-immutability` | gating | ✓ | no committed Prisma migration was modified | restore from git, add a new migration |
| 6 | `error-catalog-audit` | gating | ✓ | every `throw new <X>Error(` in apps/api is registered in `error-catalog.ts` | register the class in the catalog |
| 7 | `cross-package-parity` | gating | — | all 4 specs in `tests/cross-package/` green | `pnpm vitest run tests/cross-package` |
| 8 | `env-vars` | warning | ✓ | DATABASE_URL, REDIS_URL, all 4 Ed25519 key b64s, 2 Stripe keys present | set the missing keys (gates only with `--prod`) |
| 9 | `operator-decisions` | warning | ✓ | no OPEN rows in OPERATOR_DECISIONS.md (or none on critical path) | resolve OD-003 before live billing |
| 10 | `optional-kms-provider` | warning | ✓ | if `KMS_PROVIDER=aws|gcp|vault`, the matching SDK is installed | `pnpm install` to materialize optionalDependencies |
| 11 | `perf-baseline-freshness` | warning | ✓ | `apps/api/perf-baseline.json` has real numbers and is < 30 days old | `pnpm bench:verify --output apps/api/perf-baseline.json` after `make dev` + seed |
| 12 | `architecture-drift` | warning | ✓ | `audit-retention.service.ts` is on `@Cron`, not the round-15 self-arming `setInterval` | Terminal H — install `@nestjs/schedule`, swap to `@Cron` |
| 13 | `alert-runbook-parity` | gating | ✓ | every `runbook:` annotation in `infra/observability/alerts/*.yml` resolves to a real file under repo or `infra/observability/runbooks/` | fix or remove the broken reference; on-call mid-incident hitting 404 is a P0 |
| 14 | `webhook-cipher-wired` | gating | ✓ | `webhooks.service.ts` imports `WebhookSecretCipher`, calls `.encrypt(secret)`, persists as ciphertext (round-13 AES-256-GCM design) | restore the round-13 cipher; never persist plaintext webhook secrets |
| 15 | `adr-0014-cascade` | warning | ✓ | `DENIAL_REASON_PRECEDENCE` in `packages/types/src/constants.ts` includes `TRIAL_EXHAUSTED` (the ADR-0014 cascade is applied) | add `TRIAL_EXHAUSTED` between `SCOPE_NOT_GRANTED` and `SPEND_LIMIT_EXCEEDED` and cascade to all 5 surfaces (verify.dto.ts, OpenAPI, SECURITY.md, CLAUDE.md inv 6, denial-precedence-enum.spec.ts) |

When a check fails, see [`infra/observability/runbooks/preflight-failure.md`](../../infra/observability/runbooks/preflight-failure.md) for per-check remediation. The 5 round-15+ surfaces have their own runbooks: [key-rotation-failure](../../infra/observability/runbooks/key-rotation-failure.md), [audit-retention-failure](../../infra/observability/runbooks/audit-retention-failure.md), [plan-aware-throttle-storm](../../infra/observability/runbooks/plan-aware-throttle-storm.md), [error-catalog-drift](../../infra/observability/runbooks/error-catalog-drift.md).

---

## Selective execution

```bash
# only the checks I care about
tsx preflight.ts --only=tsc-api,lint-api,error-catalog-audit

# exclude slow checks
tsx preflight.ts --skip=cross-package-parity

# combine — quick local sanity
tsx preflight.ts --fast --skip=peer-claims
```

---

## Output

### Pretty (default, when stdout is a TTY)

```
AEGIS Preflight — 2026-05-05T14:32:07Z
──────────────────────────────────────────────────────────────────────
[ 1/12] ✅ stack signature        190 ts · 50 specs · 18 modules · 14 models · 21 errors
[ 2/12] ✅ active peer claims     2 active (bba1b6c1, c4f241c5)
[ 3/12] ✅ tsc @aegis/api         0 errors                                0.8s
[ 4/12] ✅ lint @aegis/api        0 warnings                              2.1s
[ 5/12] ✅ migration immutability 28 migrations clean                     0.3s
[ 6/12] ✅ error catalog audit    140 files / 76 throws / 0 uncataloged   0.6s
[ 7/12] ✅ cross-package parity   4 files passed                          5.2s
[ 8/12] ⚠  env vars               5/8 set (3 missing — flagged for prod)  0.0s
[ 9/12] ⚠  operator decisions     16 OPEN (1 on critical path: OD-003)    0.0s
[10/12] ⏭  optional KMS provider  KMS_PROVIDER unset                      0.0s
[11/12] ⚠  perf baseline          targets only — no real measurements     0.0s
[12/12] ⚠  architecture drift     audit-retention uses setInterval — Terminal H owes swap
──────────────────────────────────────────────────────────────────────
SHIP WITH CARE (warnings)
Result: 6 pass · 4 warn · 0 fail · 1 skip
Total:  9.7s · exit 1
```

### JSON (machine-readable, for CI)

```json
{
  "version": "1",
  "timestamp": "2026-05-05T14:32:07.412Z",
  "exitCode": 1,
  "result": "warn",
  "totalMs": 9712,
  "summary": { "pass": 6, "warn": 4, "fail": 0, "skip": 1, "total": 12 },
  "checks": [
    {
      "id": "tsc-api",
      "label": "tsc @aegis/api",
      "category": "gating",
      "status": "pass",
      "elapsedMs": 812,
      "details": "0 errors"
    },
    ...
  ]
}
```

---

## When to run

| Trigger | Command |
|---|---|
| Pre-commit | `tsx tools/preflight/preflight.ts --fast` |
| Pre-PR | `tsx tools/preflight/preflight.ts` |
| Pre-deploy (staging) | `tsx tools/preflight/preflight.ts --prod` |
| Pre-deploy (production) | `tsx tools/preflight/preflight.ts --prod` and `exitCode === 0` |
| CI on every push | `pnpm preflight --json | tee preflight.json` then check exitCode |

Wire as a make target (top-level `Makefile`):

```makefile
preflight:  ## run ship-readiness gate
	@tsx tools/preflight/preflight.ts $(ARGS)
```

Then: `make preflight ARGS="--fast"` or `make preflight ARGS="--prod"`.

---

## How to extend

1. Open `preflight.ts` and add an entry to the `CHECKS` array:
   ```ts
   {
     id: 'my-new-check',
     label: 'human-readable label',
     category: 'gating' | 'warning' | 'info',
     fastSafe: true,  // false if it shells out to vitest/jest
     run(ctx): CheckResult {
       // ... your check ...
       return { status: 'pass' | 'warn' | 'fail' | 'skip', details: '...', remediation: '...' };
     },
   }
   ```
2. Update the table in this README.
3. Optionally: add the new id to a `--skip` allowlist in CI if it's noisy on first land.

Categories:
- **`gating`** — exit 2 on fail. These BLOCK the ship.
- **`warning`** — exit 1 on fail/warn. Safe to override if you know what you're doing.
- **`info`** — never affects exit code. Pure observation.

---

## Why this exists

AEGIS has 15+ individual quality scripts: `tsc`, `lint`, `audit:errors`,
`benchmark-verify`, `db-index-audit`, `check:migrations`,
`check:openapi-zod`, `check:openapi-prisma`, vitest in
`tests/cross-package`, etc. Operators need **one command** that says
"ship or don't ship." Otherwise the answer drifts to "well, we ran tsc
and the unit tests, but did anyone re-check the catalog audit? what
about migration immutability?" — and the gate becomes culture-dependent
instead of code-enforced.

This is the pattern every shipping shop has. Stripe calls it `prod gate`.
GitHub calls it `branch protection checks`. Vercel calls it `predeploy`.
At AEGIS scale, it's `tools/preflight/preflight.ts`.

---

## Companion docs

- `docs/TERMINAL_ORCHESTRATION.md` — what to claim, what to ship, in what order.
- `docs/AEGIS_MASTER_STATE_2026_05.md` PART VII — terminal handoff guide.
- `docs/SPRINT_PROTOCOL.md` §6 — the FAANG quality bar this preflight encodes.
- `docs/PRODUCTION_CHECKLIST.md` — the broader pre-launch list (this preflight is the executable subset).
