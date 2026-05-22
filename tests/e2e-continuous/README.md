# AEGIS continuous E2E (funnel monitor)

This suite is a **production heartbeat for the paying-customer funnel**. It runs
every 15 minutes against staging from the `.github/workflows/continuous-e2e.yml`
workflow and pages on real funnel failures. It is intentionally separate from
`tests/e2e/` — that suite is a black-box regression battery for a developer
running `pnpm dev`. This suite is a watchdog.

## What it asserts

One vitest spec, ten ordered steps. Each step is its own `it(...)` so the
structured run report can attribute the failure mode to a specific stage.

| # | Step | What it gates |
|---|------|---------------|
| 1 | `landing` | Marketing/docs origin returns 200 and serves HTML — catches CDN/edge misroutes |
| 2 | `pricing_discovery` | `GET /.well-known/pricing.json` parses and contains a Free + Developer tier — catches a broken billing-derived discovery surface |
| 3 | `signup` | `E2E_BOOTSTRAP_API_KEY` authenticates against `GET /v1/agents?limit=1` — proves the synthetic principal still exists |
| 4 | `agent_register` | Ed25519 keypair generated locally, agent registered under the synthetic principal — proves identity registration works |
| 5 | `policy_create` | Small-scope commerce policy created (`maxPerTransaction=5`, `maxPerDay=25`) — proves policy creation works |
| 6 | `verify_allow` | Locally-signed token + matching context → `decision=ALLOW` — proves the hot path works end-to-end |
| 7 | `verify_deny_invalid_signature` | Tampered signature → `denialReason=INVALID_SIGNATURE` — proves the **denial-precedence ordering** invariant (CLAUDE.md #6): signature failure must short-circuit before policy/scope/spend gates |
| 8 | `trial_exhausted` (gated) | Loops verify to the cap, then asserts cap+1 returns `TRIAL_EXHAUSTED` — proves the lifetime trial gate (ADR-0014). **Off by default** (set `E2E_RUN_TRIAL_EXHAUSTION=true` only on the dedicated daily probe — production cap is 10 000 and too slow for a 15-minute cron) |
| 9 | `audit_export` | NDJSON export from `/v1/audit-events/export` parses and every recent row carries `aegisSignature` + `signingKeyId` + `timestamp` and at least one row matches this run's agent — proves the audit chain is being written |
| 10 | `cleanup` | Revokes the synthetic agent — keeps the staging principal tidy |

## Skip vs. fail

- **Skip cleanly (green):** `AEGIS_E2E_BASE_URL` or `E2E_BOOTSTRAP_API_KEY` not
  set, or the staging health probe fails within 5s. A single
  `[e2e-continuous] skipped: <reason>` line is logged and the suite exits 0.
  Misconfiguration is not a page.
- **Fail (red, pages):** preconditions met but a step assertion fails. The
  workflow's `page-on-failure` job posts the structured run report to
  `secrets.E2E_PAGE_WEBHOOK_URL`.

## Environment variables

Every credential is `process.env.X`. Operator-owned values are marked.

| Name | Required | Notes |
|------|----------|-------|
| `AEGIS_E2E_BASE_URL` | yes | **OPERATOR-INPUT-NEEDED** — staging API base, e.g. `https://api.staging.aegislabs.io`. Without trailing slash. |
| `AEGIS_E2E_LANDING_URL` | no | **OPERATOR-INPUT-NEEDED** — marketing/docs origin if it differs from the API. Defaults to `AEGIS_E2E_BASE_URL`. |
| `E2E_BOOTSTRAP_API_KEY` | yes | **OPERATOR-INPUT-NEEDED** — management key (`aegis_sk_...`) bound to a dedicated `e2e-continuous` principal pre-provisioned in staging. Must be a non-FREE tier unless trial-exhaustion is the deliberate gate being probed. |
| `E2E_PAGE_WEBHOOK_URL` | yes (CI only) | **OPERATOR-INPUT-NEEDED** — webhook the workflow POSTs failure reports to. PagerDuty event API, Slack incoming-webhook, or similar. |
| `E2E_RUN_ID` | no | Defaults to `${Date.now()}-<rand>`. The workflow sets it to `${run_id}-${run_attempt}` for traceability. |
| `E2E_RUN_TRIAL_EXHAUSTION` | no | `'true'` enables step 8. Off by default. |
| `E2E_TRIAL_CAP_OVERRIDE` | conditional | Required when step 8 runs. Integer 1..50, must match the API's `TRIAL_LIFETIME_CAP` override env. |
| `AEGIS_E2E_SKIP_LANDING_COPY` | no | `'true'` to skip the HTML-shape assertion on the landing page (useful during marketing rewrites). |

### Open operator gaps

These are TODOs the spec leaves explicit because they require ops work that's
outside the test surface:

1. **No `/v1/principals` admin-create endpoint.** Step 3 ("signup") cannot
   create a fresh synthetic principal per run. The operator must
   pre-provision one dedicated `e2e-continuous` principal in staging and
   bind `E2E_BOOTSTRAP_API_KEY` to it. The run-report records the
   synthetic email pattern (`e2e-continuous+<run-id>@aegislabs.io`) so the
   janitor sweep has a deterministic prefix to target. If a future admin
   endpoint lands, the step's `TODO[OPERATOR-INPUT-NEEDED]` block is the
   place to wire it.
2. **Full offline audit-chain verification.** `@aegis/verifier-rp` exports
   token-verify primitives (`AegisVerifier`, `parseCompactJws`,
   `verifyEdDSA`) but no `verifyAuditChain(rows, jwks)` helper exists. Step
   9 validates structural integrity (every row carries the signature +
   keyId fields) but does not yet recompute and verify the chain link by
   link. The audit-chain-integrity workflow's nightly cron (`pnpm --filter
   @aegis/scripts audit-verify-chain`) is the deeper check; this monitor
   is the fast one.
3. **`gh-pages` branch.** The `publish-report` job assumes the branch
   exists. First-time setup:
   ```bash
   git checkout --orphan gh-pages && git rm -rf . && \
     git commit --allow-empty -m "init gh-pages" && \
     git push origin gh-pages
   ```

## Running locally

```bash
# from repo root, with pnpm install already done
AEGIS_E2E_BASE_URL=http://localhost:3000 \
E2E_BOOTSTRAP_API_KEY=aegis_sk_... \
  pnpm --filter @aegis/e2e-continuous test
```

Vitest prints the sentinel `__E2E_CONTINUOUS_REPORT__<json>__END__` line in
the test output. Pipe through `run-report.ts` for canonical JSON:

```bash
AEGIS_E2E_BASE_URL=… E2E_BOOTSTRAP_API_KEY=… \
  pnpm --filter @aegis/e2e-continuous test \
  | pnpm --filter @aegis/e2e-continuous exec tsx run-report.ts
```

## Debugging a failed run

1. Open the failed Actions run → download the
   `e2e-continuous-<run_id>-<attempt>` artifact. It has both
   `vitest.log` (human-readable) and `report.json` (structured).
2. The `report.json` `steps[]` array has the step name, status, latency, and
   the failure message. The failing step's name maps 1:1 to the funnel table
   above.
3. For verify failures specifically, the spec captures the SDK's `denialReason`
   in the step detail — that's enough to disambiguate "wrong signature" vs.
   "wrong precedence ordering" vs. "policy expired before we got to step 6."
4. The synthetic agent for that run is `e2e-continuous-<run-id>` (the agent
   label) — useful for grepping the staging audit log if you want to see
   the full sequence of events the spec drove.

## What this suite does NOT do

- It does not test billing/Stripe paths. That's `tests/e2e/18_stripe_subscription.test.ts`
  on demand.
- It does not test webhook delivery, JWKS rotation, replay protection, rate
  limits, or any other "deep" e2e contract. Those are in `tests/e2e/` and
  run on a different schedule.
- It does not create or delete principals. See gap #1.
- It does not do property-based fuzzing. See `tests/e2e/property/`.

The goal is a fast, narrow, ten-step probe of the customer-visible funnel —
not a full regression. If the funnel is intact, paying customers can keep
paying. If a step here fails, on-call gets paged.
