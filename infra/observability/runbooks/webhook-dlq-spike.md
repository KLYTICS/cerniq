# Runbook — Webhook DLQ spike / delivery failure rate

## Alert

- **Names**: `WebhookDLQSpike` (warning), `WebhookDeliveryFailureRate`
  (warning)
- **Group**: `aegis.webhooks`
- **File**: `infra/observability/alerts/aegis.rules.yml`

## Symptom

Either:
1. Webhooks are being abandoned at > 0.5/s for 10 min (DLQ spike) —
   deliveries gave up after `MAX_ATTEMPTS=8` (OD-005) spanning ~8 min
   of exponential backoff.
2. Or: 20% of delivery attempts are failing for 15 min — upstream of
   the DLQ; we still have time to fix before the DLQ alert fires.

## Impact

- **Customer integrations**: each abandoned delivery is a customer
  who didn't get notified. They may rely on `aegis.agent.trust_score_changed`
  to take security action; missed deliveries delay their response.
- **SLO**: webhook end-to-end delivery SLO is 99.9% delivered or
  DLQ'd within 24 h (`docs/SLO.md` § 1). The DLQ row exists for
  reconciliation, but the customer still didn't get the event.
- **Trust**: webhooks failing for many customers at once usually means
  we shipped a bad payload schema or signing change. Roll back fast.

## Diagnose

1. **Confirm the rate.**

   ```promql
   # DLQ alert (status=abandoned)
   sum(rate(aegis_webhook_delivery_total{status="abandoned"}[5m]))

   # Failure-rate alert (status=failed, attempts not yet abandoned)
   sum(rate(aegis_webhook_delivery_total{status="failed"}[5m]))
   /
   clamp_min(sum(rate(aegis_webhook_delivery_total[5m])), 0.001)
   ```

2. **Per-event-type breakdown.** A schema regression usually shows up
   in one event:

   ```promql
   sum by (event, status) (rate(aegis_webhook_delivery_total[5m]))
   ```

   If a single `event` value dominates the failures (e.g.
   `aegis.agent.trust_score_changed`), suspect a recent payload
   change for that event type.

3. **Per-customer-endpoint breakdown.** Query Postgres directly —
   we don't label by endpoint URL (high-cardinality):

   ```sql
   SELECT "endpointUrl", "lastStatus", COUNT(*) FROM "WebhookDelivery"
   WHERE "createdAt" > NOW() - INTERVAL '15 minutes'
     AND "lastStatus" IN ('FAILED', 'ABANDONED')
   GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10;
   ```

   If a single endpoint dominates → that customer's endpoint is broken;
   it's their problem to fix.

4. **Pull a sample failed delivery's last response.**

   ```sql
   SELECT id, "endpointUrl", "lastStatus", "lastResponseStatusCode",
          LEFT("lastResponseBody", 500) AS body
   FROM "WebhookDelivery"
   WHERE "lastStatus" IN ('FAILED', 'ABANDONED')
     AND "createdAt" > NOW() - INTERVAL '15 minutes'
   ORDER BY "createdAt" DESC LIMIT 5;
   ```

   - 4xx (except 429) → customer endpoint rejected the payload.
     Their bug, but check our payload first if many customers see
     the same 4xx.
   - 5xx → customer endpoint is down. Wait for backoff retries.
   - Connection error → DNS, TLS handshake, or unreachable host.
   - 429 → customer rate-limited us; back off applies.
   - Timeout (5s per-attempt cap) → customer endpoint is too slow.

5. **Check recent deploys + payload changes.**

   ```bash
   railway deployments -s aegis-api --json | jq '.[0:3] | .[] | {createdAt, status}'
   railway logs -s aegis-worker | rg -F 'webhook.delivery' | tail -50
   ```

6. **Signature verification.** If the signing scheme changed and
   customers verify (Stripe-style `X-AEGIS-Signature: t=<ts>,v1=<hmac>`),
   they will reject as 4xx.

   ```bash
   railway run -s aegis-api -- node -e 'console.log((process.env.WEBHOOK_SIGNING_SECRET || "").length)'
   ```

## Mitigate

- **Single customer endpoint failing**: contact the customer; mark
  the deliveries as expected DLQ (no AEGIS-side action). Confirm via
  step 3 that no other customers are affected.
- **Many customers failing on one event type** (schema regression):
  rollback `railway rollback -s aegis-api <prev-deploy-id>` AND
  `railway rollback -s aegis-worker <prev-deploy-id>` — both
  services may need to roll. New attempts will pick up the old
  payload format.
- **Many customers failing on signature**: confirm the
  `WEBHOOK_SIGNING_SECRET` env var hasn't rotated mid-flight. If it
  did, rotate it back (or roll the consumers forward).
- **Worker overwhelmed** (failed because the worker timed out): scale
  worker replicas — `railway service scale aegis-worker --replicas <n+1>`.
- **Re-drive the DLQ** after mitigation: webhook deliveries that hit
  ABANDONED stay in `WebhookDelivery` with status. Re-enqueue them via
  the admin tool (when shipped — `scripts/redrive-webhooks.ts`,
  M-021). Until then, manually:

  ```sql
  -- After confirming the underlying issue is fixed:
  UPDATE "WebhookDelivery" SET "lastStatus" = 'PENDING', attempts = 0
  WHERE id IN ('<id1>', '<id2>', ...);
  ```

  Then trigger a re-enqueue cycle by restarting the worker — it picks
  up PENDING rows on startup. Document each manually-redriven id in
  the incident timeline.

## Eradicate

- **Schema regression**: add the missing payload field as
  optional/backward-compat in the next release. Add a webhook
  contract test in `apps/api/test/webhooks/` that locks the payload
  shape per event type.
- **Single-customer recurring failures**: open a customer-facing
  ticket; they need to fix their endpoint or remove it. Document in
  the customer's account record.
- **Worker scaling**: bump default replica count in
  `infra/railway/aegis-worker.json`.

## Verify recovery

```promql
# DLQ rate must drop to ~0
sum(rate(aegis_webhook_delivery_total{status="abandoned"}[5m])) < 0.1

# Failure rate must drop below 5%
sum(rate(aegis_webhook_delivery_total{status="failed"}[5m]))
/
clamp_min(sum(rate(aegis_webhook_delivery_total[5m])), 0.001)
< 0.05
```

Both must hold for 15 min.

For redriven deliveries: confirm none re-entered ABANDONED:

```sql
SELECT COUNT(*) FROM "WebhookDelivery"
WHERE "updatedAt" > NOW() - INTERVAL '15 minutes'
  AND "lastStatus" = 'ABANDONED';
-- expect 0
```

## Escalate

- **Not resolved in 30 min** → notify `#aegis-oncall` lead.
- **Multiple customers reporting impact** → page status-page owner;
  post acknowledgment within 5 min.
- **Suspected payload-format compromise** (someone shipped data we
  shouldn't have to a customer endpoint) → page
  `${ESCALATION_CONTACT}` (OD-007 pending) immediately.

## Postmortem trigger

**Yes** if the failure spanned multiple customers and lasted > 30
min. **Yes** if any payload was sent that should not have been (data
classification incident). **No** for single-customer endpoint
failures that resolved on their side — log in the customer record.
