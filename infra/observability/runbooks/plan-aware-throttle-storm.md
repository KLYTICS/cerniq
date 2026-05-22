# Runbook — plan-aware throttle storm

## Alert

- **Names**: `PlanAwareThrottle429SpikeFree` (warning),
  `PlanAwareThrottlePrincipalIdMissing` (critical),
  `PlanAwareThrottleEnterpriseLeak` (warning) — *not yet emitted;
  flip on metric land per round 15 backlog*.
- **Group**: `okoro.throttle`
- **File**: `infra/observability/alerts/okoro.rules.yml`
- **Source**: round-15 throttle surface — `apps/api/src/common/throttle/plan-aware-throttler.guard.ts`, plan tier registry in `billing/plans.ts`.

## Symptom

One or more of:
1. `http_requests_total{status="429", path="/v1/verify"}` rate > 5/s sustained for 5 min on FREE-tier principals (abuse, expected) OR on paid-tier principals (mis-classified — bug).
2. The 429 response body's `details.planTier` is `null` or doesn't match `Principal.planTier` in DB (plan-cache drift).
3. ENTERPRISE principal hitting 429 (the guard short-circuits ENTERPRISE — if 429s are firing, the short-circuit failed).
4. Principal-id absent on authenticated request — tracker falls back to IP, breaking per-principal accounting (NAT-shared customers get throttled together — bad).

## Impact

- **Customer-visible 429s on the wrong tier are an immediate support ticket and a churn signal.** A DEVELOPER-tier customer paying $49/mo and seeing FREE-tier limits will leave.
- **NAT-shared customers throttled together** (principal-id missing → IP fallback) is the worst variant: legitimate paying customers lose access because another customer behind the same NAT exhausted the IP-bucket.
- **ENTERPRISE leak** (paying $$$ and seeing 429): contractual SLA breach. ENTERPRISE customers expect unlimited; a 429 on this tier is a refund event.
- **Free-tier abuse storm**: not strictly an incident — the throttle is doing its job. But if the abuser is sustaining > 100 rps from one principal, our cost model assumes lower abuse — investigate the tooling pattern they're using and whether the per-tier limit needs tightening.

## Diagnose

1. **Break down 429 rate by tier and principal.**

   ```promql
   sum by (planTier) (rate(http_requests_total{status="429", path="/v1/verify"}[5m]))
   topk(10, sum by (principalId) (rate(http_requests_total{status="429", path="/v1/verify"}[5m])))
   ```

   The first query confirms which tier is firing. The second names the principals — if any TEAM/SCALE/ENTERPRISE principal appears, that's the bug.

2. **Confirm the tier-classification path.**

   ```bash
   # The 429 envelope echoes `details.planTier` — capture a sample.
   railway logs -s okoro-api | rg -F 'rate_limit_exceeded' | tail -5
   ```

   Compare `details.planTier` to the principal's actual `planTier`:

   ```sql
   SELECT id, "planTier", "subscriptionStatus", "createdAt"
   FROM "Principal"
   WHERE id = '<id from the 429 sample>';
   ```

   Mismatch → plan-cache stale. The cache lives in Redis at `okoro:plan:<principalId>` with 5-min TTL.

3. **Inspect the plan cache.**

   ```bash
   railway run -s okoro-redis -- redis-cli GET "okoro:plan:<principalId>"
   railway run -s okoro-redis -- redis-cli TTL "okoro:plan:<principalId>"
   ```

   If the cached value disagrees with DB, force-invalidate:

   ```bash
   railway run -s okoro-redis -- redis-cli DEL "okoro:plan:<principalId>"
   ```

   Round 15 design: `usageGuard.invalidatePlanCache(principalId)` is called from the Stripe checkout webhook handler. Manual upgrades via DB will need explicit invalidation.

4. **Check the principal-id tracker logic.**

   ```bash
   railway logs -s okoro-api | rg -F 'plan-aware-throttler' | tail -20
   ```

   The guard's `getTracker()` should return `principal:<id>` for authenticated requests; `ip:<ip>` for anonymous. If you see `ip:` for requests that should have `principal:`, the auth guard isn't populating `req.principal` before throttle eval.

