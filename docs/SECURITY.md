# AEGIS — Security model & threat analysis

> AEGIS is a security product. Bugs here have asymmetric downside.
> Every change to this document or to crypto code requires a second pair
> of eyes, even from a peer Claude session — message the operator first.

---

## 1. Asset inventory

| Asset                         | Sensitivity | Where it lives                | Compromise impact        |
|-------------------------------|-------------|-------------------------------|--------------------------|
| Agent **public** keys         | Low         | Postgres, Redis cache         | None                     |
| Agent **private** keys        | (NOT HELD)  | client-side only              | Customer-side incident   |
| AEGIS audit signing key       | Critical    | env var, KMS in prod          | Audit chain forgery      |
| AEGIS JWT signing key         | Critical    | env var, KMS in prod          | Forged policy tokens     |
| API keys (developers)         | High        | bcrypt(cost=12) in Postgres   | Account takeover         |
| Verify-only keys              | Medium      | bcrypt in Postgres            | Read-only verify spam    |
| Stripe webhook secret         | High        | env var                       | Billing forgery          |
| Webhook subscription secrets  | High        | Postgres (encrypted at rest)  | Customer-side forgery    |
| Audit events                  | Confidential| Postgres (append-only)        | Compliance / privacy     |
| BATE signal history           | Internal    | Postgres                      | Anti-fraud reverse-eng   |

---

## 2. Trust boundaries

```
            ┌────────────────────────┐
            │  Untrusted internet     │
            └──────────┬─────────────┘
                       │  TLS 1.3 only, HSTS
                       ▼
            ┌────────────────────────┐
            │  Cloudflare WAF + DDoS  │   (Phase 3)
            └──────────┬─────────────┘
                       ▼
            ┌────────────────────────┐
            │  AEGIS API (Railway)    │   ← API key auth required
            └──────────┬─────────────┘
                       ▼
       ┌───────────────┴────────────┐
       │ Internal trusted plane     │   ← VPC peering only
       │ Postgres + Redis           │
       └────────────────────────────┘
```

**Inbound**: every request crossing into the API layer **must** carry
either `X-AEGIS-API-Key` (full) or `X-AEGIS-Verify-Key` (verify-only),
*except* `/health`, `/`, `/docs`, `/v1/agents/:id/status`, and
`/.well-known/*`. Health endpoints never depend on Redis/DB and never
expose principal data.

---

## 3. Cryptographic choices (and the reasons)

| Use                             | Algorithm           | Library             | Why this not that                              |
|---------------------------------|---------------------|---------------------|------------------------------------------------|
| Agent identity                  | Ed25519             | `@noble/ed25519`    | Fast, small keys, modern, zero malleability    |
| AEGIS JWT signing               | EdDSA over Ed25519  | `jose`              | Same curve as identity, audited                |
| Audit chain signature           | Ed25519             | `@noble/ed25519`    | Reuse curve, deterministic signatures          |
| API key hashing                 | bcrypt cost 12      | `bcryptjs`          | Industry standard, cheap to verify             |
| Webhook signature               | HMAC-SHA256         | `node:crypto`       | Stripe-style, easy for customers to verify     |
| Token IDs / nonces              | crypto.randomUUID() | `node:crypto`       | Native, cryptographically secure               |

We **deliberately do not** use:

- **RSA** — slower, larger keys, no benefit for our use case.
- **secp256k1** — solid but ecosystem lock-in to crypto-currency tooling.
- **HS256 JWTs** — symmetric secrets force every verifier to share a key.
- **Hand-rolled crypto** — period.

---

## 4. Key handling rules

1. **AEGIS private keys are never logged.** The Pino redaction list in
   `app.module.ts` blocks header tokens; environment-variable private
   keys must never appear in logs by name (`audit_signing.b64` etc.).
2. **Production keys live in Railway secrets / KMS**, not in `.env`.
   `.env` is for local development with throwaway dev keys.
3. **Key rotation** is planned via `/v1/.well-known/audit-signing-key`
   exposing a JWKS array (current + previous), so verifiers can validate
   historical signatures while we cut over.
