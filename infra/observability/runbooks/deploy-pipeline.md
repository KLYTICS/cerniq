# Runbook — Deploy pipeline failure

**First-touch SLA:** 15 min (deploy is rolled back automatically; runbook
guides the *forward-fix*, not the rollback).

## When this fires

The `Deploy API + worker (Railway)` or `Deploy dashboard + docs (Vercel)`
workflow ran on main and reported a failure. By the time you're reading
this, **the automatic rollback step has already run** (or attempted to)
and the previous deployment is again serving traffic.

Your job is to:

1. Confirm production is healthy (rollback worked).
2. Diagnose why the new deploy failed.
3. Decide forward-fix or revert-the-merge.

## First 5 minutes

1. **Confirm rollback succeeded** — hit the production URL and verify
   the previously-known-good version is responding:
   ```sh
   API=https://api.aegislabs.io bash scripts/deploy/smoke-api.sh
   ```
   If this fails too, jump to [Rollback also failed](#rollback-also-failed).

2. **Open the workflow run** linked from the page/Slack alert.
   - Which job failed? `gate` / `deploy` / `smoke` / `rollback`?
   - If `smoke` failed, scroll to "Run smoke" — it lists which of the
     7 gates broke, with the actual HTTP code and latency.

3. **Open the Railway / Vercel dashboard for the affected service**.
   Confirm the rollback deployment is the active one.

## Diagnosing the failure

The `gate` job decides whether to deploy at all. If it skipped, CI on
main didn't pass — fix CI first, then this becomes a non-issue.

The `deploy` job is the actual deploy step. Common failures:

| Symptom in logs                          | Cause                                                              | Fix                                                                                       |
|------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| `API deploy ended in FAILED`             | Build broke on Railway (Nixpacks misdetect, missing env, etc.)     | `railway logs --service aegis-api` — read the build trace. Often a missing Railway env.   |
| `API deploy timed out after 10 minutes`  | Build > 10 min (rare) or Railway region outage                     | Check Railway status. Re-run via `workflow_dispatch`. If still slow, bump the timeout.    |
| Vercel `Error: Project not found`        | `VERCEL_*_PROJECT_ID` secret mismatch                              | Re-verify project ID in Vercel dashboard. Update GitHub secret.                           |
| Vercel `Error: env var X missing`        | Env var defined in code but not pulled into the prebuilt artifact  | Add it in Vercel dashboard → Project → Settings → Environment Variables → Production.     |

The `smoke` job is the contract gate. Common failures and what they mean:

| Failed gate                       | What it tells you                                                           |
|-----------------------------------|-----------------------------------------------------------------------------|
| `liveness` (`/v1/health/live`)    | The API process crashed on boot or didn't start a listener. Check logs.     |
| `readiness` (`/v1/health/ready`)  | DB or Redis unreachable from the API container. Check `DATABASE_URL`, `REDIS_URL` in Railway. |
| `JWKS public`                     | `JWT_ED25519_PUBLIC_KEY_B64` env not set on Railway. Public keys are not secret; check it was published. |
| `audit-signing-key`               | `AUDIT_ED25519_PUBLIC_KEY_B64` env not set on Railway. Same as JWKS.        |
| `pricing.json`                    | Pricing tier config drifted or `/.well-known/pricing.json` route broke. Often a code change in `apps/api/src/modules/wellknown/`. |
| `swagger off in prod`             | `ENABLE_SWAGGER=true` slipped into prod env. Flip it to `false` on Railway and redeploy. |
| `verify rejects unauth`           | Auth guard broke. `INVALID_SIGNATURE` denial returned 200 instead of 401. **Critical** — verify hot path is in degraded state. |

## Forward-fix vs revert

After rollback, you have two paths:

- **Forward-fix** — open a PR with the targeted fix, re-merge, the deploy
  pipeline re-runs and (hopefully) passes the smoke gate.
- **Revert the merge** — `git revert <merge-sha>` on main, push. The
  pipeline runs again with the reverted state. Use this when the failing
  commit is large or the root cause isn't obvious within ~30 min.

Prefer **revert** if you cannot identify the root cause in 30 minutes.
"Production must come back" beats "we figured out exactly what broke."

## Rollback also failed

If `smoke-api.sh` against the production URL still fails after rollback:

1. **Page the on-call** (PagerDuty escalation chain — OD-007 has the
   exact contact). This is now an incident, not a deploy hiccup.
2. Update https://status.aegislabs.io to **major outage**.
3. Manually pick a known-good Railway deployment from the past 24h via
   the dashboard and `railway redeploy <id> --service aegis-api`.
4. If no Railway deployment in the past 24h is good, the database may be
   in an unrecoverable forward-migration state. See [audit-chain-break.md](./audit-chain-break.md)
   for the schema-recovery flow.

## Why rollback is automatic, not "approve to roll back"

Every minute production is broken is a minute of customer-visible damage
and (for AEGIS specifically) a minute where the verify path is denying
or allowing requests against a broken policy/audit chain. The cost of
rolling back unnecessarily ("oh, the smoke gate was overly strict") is
*one extra deploy* — cheap. The cost of leaving prod broken to wait for
human judgement is **customer trust**, which is not recoverable.

If the rollback was unnecessary, the forward-fix is to **fix the smoke
gate**, not to disable automatic rollback.

## Related runbooks

- [verify-error-rate-high.md](./verify-error-rate-high.md) — if 5xx rate
  spiked after deploy, the deploy is suspect even if smoke passed.
- [audit-chain-break.md](./audit-chain-break.md) — if the post-deploy
  audit-chain-integrity workflow paged.
- [key-rotation-failure.md](./key-rotation-failure.md) — if smoke
  failures correlate with a JWT/audit key change.

## Improving this runbook

When the next deploy fails in a way this runbook doesn't cover, add a
row to the symptom tables and commit it in the same PR as the forward-
fix. The runbook is the test plan for the next on-call.
