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

1. `AGENT_NOT_FOUND` — token's `sub` claim doesn't resolve.
2. `AGENT_REVOKED` — agent record exists but `status = REVOKED`.
3. `INVALID_SIGNATURE` — token signature fails verification.
4. `POLICY_REVOKED` — policy referenced by token has been revoked.
5. `POLICY_EXPIRED` — policy `expiresAt < now()`.
6. `SCOPE_NOT_GRANTED` — requested action/category not in policy scopes.
7. `SPEND_LIMIT_EXCEEDED` — request amount + period total > limit.
8. `TRUST_SCORE_TOO_LOW` — agent score below relying-party threshold (if
   relying party supplied a `minTrustScore` in the request).
9. `ANOMALY_FLAGGED` — BATE has set a flag forcing rejection.

Why this order: identity issues before policy issues before behavioral
issues. A revoked agent should never see a "scope" denial — that would
leak that the scope evaluation logic ran on revoked agents.

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

## 9. Threat scenarios (abridged)

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

## 10. What we deliberately *do not* protect against

- **Compromised customer infrastructure**: if the developer's environment
  is owned, their keys are owned. We provide audit trails to detect, not
  prevent.
- **Quantum attacks against Ed25519**: future migration plan only.
- **Denial of service against a single agent**: a competitor flooding
  one agent with fake signals raises ops cost, not direct security risk;
  rate-limited per source.
