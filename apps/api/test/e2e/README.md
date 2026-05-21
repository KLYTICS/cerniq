# `apps/api/test/e2e` — full-stack integration suite

End-to-end tests that boot the real `AppModule`, talk to a real Postgres
+ Redis, and exercise transactions across **multiple endpoints in one
narrative** — never a single endpoint in isolation.

## Running

```bash
pnpm --filter @aegis/api test:e2e
```

The existing `test:e2e` script is

```json
"test:e2e": "jest --config ./test/jest-e2e.config.ts --runInBand"
```

The Jest config at `apps/api/test/jest-e2e.config.ts` uses
`testRegex: '.*\\.e2e[.-]spec\\.ts$'` so both the locked spec layout
(`<name>.e2e.spec.ts`, dot) and the Nest convention (`<name>.e2e-spec.ts`,
hyphen) are picked up. Earlier revisions accepted only the hyphen form
and so silently matched zero files — keep both alternatives in any
future regex change.

## Required infrastructure

- **Postgres 16** at `DATABASE_URL` (defaulted to
  `postgresql://aegis:aegis@localhost:5432/aegis_test?schema=public` by
  `apps/api/test/setup-env.ts`).
- **Redis 7** at `REDIS_URL` (defaulted to `redis://localhost:6379`).
- Both are provided by the repo-root `docker-compose.yml`.

Schema migrations run automatically when `RUN_MIGRATIONS=1` is set; for
local iteration assume `pnpm --filter @aegis/api prisma:deploy` has been
run once.

Between specs the helper truncates these tables in dependency order:

```
WebhookDelivery, WebhookSubscription, BateSignal, TrustScoreHistory,
SpendRecord, AuditEvent, AgentDelegation, AgentPolicy, AgentIdentity,
ApiKey, RelyingParty, Principal
```

## Adding a new e2e test

1. Drop a `<feature>.e2e.spec.ts` under this directory.
2. In `beforeAll`, `const { app, close } = await createTestApp();` and
   keep the returned Supertest agent alive for every `test()` in the
   suite.
3. Build a **transaction**, not a single endpoint: every spec must do at
   least 2 mutations + 1 read. (Quality bar — see CLAUDE.md.)
4. Tear down with `await close();` in `afterAll`.

## Quality bar

- No `it.skip` / `test.skip` without an explicit migration tracker
  (`M-XXX`) and a one-line comment naming what unblocks it.
- No `expect(true).toBe(true)` filler. Every `test()` asserts on at least
  one real value.
- No `Math.random` — use `crypto.randomUUID()` or fixture seeds.
- No `any` without a `// type-rationale:` comment.

## Known limits (tracked)

| Tracker | Limit                                                                         |
| ------- | ----------------------------------------------------------------------------- |
| M-019   | `AuditEvent` lacks a `correlationId` / `txId` column. The                     |
|         | "txId echoed into audit row" assertion in `correlation.e2e.spec.ts` is        |
|         | `test.skip()`'d until the migration lands.                                    |
| M-007   | BATE recompute is async (BullMQ). Tests poll up to 5 s for trustScore         |
|         | changes; if the worker is offline the assertion in `full-flow.e2e.spec.ts`    |
|         | falls back to "report accepted (202)" without forcing a score change.        |
| M-020   | `TRUST_SCORE_TOO_LOW` and `ANOMALY_FLAGGED` are not yet checked inside        |
|         | `verify.algorithm.ts` (the precedence enum exists in `packages/types` but     |
|         | the algorithm lacks the gate). Those two cases in                             |
|         | `denial-precedence.e2e.spec.ts` `test.skip()` with this tracker.              |
| M-019   | Verify response payload doesn't return `auditEventId`. The                    |
|         | "approved request links to an audit row" assertion uses `GET /audit` to      |
|         | join instead of trusting the response (no fabricated assertion).              |
| M-021   | `AuditChainPayload` migrated from v1 (raw                                     |
|         | action/relyingParty/requestedAmount/policySnapshot) to v2 (`*Hash`            |
|         | commitments) for GDPR Art. 17 erasure safety. `audit-chain.e2e.spec.ts`       |
|         | (whole suite) and `full-flow.e2e.spec.ts` test #10 still build the v1        |
|         | shape and are `describe.skip` / `test.skip`'d until they're rewritten         |
|         | against v2 (use `chain.buildPayload(...)` to derive hashes from raw).         |
