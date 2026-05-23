# Load tests

[k6](https://k6.io) tests proving the latency budgets claimed in
`docs/ARCHITECTURE.md`. Run before every release; soak-tested in
staging weekly.

## Tests

| File           | Target                     | Budget                 |
| -------------- | -------------------------- | ---------------------- |
| `verify.k6.js` | `POST /v1/verify` hot path | p99 < 200 ms (Phase 1) |
|                |                            | p99 < 80 ms (Phase 3)  |

## Running locally

Install k6 (`brew install k6`), seed a fixture, then run:

```sh
# 1. Boot the stack
docker compose up -d
pnpm install
pnpm --filter @cerniq/api prisma:migrate
pnpm tsx apps/api/scripts/seed-dev.ts --emit-token > .env.fixture
source .env.fixture                          # exports CERNIQ_FIXTURE_TOKEN + CERNIQ_VERIFY_KEY
pnpm dev                                     # in another shell

# 2. Run the test
k6 run apps/api/test/load/verify.k6.js
```

## Running against staging

```sh
CERNIQ_BASE_URL=https://api.staging.cerniq.io \
  CERNIQ_VERIFY_KEY=$STAGING_VERIFY_KEY \
  CERNIQ_FIXTURE_TOKEN=$STAGING_FIXTURE_TOKEN \
  k6 run apps/api/test/load/verify.k6.js
```

## Running against the Phase 3 edge

Same as staging but with the edge URL and a tighter budget:

```sh
P99_BUDGET_MS=80 \
  CERNIQ_BASE_URL=https://cerniq.cerniq.io \
  CERNIQ_VERIFY_KEY=$EDGE_VERIFY_KEY \
  CERNIQ_FIXTURE_TOKEN=$STAGING_FIXTURE_TOKEN \
  k6 run apps/api/test/load/verify.k6.js
```

## CI integration

Not enabled in CI yet — fixture management adds complexity and the
load test is wall-clock heavy (~3.5 min per run). Plan: nightly
GitHub Action against staging with results posted to the dashboard
under the SLO panel.

## Outputs

- Console summary printed at the end of the run.
- JSON dump at `apps/api/test/load/verify.k6.summary.json` for
  downstream tooling.
- Threshold breaches → non-zero exit (CI / nightly job fails).

## Adding a new load test

1. Drop a new `*.k6.js` here.
2. Document the budget + endpoint in the table above.
3. Add fixtures to `apps/api/scripts/seed-dev.ts` so it can boot in
   isolation.