5. **Verify the storage key shape (plan-upgrade clears bucket cleanly).**

   The round-15 design encodes the tier into the bucket key: `principal:<id>|<tier>`. So when a tier upgrades, the new tier's bucket is fresh (no carry-over of FREE-tier denials). Check the Redis throttle keyspace:

   ```bash
   railway run -s okoro-redis -- redis-cli --scan --pattern 'throttle:principal:<id>*'
   ```

## Mitigate

- **Plan cache stale → wrong tier limit applied**: invalidate the cache key for the affected principals. Document the manual-upgrade path that bypassed `invalidatePlanCache` and ensure future paths call it.

- **Principal-id missing → IP fallback throttling NAT-shared customers**: this is a security/auth bug, not a throttle bug. Confirm the auth guard ordering in `apps/api/src/modules/auth/auth.module.ts` — `ApiKeyGuard` must run before `PlanAwareThrottlerGuard`. Quick mitigation: temporarily lift FREE-tier limit (env var or plans.ts patch) until the root cause is fixed; long-term, add a metric `okoro_throttle_principal_missing_total` and alert on it.

- **ENTERPRISE seeing 429**: the short-circuit in `handleRequest` should detect ENTERPRISE before any Redis call. If it isn't, suspect:
  - The principal's `planTier` was downgraded in DB without anyone realizing (check audit log for `principal.tier_changed` events).
  - The `Number.POSITIVE_INFINITY` sentinel encoding broke (e.g., serialization across a process boundary turned it into `null`).

  Mitigation: bump the principal back to ENTERPRISE in DB + invalidate plan cache. Issue refund/credit per SLA.

- **Sustained FREE-tier abuse**: the throttle is doing its job. If the abuse rate exceeds operational tolerance (e.g., > 1000 rps from one principal), consider:
  - Tightening per-tier limits in `billing/plans.ts` (operator decision).
  - Banning the principal via admin endpoint (when M-027 admin lands).
  - Adding a captcha gate at signup (out of scope for runbook — escalate to product).

## Eradicate

- For plan-cache drift: every code path that mutates `Principal.planTier` (Stripe webhook, admin panel, manual SQL) MUST call `usageGuard.invalidatePlanCache(principalId)` immediately after. Add a cross-package parity test: any caller of `prisma.principal.update({ data: { planTier } })` either invalidates or has `// invalidate-not-needed: <reason>` comment.
- For principal-id missing: add gate in CI (e.g., a unit test that simulates a request with `req.principal = undefined` and asserts the guard either short-circuits or emits a metric, never silently falls back to IP without surfacing the issue).
- For ENTERPRISE leak: add an integration test that exercises 1000 rapid requests on ENTERPRISE and asserts 0 × 429.

## Verify recovery

```promql
# 429 rate on paid tiers must be 0 for 15 min.
sum(rate(http_requests_total{status="429", path="/v1/verify", planTier=~"DEVELOPER|TEAM|SCALE|ENTERPRISE"}[5m])) == 0
# Tracker miss rate must be 0 for 15 min (every authenticated request gets principal-id).
sum(rate(okoro_throttle_principal_missing_total[5m])) == 0
```

## Escalate

- **ENTERPRISE 429 storm**: page `${ESCALATION_CONTACT}` immediately + notify operator. SLA breach.
- **NAT-shared throttling** affecting any customer: high-touch outreach to the affected customer with a per-incident credit; root-cause within 24h.
- **Sustained sub-FREE abuse beyond cost model**: notify operator (Erwin) — pricing/limit decision needed.

## Postmortem trigger

- **Yes** for any ENTERPRISE 429 (SLA breach).
- **Yes** for any plan-cache drift that affected a paying customer.
- **Yes** for any IP-fallback throttling that hit a paying customer.
- **No** for routine FREE-tier abuse storms within design parameters.

## See also

- Round 15 handoff: `docs/SESSION_HANDOFF.md` 2026-05-05 entry, Lane 1.
- Code: `apps/api/src/common/throttle/plan-aware-throttler.guard.ts`, `apps/api/src/modules/billing/{plans.ts,usage-guard.service.ts}`.
- Tests: `plan-aware-throttler.guard.spec.ts` (6 tests), `plans.spec.ts`, `usage-guard.service.spec.ts`.
- OD-006 (FREE-tier rate limit decision) — encoded round 15.
- ADR-0014 (tier names: GROWTH → TEAM + SCALE).
