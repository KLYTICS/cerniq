# Runbook — Verify error / denial rate high

## Alert

- **Names**: `VerifyErrorRateHigh` (warning), `HTTP5xxRateHigh`
  (critical, platform-level companion)
- **Group**: `cerniq.verify.slo` (denial rate), `cerniq.platform` (5xx)
- **File**: `infra/observability/alerts/cerniq.rules.yml`

## Symptom

Either:

1. Verify denials (excluding legitimate revocations) are over 5% for
   10 min — relying parties are being told "no" more than the baseline.
2. Or: 5xx rate is over 2% for 10 min — the API itself is throwing.

These share a runbook because the diagnosis branches the same way:
"is it the customer's request shape, or is it us."

## Impact

- **Customer trust**: a relying party getting unexpected denials cannot
  process its own users. They will surface this as "CERNIQ is broken"
  whether or not the cause is on our side.
- **Error budget**: denial spikes from the non-revocation set burn the
  success-rate budget the same as 5xx (see `cerniq.recording` group in
  `cerniq.rules.yml` — only AGENT_REVOKED / POLICY_REVOKED /
  POLICY_EXPIRED are excluded).
- **Audit chain**: 5xx during verify means the audit row may not have
  appended → potential SOC2 evidence gap. Cross-check with the
  audit-chain-break runbook.

## Diagnose

1. **Confirm and classify.** Open the verify SLO dashboard panel 2
   ("Denial reasons"). Note: the dashboard panel currently uses an
   incorrect metric name (`cerniq_verify_denials_total`) — see drift
   note in `cerniq.rules.yml`. Use this query directly until panel 2
   is fixed (M-020):

   ```promql
   sum by (denial_reason) (rate(cerniq_verify_total{decision="denied"}[5m]))
   ```

   Whichever `denial_reason` dominates determines the branch.

2. **Branch by denial reason** (denial precedence per `CLAUDE.md`
   invariant § 6 / `docs/SECURITY.md` § Denial Precedence):
   - **`INVALID_SIGNATURE` spike** — relying-party SDK regression
     or clock drift. Check whether it's one principal or many:
     ```promql
     sum by (denial_reason) (rate(cerniq_verify_total{decision="denied",denial_reason="INVALID_SIGNATURE"}[5m]))
     ```
     If a single principal dominates, that customer rolled out a bad
     SDK build. Reach them directly.
   - **`SCOPE_NOT_GRANTED` spike** — customer issued tokens with
     too-narrow scopes. Same check; usually a config push on their side.
   - **`TRUST_SCORE_TOO_LOW` spike with no signal-volume change** —
     BATE math drift. Skip to the BATE runbook.
   - **`AGENT_REVOKED` / `POLICY_REVOKED` / `POLICY_EXPIRED` spike** —
     these are excluded from the alert numerator; if the alert fired
     anyway, the exclusion regex broke. Check the rule file.
   - **`SPEND_LIMIT_EXCEEDED` spike** — a customer hit their spend
     cap, possibly intentional (incident on their side) or a runaway
     agent. Cross-reference with `SpendRecord` table:
     ```bash
     railway run -s cerniq-api -- psql "$DATABASE_URL" -c "SELECT \"principalId\", COUNT(*) FROM \"SpendRecord\" WHERE \"createdAt\" > NOW() - INTERVAL '15 minutes' GROUP BY 1 ORDER BY 2 DESC LIMIT 5;"
     ```

3. **For 5xx (HTTP5xxRateHigh):**

   ```promql
   sum by (route) (rate(cerniq_http_requests_total{status_class="5xx"}[5m]))
   ```

   Then pull stack traces:

   ```bash
   railway logs -s cerniq-api | rg -F '"level":50' | tail -30   # Pino fatal+error
   railway logs -s cerniq-api | rg -F 'PrismaClientKnownRequestError|UnhandledPromiseRejection' | tail -30
   ```

   If errors include `PrismaClientInitializationError`, Postgres is
   unreachable → page the database secondary on-call.

4. **Recent deploys + recent migrations.**

   ```bash
   railway deployments -s cerniq-api --json | jq '.[0:3]'
   railway run -s cerniq-api -- pnpm --filter @cerniq/api prisma migrate status
   ```

5. **OTel trace search.** Filter:
   `service.name="cerniq-api" status.code="ERROR"` — the most common
   error span will name the failing dependency (Prisma, Redis,
   webhook delivery).

## Mitigate

- **Single-principal denial spike** (one customer's INVALID_SIGNATURE
  or SCOPE_NOT_GRANTED): contact the customer; this is a
  customer-side bug. CERNIQ is correctly denying.
- **Multi-principal denial spike**: that's us. If a deploy landed
  within the window, rollback:
  `railway rollback -s cerniq-api <prev-deploy-id>`.
- **5xx from Postgres unreachable**: failover via Railway dashboard;
  if the API's `DATABASE_URL` is stale, restart the service.
- **5xx from a single route** (e.g. `POST /v1/audit/...`): consider
  short-term feature flag off via env var if one exists, otherwise
  rollback.
- **Spend-cap denial spike**: this is _correct behaviour_ — do not
  mitigate by raising caps without operator approval. Notify the
  affected customers via the support channel and tell them their
  agents are over budget.

## Eradicate

- For SDK regressions: open an issue against `packages/sdk-ts` (or
  the customer's SDK if external). Add a verify-path integration
  test that catches the bad signature shape.
- For policy-config errors: improve the `POST /v1/policies` validation
  to refuse the misshape that caused the spike.
- For 5xx from uncaught exceptions: the catch site should be wrapped
  in `CerniqError` (`apps/api/src/common/errors/`); add a unit test
  reproducing the failure mode.
- For Postgres reachability: file a Railway incident link in the
  postmortem and confirm the connection-pool retry budget
  (`PRISMA_CONNECTION_TIMEOUT`) is sane.

## Verify recovery

For denial-rate alerts:

```promql
sum(rate(cerniq_verify_total{decision="denied",denial_reason!~"AGENT_REVOKED|POLICY_REVOKED|POLICY_EXPIRED"}[5m]))
/
clamp_min(sum(rate(cerniq_verify_total[5m])), 0.001)
```

Must return < 0.02 sustained over 15 min (well under the 0.05
threshold).

For 5xx alerts:

```promql
sum(rate(cerniq_http_requests_total{status_class="5xx"}[5m]))
/
clamp_min(sum(rate(cerniq_http_requests_total[5m])), 0.001)
```

Must return < 0.005 sustained over 15 min.

## Escalate

- **Not resolved in 15 min (5xx critical)** → page second-on-call.
- **Not resolved in 30 min (denial warning)** → notify
  `#cerniq-oncall` lead.
- **Customer-reported impact** → page status-page owner; post within
  5 min of customer report.
- **Suspected security incident** (e.g. INVALID_SIGNATURE spike from
  a single new IP range hitting many principals) → page
  `${ESCALATION_CONTACT}` (OD-007 pending) immediately, do not wait
  for the timer.

## Postmortem trigger

**Yes** for any 5xx critical alert (even if resolved < 30 min — 5xx
indicates we threw, which is always worth understanding). **Yes** for
any denial-rate alert that lasted > 30 min or was customer-reported.
**No** for self-resolving warning-only events under 30 min, but post
the cause in `#cerniq-ops`.
