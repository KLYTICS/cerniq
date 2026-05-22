# `@okoro/e2e` — black-box integration tests

Full-stack tests that drive the live OKORO API over HTTP. Built to:

1. catch regressions in the public contract (API spec, denial precedence,
   audit chain, spend math),
2. expose race conditions (the TOCTOU spend test fires 50 concurrent
   verifies under a $100 cap),
3. be runnable in two modes — green-locally and skip-cleanly-in-CI.

This package is intentionally separated from `apps/api/test/` (Jest, white
box) — these tests must work against any conforming OKORO deployment, not
just the in-tree NestJS one.

## 30-second quickstart

```bash
# terminal A — bring the platform up
cd /path/to/okoro
pnpm install
pnpm db:up && pnpm dev

# terminal B — seed a dev key, then run the suite
pnpm tsx scripts/seed-dev.ts                  # emits OKORO_E2E_API_KEY=...
export OKORO_E2E_URL=http://localhost:3000
export OKORO_E2E_API_KEY=okoro_sk_...

# Option A — workspace mode (after adding `tests` to pnpm-workspace.yaml):
pnpm --filter @okoro/e2e test

# Option B — direct invocation, no workspace edit needed:
cd tests && pnpm install && pnpm exec vitest run
```

The harness was scaffolded to run either way. The default ops runbook
prefers Option A; CI configs can use either. To enable Option A, append
`- "tests"` to `pnpm-workspace.yaml`.

If the API is not running, you'll see a banner and the run will exit 0 —
this is by design, so CI doesn't go red on a missing dependency.

## Files

```
tests/
├── e2e/
│   ├── setup.ts                          vitest globalSetup — preflight + skip
│   ├── _support/
│   │   ├── client.ts                     SDK + raw-fetch wrappers
│   │   ├── fixtures.ts                   createAgent / createPolicy / signTokenFor
│   │   ├── assert.ts                     domain assertion helpers
│   │   └── retry.ts                      pollUntil for eventual consistency
│   ├── 01_health.test.ts                 health, ready, /metrics
│   ├── 02_principal.test.ts              api key acceptance + invalid-key 401
│   ├── 03_agent.test.ts                  register, get, status, isolation
│   ├── 04_policy.test.ts                 create / list / revoke / expiry
│   ├── 05_token_sign.test.ts             SDK signer claim shape
│   ├── 06_verify_happy.test.ts           valid-path verify
│   ├── 07_verify_denials.test.ts         all 9 denial reasons in precedence order
│   ├── 08_replay_protection.test.ts      same jti twice
│   ├── 09_spend_race.test.ts             50 concurrent verifies, sum <= cap
│   ├── 10_audit_chain.test.ts            event signatures + prev-hash
│   ├── 11_webhook_delivery.test.ts       subscribe + HMAC verify
│   ├── 12_jwks.test.ts                   /.well-known/audit-signing-key
│   ├── 13_revocation_propagation.test.ts revoke → status flip + denial
│   ├── 14_rate_limit.test.ts             429 + Retry-After
│   ├── 15_idempotency.test.ts            same Idempotency-Key → same response
│   └── property/
│       └── denial_precedence.property.spec.ts   fast-check property test
├── load/
│   ├── verify.js                         k6 — 50 RPS for 60 s, p99 < 500 ms
│   └── README.md                         budget thresholds + run commands
└── chaos/
    └── README.md                         toxiproxy drills (manual)
```

## Environment variables

| var                       | required | default                    | use                                              |
|---------------------------|----------|----------------------------|--------------------------------------------------|
| `OKORO_E2E_URL`           | no       | `http://localhost:3000`    | base url of the API                              |
| `OKORO_E2E_API_KEY`       | yes      | —                          | management key (`okoro_sk_…`); enables ops       |
| `OKORO_E2E_VERIFY_KEY`    | no       | falls back to api key      | dedicated verify-only key (`okoro_vk_…`)         |
| `OKORO_E2E_API_KEY_2`     | no       | —                          | second principal's key (cross-tenant tests)      |

## Skipped tests + soft-skips

Some tests probe for endpoints that may not be wired in the API yet
(M-008 webhooks, M-010 metrics, audit-verify, M-016 well-known). Those
tests detect a 404 on the probe and `return` cleanly — they don't fail.
Once the corresponding API module ships, the test starts asserting.

A test will run today only if the operator has:

- started Postgres + Redis (`pnpm db:up`),
- started the API (`pnpm dev`),
- exported `OKORO_E2E_API_KEY` for a real principal.

## Adding tests

- Pin black-box behavior, not implementation details. If you need to
  read a Prisma row to check a side-effect, that's a sign the API
  doesn't expose enough — file a follow-up rather than reaching in.
- Use the `_support/fixtures.ts` helpers; do not roll your own
  `crypto.randomUUID()` / agent-register inline.
- Tests should be safe to run in any order. Each file gets its own
  agent + policy fixtures and tears them down with `afterAll`.

## CI integration

```yaml
# .github/workflows/e2e.yml — sketch
- run: pnpm install --frozen-lockfile
- run: pnpm db:up
- run: pnpm dev &
- run: |
    until curl -sf http://localhost:3000/health/live; do sleep 1; done
- run: pnpm tsx scripts/seed-dev.ts > .e2e-env
- run: source .e2e-env && cd tests && pnpm install && pnpm exec vitest run
```

Load + chaos are not in CI; run them manually before each cut.