4. **Customer-uploaded public keys are validated** at registration time:
   length, encoding, and a challenge-response handshake (M-003) prevent
   typo'd or attacker-substituted keys from being trusted.

---

## 5. Multi-tenant isolation

- Every model that belongs to a principal carries `principalId`.
- Every service method receives `principalId: string` as the first
  argument and adds it to the `where:` clause.
- The `ApiKeyGuard` populates `req.principal = { id, planTier }` and
  controllers must read from there, never from path/query.
- Cross-principal queries (e.g. relying-party reports about an agent
  belonging to a different principal) are explicit and audited — they
  never lift the isolation accidentally.

A future Postgres Row-Level Security policy is planned but not relied on
for v1 (defense in depth is good but app-layer enforcement comes first).

---

## 6. Denial precedence (the order that wins)

When `/v1/verify` rejects a request, the response carries **exactly one**
`denialReason`. The order below is the precedence — the first applicable
reason wins. **This order is part of the public API**; relying parties
build retry/escalation logic on it. Changing it is a breaking change.

`PLAN_LIMIT_EXCEEDED` is a **billing pre-gate** that fires BEFORE the
algorithm chain — it is not part of the 10-step chain but is included
in the `denialReason` enum so relying parties can match it cleanly.

0. `PLAN_LIMIT_EXCEEDED` — billing pre-gate; principal exhausted the
   monthly verify quota for their paid plan. Direct user to upgrade.
   *(Position 0 — fires before the algorithm runs.)*

The 10-step algorithm chain (top wins, fires only if PLAN_LIMIT_EXCEEDED
is not triggered):

1. `AGENT_NOT_FOUND` — token's `sub` claim doesn't resolve.
2. `AGENT_REVOKED` — agent record exists but `status = REVOKED`.
3. `INVALID_SIGNATURE` — token signature fails verification.
4. `POLICY_REVOKED` — policy referenced by token has been revoked.
5. `POLICY_EXPIRED` — policy `expiresAt < now()`.
6. `SCOPE_NOT_GRANTED` — requested action/category not in policy scopes.
7. `TRIAL_EXHAUSTED` — free-trial principal has consumed the lifetime
   10K-verify cap (ADR-0014). Direct user to a paid plan.
   *(Added 2026-05-05 between SCOPE_NOT_GRANTED and SPEND_LIMIT_EXCEEDED.)*
8. `SPEND_LIMIT_EXCEEDED` — request amount + period total > policy limit.
9. `TRUST_SCORE_TOO_LOW` — agent score below relying-party threshold (if
   relying party supplied a `minTrustScore` in the request).
10. `ANOMALY_FLAGGED` — BATE has set a flag forcing rejection.

Why this order: identity issues before policy issues before behavioral
issues. A revoked agent should never see a "scope" denial — that would
leak that the scope evaluation logic ran on revoked agents.

`TRIAL_EXHAUSTED` sits after `SCOPE_NOT_GRANTED` because trial
exhaustion is a billing-tier gate that should fire only when the
agent's identity, policy, and scope have already validated cleanly —
otherwise we'd leak "this trial is exhausted" to a caller whose token
was never going to be accepted anyway.

---

## 7. Rate limiting

- **Per API key**: 1000 verify/minute (configurable). 120 default per
  minute for non-verify endpoints.
- **Per IP** (Cloudflare layer, Phase 3): 10000 req/min hard cap to
  prevent credential stuffing.
- **Per principal global**: enforced by the BullMQ rate limiter on the
  webhook delivery path so a misbehaving subscriber can't starve others.

---

## 8. Audit chain integrity

See `docs/ARCHITECTURE.md` § "The audit chain". Threat model:

| Threat                        | Mitigation                                       |
|-------------------------------|--------------------------------------------------|
| Insider tampers with a row    | Signature breaks; chain check at export catches  |
| Insider replaces signature    | Prev-hash includes signature; chain still breaks |
| Insider replaces whole chain  | We publish hourly chain head to a public log     |
| AEGIS signing key compromised | KMS rotation + revocation list at /.well-known/   |

