# AEGIS load tests (k6)

Steady-state verify-throughput benchmark. Runs separately from the vitest
suite because k6 is a standalone Go binary, not a Node test runner.

## Install

```bash
# macOS
brew install k6

# linux
sudo apt install k6   # or follow https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## Run

```bash
# 1. start the API and seed a dev agent + policy + per-request token
pnpm db:up
pnpm dev                              # terminal A
pnpm tsx scripts/seed-dev.ts          # terminal B — emits ENV exports

# 2. export the seeded values, then run k6
export AEGIS_E2E_URL=http://localhost:3000
export AEGIS_E2E_API_KEY=aegis_sk_...
export AEGIS_E2E_REQUEST_TOKEN=eyJhbGc...   # pre-signed agent JWT

k6 run tests/load/verify.js
```

## Budget

`load/verify.js` enforces the following thresholds; the run **fails** if
any are breached:

| metric                          | threshold       | rationale                       |
|---------------------------------|-----------------|---------------------------------|
| `http_req_failed`               | `< 1 %`         | infrastructure stability        |
| `http_req_duration` p95         | `< 200 ms`      | API SLA target                  |
| `http_req_duration` p99         | `< 500 ms`      | tail-latency SLO                |
| `aegis_verify_latency_ms` p95   | `< 200 ms`      | end-to-end measured client-side |

Pattern: 50 RPS constant arrival for 60 s. Adjust the scenario block in
`verify.js` to push higher; remember to bump `preAllocatedVUs` and
`maxVUs` in step.

## Caveat — single jti at high RPS

This script reuses a single pre-signed `REQUEST_TOKEN` across every VU
iteration. AEGIS replay protection (test 08) means every iteration but
the first should return `valid:false`. That is fine for measuring raw
throughput, but it does **not** exercise the spend-counter path. To push
spend-counter contention, mint a pool of distinct tokens via a Node
pre-step and load them as a JSON array via `--env TOKENS_FILE=…`.
