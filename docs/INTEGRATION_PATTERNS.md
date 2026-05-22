# OKORO — Integration Patterns

> How OKORO layers cleanly on top of the foundational systems an
> agent-driven application is already running on. Each section is a
> working pattern with the integration shape, the denial-mapping
> table, and a reference to a runnable example.

**Classification:** PUBLIC · ENGINEERING
**Last updated:** 2026-05-05
**Audience:** integration engineers, partners, security reviewers

---

## Table of contents

1. [Mental model](#1-mental-model)
2. [Stripe Agentic Commerce Protocol (ACP)](#2-stripe-agentic-commerce-protocol-acp)
3. [Generic PSPs (Adyen, Worldpay, Checkout.com)](#3-generic-psps-adyen-worldpay-checkoutcom)
4. [Card issuance (Lithic, Marqeta)](#4-card-issuance-lithic-marqeta)
5. [Banking rails (Modern Treasury, Increase, ISO 20022)](#5-banking-rails-modern-treasury-increase-iso-20022)
6. [Open banking (Plaid, Tink, MX)](#6-open-banking-plaid-tink-mx)
7. [MCP servers (Claude Desktop, Cursor, generic)](#7-mcp-servers-claude-desktop-cursor-generic)
8. [Identity providers (Auth0, Clerk, WorkOS)](#8-identity-providers-auth0-clerk-workos)
9. [KMS providers (AWS, GCP, Vault)](#9-kms-providers-aws-gcp-vault)
10. [Reconciliation pattern](#10-reconciliation-pattern)
11. [Idempotency end-to-end](#11-idempotency-end-to-end)
12. [Failure surfaces — who refuses, why, what to show the user](#12-failure-surfaces)

---

## 1. Mental model

OKORO sits **between** an agent and the system it acts on. It is
**additive** to whatever you're already running:

```
   ┌─Agent─────┐    ┌─OKORO────┐    ┌─Your underlying system─┐
   │           │    │          │    │                         │
   │ signs JWT │───►│ verify   │───►│ Stripe / bank / Lithic /│
   │           │    │ identity │    │ Plaid / your DB / your  │
   │ has key   │    │ + policy │    │ MCP server / etc.       │
   │           │    │ + trust  │    │                         │
   └───────────┘    │ + audit  │    │                         │
                    └──────────┘    └─────────────────────────┘
```

The pattern is consistent across every section below:

1. **The underlying system answers its own question.** Stripe
   answers "is this card good?", Modern Treasury answers "is the
   wire deliverable?", Lithic answers "is this issued card alive?".
2. **OKORO answers "is THIS agent authorized to do THIS action right
   now?".** Identity (cryptographic), policy (signed JWT), trust
   (BATE score), audit (signed chain).
3. **You compose them.** OKORO first (cheaper, identity errors
   dominate), then the underlying system. Failures from either side
   produce a structured denial response. Both produce audit trails
   that share an `endToEndId` so reconciliation is automatic.

---

## 2. Stripe Agentic Commerce Protocol (ACP)

**The problem ACP solves:** payment authorization for agents.
**The slot OKORO fills:** which agent, scoped to what, with what
trust, signed in what audit log.

### Pattern

The merchant API receives **two** tokens:

- `paymentToken` — Stripe Shared Payment Token (SPT) representing the
  cardholder's authorization for an amount + currency.
- `okoroToken` — OKORO-signed agent token representing the agent's
  identity + policy + per-tx claims.

Both must pass before the merchant calls `stripe.charges.create`.
OKORO is checked first.

### Code shape

```ts
const okoroVerdict = await okoro.verify({ token: okoroToken, ... });
if (!okoroVerdict.valid) return deny('okoro', okoroVerdict.denialReason);

const sptVerdict = await stripe.paymentMethods.verify(paymentToken, { amount });
if (!sptVerdict.valid) return deny('stripe', sptVerdict.errorCode);

const charge = await stripe.charges.create({
  amount,
  currency,
  source: paymentToken,
  idempotency_key: okoroVerdict.jti,        // single key end-to-end
  metadata: { okoro_audit_event_id: okoroVerdict.auditEventId },
});
```

### Cross-check: `payerUserId` ↔ `principalId`

If your IdP federation maps Stripe customers to OKORO principals
(Auth0 / Clerk / WorkOS will), assert that the SPT was issued to a
user that owns the agent's principal:

```ts
if (mapPrincipalToUser(okoroVerdict.principalId) !== sptVerdict.payerUserId) {
  await okoro.report({ agentId, eventType: 'suspicious_behavior',
                       severity: 'critical',
                       description: 'SPT payer ↔ OKORO principal mismatch' });
  return deny('payer_mismatch');
}
```

### Reference

- Runnable example: [`examples/acp-bridge/`](../examples/acp-bridge/)
- Master handoff §6.2

---

## 3. Generic PSPs (Adyen, Worldpay, Checkout.com)

PSPs that don't yet implement ACP carry only the cardholder leg of
authorization. The pattern collapses to a **single-token gate**: OKORO
verifies the agent, the PSP charges the card. The merchant is the
glue.

### Code shape

```ts
const okoroVerdict = await okoro.verify({ token: okoroToken, ... });
if (!okoroVerdict.valid) return deny('okoro', okoroVerdict.denialReason);

const charge = await psp.payments.create({
  amount, currency,
  paymentMethod: cardToken,            // your existing tokenization
  reference: okoroVerdict.jti,         // for the PSP-side trace
  metadata: { okoro_audit_event_id: okoroVerdict.auditEventId },
});
```

### Reference

- Runnable example: [`examples/fintech-payments/`](../examples/fintech-payments/)

---

## 4. Card issuance (Lithic, Marqeta)

**The problem issued-card platforms solve:** programmatic card
provisioning, real-time authorization, spend controls at the card
level.
**The slot OKORO fills:** before authorizing a spend on an issued
card, verify which agent triggered the spend and that the policy
permits the merchant. Especially useful for B2B "agent has its own
virtual card" patterns.

### Pattern

Lithic / Marqeta's auth-stream lets you reject a transaction in
real-time. Hook your auth handler:

```ts
async function onCardAuthorization(authReq: LithicAuthRequest): Promise<AuthDecision> {
  // 1. Look up the agent that owns this card.
  const agentId = await lookupAgentByCardId(authReq.card_token);
  if (!agentId) return { decision: 'DECLINE', reason: 'unknown_card_owner' };

  // 2. Mint an OKORO verify call from the auth context.
  const okoroVerdict = await okoro.verifyServerInitiated({
    agentId,
    action: 'commerce.purchase',
    amount: authReq.amount,
    currency: authReq.currency,
    merchantDomain: authReq.merchant.descriptor,
    minTrustScore: 700,
  });

  return okoroVerdict.valid ? { decision: 'APPROVE' } :
                              { decision: 'DECLINE', reason: okoroVerdict.denialReason };
}
```

### Why this is high-value

Issued cards are the longest-lived agent-facing credential a system
can have. A single compromised auth handler can authorize unlimited
fraud. Putting OKORO in the auth-stream means a revoked agent stops
spending **at the next authorization**, not at the next batch
settlement.

### Denial mapping table (Lithic)

| OKORO denialReason     | Lithic decline_reason       |
|------------------------|-----------------------------|
| AGENT_NOT_FOUND        | UNAUTHORIZED_USER           |
| AGENT_REVOKED          | UNAUTHORIZED_USER           |
| INVALID_SIGNATURE      | UNAUTHORIZED_USER           |
| POLICY_REVOKED         | INSUFFICIENT_FUNDS *        |
| POLICY_EXPIRED         | INSUFFICIENT_FUNDS *        |
| SCOPE_NOT_GRANTED      | MERCHANT_BLOCKED            |
| SPEND_LIMIT_EXCEEDED   | LIMIT_EXCEEDED              |
| TRUST_SCORE_TOO_LOW    | UNAUTHORIZED_USER           |
| ANOMALY_FLAGGED        | SUSPECTED_FRAUD             |

\* Lithic doesn't have a "policy expired" code; the closest semantic
is "this card has no buying power for this transaction".

---

## 5. Banking rails (Modern Treasury, Increase, ISO 20022)

**The problem banking rails solve:** moving money between accounts.
**The slot OKORO fills:** identity + policy + trust on the agent
authorizing the movement. Critical for treasury automation.

### Per-rail trust floor

| Rail            | Min trust | Reversible? | Settlement     |
|-----------------|-----------|-------------|----------------|
| wire / FedNow / RTP | 800   | no          | T+0 (instant)  |
| sepa-instant    | 750       | no          | T+0 (10s)      |
| sepa-ct         | 700       | partial     | T+0 / T+1      |
| ach             | 650       | yes (R-codes) | T+1          |
| book-transfer   | 500       | yes (ledger) | T+0 (internal)|

The floor matches the rail's reversibility profile. Tune per
operator risk appetite.

### `endToEndId` end-to-end

ISO 20022's `EndToEndId` propagates through every message in the
lifecycle. Reuse it as the OKORO jti and the bank-side trace
identifier:

```
   OKORO jti  =  ISO 20022 EndToEndId  =  bank-side trace number
       |                |                          |
       └─audit row──────┴─pacs.002 ack─────────────┴─camt.054 settlement
```

This is the single value that lets you reconcile OKORO audit events
to bank settlement records without a join table.

### Reference

- Runnable example: [`examples/banking-rails/`](../examples/banking-rails/)
- ISO 20022: <https://www.iso20022.org/iso-20022-message-definitions>

---

## 6. Open banking (Plaid, Tink, MX)

**The problem open banking solves:** read-side connectivity to the
user's bank accounts (balance, transactions, account holder).
**The slot OKORO fills:** which agent is reading what, why, with
what data scope, signed in what audit log.

### Pattern

Open banking calls happen on `data-read` OKORO scope, not `commerce`.
The policy gates which financial-account types the agent can read,
which fields, and how often.

```ts
async function getBalance(agentToken: string, accountId: string) {
  const okoroVerdict = await okoro.verify({
    token: agentToken,
    action: { kind: 'data-read', payload: { resource: 'plaid:balance', accountId } },
    minTrustScore: 600,
  });
  if (!okoroVerdict.valid) throw deny(okoroVerdict.denialReason);
  return plaid.accountsBalanceGet({ access_token, account_ids: [accountId] });
}
```

### PII redaction interplay

Open banking responses contain PII (account numbers, addresses).
OKORO's audit chain stamps a SHA-256 commitment of the response
shape, not the response body — see ADR-0006 audit redactability.
That keeps the chain verifiable while letting you redact PII per
GDPR Art. 17 without breaking the signature.

### Reference

- ADR-0006 audit redactability
- `docs/RETENTION_POLICY.md` § GDPR pathway

---

## 7. MCP servers (Claude Desktop, Cursor, generic)

**The problem MCP solves:** universal tool-call wire format across
LLM hosts.
**The slot OKORO fills:** cryptographic identity for the agent
calling MCP tools. MCP carries the call shape, but not WHO is
calling.

### Pattern — `@okoro/mcp-bridge`

Wrap any MCP server in one line:

```ts
import { wrap } from '@okoro/mcp-bridge';
import { myMcpServer } from './my-server.js';

export default wrap(myMcpServer, {
  okoroVerifyKey: process.env.OKORO_VERIFY_KEY,
  minTrustScore: 700,
});
```

Every tool call now requires:

- `_okoro_token` arg (the agent's signed JWT for this call), or
- `Authorization: Bearer <okoro-token>` header for HTTP transport

The bridge calls `okoro.verify` before invoking the wrapped tool.
Denials surface as MCP errors with the OKORO denial reason in the
error data.

### Why this is the distribution wedge

Every popular MCP server (GitHub, Stripe, Linear, Notion, Filesystem)
that adopts `@okoro/mcp-bridge` becomes an OKORO relying party. Each
one drives developer signups for OKORO in turn.

### Reference

- Master handoff §6.1
- Runnable example: [`examples/ai-platform-tool-call/`](../examples/ai-platform-tool-call/)

---

## 8. Identity providers (Auth0, Clerk, WorkOS)

**The problem IdPs solve:** human authentication and SSO.
**The slot OKORO fills:** the agent identity layer **above** the
IdP's user identity. OKORO principals federate to IdP organizations.

### Pattern — `IdpAdapter` interface

OKORO has three shipped adapters: Auth0, Clerk, WorkOS. They
implement `IdpAdapter`:

```ts
interface IdpAdapter {
  verifyToken(token: string): Promise<IdpVerifyResult>;
  resolvePrincipal(verified: IdpVerifyResult): Promise<{ principalId: string }>;
}
```

The dashboard / API uses the configured adapter to convert an IdP
session into an OKORO principal scope. Each OKORO API key, agent,
and policy is principal-scoped.

### Federation mapping

| IdP                  | Maps to OKORO principal via |
|----------------------|-----------------------------|
| Auth0                | `org_id` claim              |
| Clerk                | `org.id` from session       |
| WorkOS               | `organization_id` from sealed session |

When a user signs in, OKORO finds (or auto-provisions) the principal
for their org_id. That's the user's blast-radius for OKORO-side
access — they can see their org's agents, not other orgs'.

### Reference

- ADRs 0009 (IdP) + 0009-A (Clerk) + 0009-B (WorkOS implicit)
- `apps/api/src/modules/auth0/` (and sibling `idp-clerk`, `idp-workos`)

---

## 9. KMS providers (AWS, GCP, Vault)

**The problem KMS solves:** centralized key custody, audited usage,
HSM-backed signing.
**The slot OKORO fills:** OKORO's audit-chain signing key (the
`AUDIT` purpose) routes through a `KmsAdapter` so the private key
never leaves the KMS HSM. The public key is what's published at
`/.well-known/audit-signing-key`.

### Adapter selection

`OKORO_KMS_PROVIDER=aws|gcp|vault|env` selects the adapter at boot:

| Provider | Algo | Native EdDSA? | Notes |
|----------|------|---------------|-------|
| `aws`    | Ed25519 | not yet       | Envelope-encrypted Ed25519 (KMS Decrypt + local Sign). Rotate by re-wrapping. |
| `gcp`    | Ed25519 | yes           | `asymmetricSign` direct. |
| `vault`  | Ed25519 | yes           | `transit/sign` HTTP. |
| `env`    | Ed25519 | n/a           | Dev only. Reads `OKORO_SIGNING_PRIVATE_KEY` from env. |

### JWKS publication

The `kid` from `KmsAdapter.getActiveKey('AUDIT')` is stamped on every
audit row (`signingKeyId`). The same `kid` appears in the JWKS at
`/.well-known/audit-signing-key`. During a rotation window, both the
old and new keys appear in the JWKS so in-flight audit rows remain
verifiable.

### Reference

- ADR-0011 KMS adoption
- `apps/api/src/modules/kms/` adapters

---

## 10. Reconciliation pattern

A real production system reconciles OKORO audit events to the
underlying system's record-of-truth. The shape is consistent:

```
   ┌─OKORO audit events──┐    ┌─Your system's records──┐
   │ endToEndId = X      │    │ trace_id = X            │
   │ okoro_event_id      │    │ stripe_charge_id        │
   │ decision = approved │    │ status = settled        │
   └─────────────────────┘    └─────────────────────────┘
                  │                       │
                  └─ JOIN ON endToEndId ──┘
                              │
                              ▼
                   ┌─Reconciliation report──┐
                   │ • approved + settled   │ ← happy path
                   │ • approved + missing   │ ← OKORO approved, system never saw — investigate
                   │ • denied + present     │ ← system charged after OKORO denial — bug or attack
                   │ • approved + reversed  │ ← chargeback / R-code; report back to BATE
                   └────────────────────────┘
```

**Cadence:** daily for low-volume, hourly for high-stakes (treasury).

**Action on mismatch:** the "approved + missing" and "denied +
present" rows are both load-bearing for fraud detection. Surface
them to a human. The "approved + reversed" rows feed back into BATE
as a `fraud_confirmed` or `false_positive` signal so the trust score
learns from real-world outcomes.

### Reference

- `docs/CAPACITY_PLAN.md` § Audit storage
- BATE signal types `BateSignalType` enum

---

## 11. Idempotency end-to-end

Every OKORO verify request carries a `jti` (JWT ID, ULID-shape).
The jti has three uses end-to-end:

1. **OKORO replay defence** — same jti within the replay window
   denies as `INVALID_SIGNATURE`.
2. **Underlying-system idempotency-key** — Stripe `idempotency_key`,
   PSP `reference`, ISO 20022 `EndToEndId`.
3. **Reconciliation join key** — the value that links OKORO audit
   to the system's settlement record.

This is the pattern: **one ULID, three roles, end-to-end safety.**
If your retry layer mints a fresh jti per attempt (which OKORO's
replay cache requires), you also get a fresh idempotency-key per
attempt. If you reuse the jti, OKORO denies and the underlying
system returns the cached prior response — correct in both cases.

---

## 12. Failure surfaces

**Where each layer can refuse and what to show the user.**

| Layer       | Reason class           | Suggested user message                          |
|-------------|------------------------|-------------------------------------------------|
| OKORO       | AGENT_NOT_FOUND        | "This agent isn't recognized — try signing in." |
| OKORO       | AGENT_REVOKED          | "Your access has been revoked. Contact support."|
| OKORO       | INVALID_SIGNATURE      | "Signature check failed. Try again."            |
| OKORO       | POLICY_REVOKED / EXPIRED | "Your authorization expired. Re-authorize."   |
| OKORO       | SCOPE_NOT_GRANTED      | "Not allowed for this kind of action."          |
| OKORO       | SPEND_LIMIT_EXCEEDED   | "Over your spend limit for the day."            |
| OKORO       | TRUST_SCORE_TOO_LOW    | "Your account needs review. We've notified you."|
| OKORO       | ANOMALY_FLAGGED        | "Unusual activity detected. Try again later."   |
| Stripe SPT  | spt_amount_exceeded    | "Authorized amount is lower than this charge."  |
| Stripe SPT  | spt_expired            | "Your payment authorization expired."           |
| Stripe SPT  | spt_currency_mismatch  | "Currency doesn't match your authorization."    |
| PSP charge  | card_declined          | "Card declined. Try a different card."          |
| Bank rail   | rail_cutoff_passed     | "Submission window closed. Try again tomorrow." |
| Bank rail   | invalid_routing        | "Routing details rejected by the bank."         |
| Open banking| consent_revoked        | "You've removed our access. Re-link."           |
| MCP bridge  | tool_not_authorized    | "This tool isn't in your policy scope."         |

The full denial-reason translation table for PR / LATAM (Spanish)
lives in `docs/OKORO_AS_BACKBONE.md` § 5.

---

## Appendix: integration matrix

| System             | OKORO scope        | Min trust default | Example                       |
|--------------------|--------------------|-------------------|-------------------------------|
| Stripe ACP         | commerce           | 700               | `examples/acp-bridge/`        |
| Generic PSP        | commerce           | 700               | `examples/fintech-payments/`  |
| Card issuance      | commerce           | 700               | (this doc § 4)                |
| Banking — wire     | commerce           | 800               | `examples/banking-rails/`     |
| Banking — ach      | commerce           | 650               | `examples/banking-rails/`     |
| Open banking       | data-read          | 600               | (this doc § 6)                |
| MCP server         | depends on tool    | 700               | `examples/ai-platform-tool-call/` |
| SaaS provisioning  | data-write         | 600               | `examples/saas-seat-provisioning/` |

Add a row for every new vertical. Operators set their own thresholds
via env or per-policy `minTrustScore` overrides.