---

## 9. Webhook integrity (signed delivery + locked payload shapes)

Webhook deliveries are HMAC-signed and ship a Zod-locked JSON body. The
on-wire envelope is:

```text
POST <subscriber-url>
Content-Type: application/json
X-AEGIS-Signature: t=<unix-ts>,v1=<hex-hmac-sha256>
X-AEGIS-Event:     <event-type>            // e.g. aegis.agent.trust_score_changed
X-AEGIS-Delivery-Id: <delivery-uuid>

{
  "id":    "<delivery-uuid>",   // matches X-AEGIS-Delivery-Id
  "event": "<event-type>",      // matches X-AEGIS-Event
  "data":  { ... },             // event-type-specific shape; see below
  "ts":    <unix-ts>            // matches the `t=` field in the signature header
}
```

**Subscriber-side verification — verify against the raw HTTP body bytes,
never a re-serialization.** Stripe-style:

1. Read the literal request body as bytes (or a UTF-8 string) — exactly as
   delivered. Do not parse-and-re-stringify it; do not pretty-print it; do
   not let your framework strip whitespace. Even a single byte of drift
   breaks HMAC equality.
2. Parse `X-AEGIS-Signature: t=<ts>,v1=<hex>` and reject the request if
   `|now - ts| > 300` seconds (replay defense — AEGIS does NOT enforce this
   server-side, the signature proves authenticity, not freshness).
3. Compute `expected = hex(HMAC_SHA256(secret, ts + "." + rawBody))` and
   compare to `v1` using a constant-time comparison (`crypto.timingSafeEqual`
   in Node, `hmac.compare_digest` in Python). Reject on mismatch.
4. Only after the signature checks out, parse the body as JSON and route on
   the `event` field.

The canonical envelope key order is `id, event, data, ts` — locked by
`WebhookDeliveryWorker.buildEnvelope()`
([webhook.delivery.ts](../apps/api/src/modules/webhooks/webhook.delivery.ts))
and asserted byte-equivalent by
[tests/cross-package/webhook-payload-parity.spec.ts](../tests/cross-package/webhook-payload-parity.spec.ts).
Subscribers that follow the "raw body bytes" rule above are insensitive to
key order; the canonical order matters for downstream tooling (CLI dumps,
regulator exports, schema diffing).

### 9.1 Event types and payload schemas

`data` shapes are the single source of truth in
[`packages/types/src/webhooks.ts`](../packages/types/src/webhooks.ts). The
producer types its return value from the schema, the API validates at emit
time, and a cross-package parity spec
([`tests/cross-package/webhook-payload-parity.spec.ts`](../tests/cross-package/webhook-payload-parity.spec.ts))
asserts the round-trip in CI.

| Event type                          | `data` shape (Zod schema)                    | Producer                                          |
|-------------------------------------|----------------------------------------------|---------------------------------------------------|
| `aegis.agent.trust_score_changed`   | `WebhookTrustScoreChangedPayloadSchema`      | `BateRecomputeWorker` (band transitions only)     |
| `aegis.policy.expired`              | `WebhookPolicyExpiredPayloadSchema`          | `PolicyExpiryWorker` sweep                        |
| `aegis.agent.revoked`               | RESERVED — no schema, no producer yet        | (planned; subscribers cannot rely on shape)       |
| `aegis.anomaly.detected`            | RESERVED — no schema, no producer yet        | (planned)                                         |
| `aegis.agent.flagged_by_relying_party` | RESERVED — no schema, no producer yet     | (planned)                                         |

Adding a producer for a RESERVED event MUST move the entry from
`WEBHOOK_PAYLOAD_RESERVED` to `WEBHOOK_PAYLOAD_SCHEMA` in the same change.
Emitting a reserved event throws `WebhookPayloadValidationError` and the
service drops the delivery — fail-loud at the schema boundary.

