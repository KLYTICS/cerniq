# AEGIS Tests - Claude contract

This directory owns black-box, parity, cross-package, load, and chaos coverage.
Tests are product infrastructure: they protect the public contract, denial
precedence, billing behavior, audit verifiability, and first-customer journey.

## Test standards

- Prefer regression tests that encode business/security invariants over snapshot
  churn.
- Parity tests should fail loudly when API, SDK, dashboard, OpenAPI, generated
  catalogs, or docs drift.
- Latest parity coverage includes denial precedence, denial-reason generation,
  error catalog parity, dashboard safe redirects, dashboard pricing, preflight,
  and audit-chain surfaces. Extend these rather than creating one-off drift
  checks.
- E2E tests may soft-skip when live service secrets are missing, but structural
  validation should still run where possible.
- Use deterministic data. Avoid sleeps unless testing time behavior; prefer
  polling with timeouts.
- Tests must not require real paid provider calls unless explicitly marked and
  gated by env variables.
- Keep failure messages actionable enough for CI triage.

## Where tests belong

| Need                          | Location                                     |
| ----------------------------- | -------------------------------------------- |
| API service/unit behavior     | `apps/api/src/**/*.spec.ts`                  |
| Cross-package contract parity | `tests/cross-package/*.spec.ts`              |
| Live API journey              | `tests/e2e/*.test.ts`                        |
| Load behavior                 | `tests/load/`                                |
| Chaos/failure behavior        | `tests/chaos/`                               |
| Package-local behavior        | package-local `src/**/*.spec.ts` or `tests/` |

## Required verification

- Cross-package parity: `pnpm test:parity`
- E2E harness typecheck: `pnpm --filter @aegis/e2e typecheck`
- E2E tests: `pnpm test:e2e`
- Root unit sweep: `pnpm test`

When adding or changing a test, verify that the test can fail for the intended
reason before relying on it as evidence.