### 9.2 Production observability

Contract violations caught at runtime emit the labeled counter
`aegis_webhook_payload_drift_total{event, reason}`. `reason` partitions the
failure mode so alerts can route correctly:

| `reason` value      | Where caught                                  | Severity |
|---------------------|-----------------------------------------------|----------|
| `shape_mismatch`    | `WebhooksService.enqueue` (Zod parse fails)   | P1       |
| `envelope_corrupt`  | `WebhookDeliveryWorker.assertEnvelopeIntegrity` (DB-level corruption between enqueue and delivery) | P1       |
| `reserved`          | `WebhooksService.enqueue` (event has no schema yet) | P2/P3    |
| `unknown_event`     | `WebhooksService.enqueue` (event not in `WEBHOOK_EVENT`) | P3       |

Drift in production should be zero — the cross-package parity spec is the
CI gate that prevents it. A non-zero rate means either a producer was
shipped that bypassed CI, the DB was edited manually, or a schema
tightening out-lasted a queued delivery row. None of these auto-recover;
each warrants a human looking at the offending row before re-enabling
delivery for the affected subscription.

### 9.3 Secrets and SSRF

- Per-subscription HMAC secret is returned to the operator exactly once at
  subscribe time; we persist only the AES-256-GCM ciphertext
  (`WebhookSecretCipher`). Decryption failures during delivery hard-ABANDON
  the row rather than risking a forged signature header.
- All outbound delivery requests pass `checkSsrf()` — private, loopback, and
  link-local addresses are blocked even when the customer registers a URL
  pointing at them. SSRF rejection is permanent (no retry).
- Pre-2026-05-12 drift: `WEBHOOK_EVENT.AGENT_POLICY_EXPIRED` was declared as
  `aegis.agent.policy_expired` but the producer always shipped
  `aegis.policy.expired`. Subscribers wiring up via the constant got
  never-firing subscriptions. Resolved by renaming the constant to
  `WEBHOOK_EVENT.POLICY_EXPIRED` with value `aegis.policy.expired` (matching
  producer and dashboard), and adding the parity spec above so the same
  class of drift cannot recur silently.

---

## 10. Threat scenarios (abridged)

### T-1: Stolen developer API key
Attacker registers agents under victim's principal, runs up bills.
**Mitigation**: bcrypt slows brute force; per-key rate limit; audit
events surface anomalous IP/UA in dashboard; revoke endpoint instant.

### T-2: Replay attack on `/v1/verify`
Attacker captures a signed agent token and replays it.
**Mitigation**: tokens carry `nonce` + `iat`; verifier rejects tokens
with `iat < now() - 15min`. Spend counters increment per-call; replays
that pass time check still consume quota.

### T-3: Revoked agent continues to verify
Attacker keeps using a revoked agent's signed token.
**Mitigation**: revoke endpoint busts cache synchronously before
returning. Stale cache window in worst case = 60s, but typically <2s
because revoke writes a Redis SET in addition to invalidate.

### T-4: Forged BATE signal
Attacker submits fake `RELYING_PARTY_FRAUD_REPORT` to drop a
competitor's trust score.
**Mitigation**: `RelyingParty.reportWeight` defaults to 0.0 for
unverified reporters. Verified reporters require domain validation
(DNS TXT record). Signal score deltas capped per source per day.

### T-5: Audit log gap (silent failure)
Verify succeeds but audit write fails, leaving no record.
**Mitigation**: audit append is in the same transaction as the spend
counter increment when possible; otherwise a BullMQ "audit pending"
queue with DLQ. Verify response includes `auditEventId` so the relying
party can detect a gap if missing.

---

## 11. What we deliberately *do not* protect against

- **Compromised customer infrastructure**: if the developer's environment
  is owned, their keys are owned. We provide audit trails to detect, not
  prevent.
- **Quantum attacks against Ed25519**: future migration plan only.
- **Denial of service against a single agent**: a competitor flooding
  one agent with fake signals raises ops cost, not direct security risk;
  rate-limited per source.
