# CERNIQ — Partner Onboarding

> **Audience:** integration engineers at partner companies who have
> just signed an CERNIQ contract and want to be in production within
> 2 weeks.
> **Classification:** PUBLIC · ENGINEERING
> **Last updated:** 2026-05-05

This is the opinionated path. There are many ways to integrate CERNIQ;
this document picks the one that gets you to "first verified
production transaction" fastest with the lowest blast radius if
something goes wrong.

---

## Day 1 — pick your vertical, run the quickstart

### 1. Pick the matching example

| Your product is…                             | Start with                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| A merchant taking payments via Stripe ACP    | [`examples/acp-bridge/`](../examples/acp-bridge/)                         |
| A merchant taking payments via any other PSP | [`examples/fintech-payments/`](../examples/fintech-payments/)             |
| A treasury / banking automation team         | [`examples/banking-rails/`](../examples/banking-rails/)                   |
| An AI platform / agentic app                 | [`examples/ai-platform-tool-call/`](../examples/ai-platform-tool-call/)   |
| A SaaS provisioning agents per customer      | [`examples/saas-seat-provisioning/`](../examples/saas-seat-provisioning/) |
| Something else / not sure                    | [`examples/relying-party-verifier/`](../examples/relying-party-verifier/) |

### 2. Run the quickstart against your CERNIQ deployment

```sh
cd tools/quickstart
CERNIQ_API_BASE=<your-cerniq-url> CERNIQ_API_KEY=cerniq_sk_… pnpm start
```

You should see `✓ APPROVED` within ~5 seconds. If you see anything
else, [`docs/RUNBOOK.md`](./RUNBOOK.md) has the diagnostic tree.

### 3. Run the matching example

Each example has a `README.md` with a runbook. The flow is identical
across examples: provision agent + policy → boot a server → drive a
request from the agent simulator. Walk it once before integrating.

---

## Day 2-3 — make the four key decisions

You can't integrate well without these. Get them on paper before
writing code.

### Decision 1: Key custody — who holds the agent's private key?

**Where:** the agent itself. CERNIQ holds public keys only (invariant
1). The question is: where on YOUR side does the private key live?

| Option                                   | Best for                            | Trade-off                              |
| ---------------------------------------- | ----------------------------------- | -------------------------------------- |
| Per-process secret (env var)             | Single-binary agent, low ceremony   | Compromised host = compromised key     |
| KMS-wrapped at rest, decrypted in memory | Multi-region, multi-instance agents | Adds KMS latency to first sign         |
| HSM (YubiHSM, Nitro Enclave)             | Treasury / wires / regulated data   | Highest security, highest ops cost     |
| Per-user key (browser-side)              | Consumer-facing agents              | Cross-device sync becomes a UX problem |

The example code uses the env-var pattern for clarity. Production:
pick KMS-wrapped at minimum. CERNIQ does NOT prescribe a key custody
solution — your security team owns this.

### Decision 2: Trust score floor per action

The `minTrustScore` parameter on `cerniq.verify()` is your risk knob.
Set it per **action class**, not globally.

| Action class                | Suggested floor | Reasoning                          |
| --------------------------- | --------------- | ---------------------------------- |
| Read-only data fetch        | 400             | Reversible / low-stakes            |
| Standard commerce purchase  | 700             | The default in our examples        |
| High-ticket commerce (>$1K) | 800             | One step above default             |
| Wire / FedNow / RTP         | 800             | Irrevocable                        |
| ACH / SEPA-CT               | 650             | Reversible (R-codes / chargebacks) |
| Account credentials change  | 850             | Account takeover blast radius      |
| Admin / config changes      | 900 (or block)  | Use a different mechanism instead  |

Trust score floors should be **table-driven**, not hardcoded. Put
them in your config so a security incident lets you ratchet up
without a deploy.

### Decision 3: Policy lifetime

`expiresAt` on a policy. Trade-off:

- **Short (1h–24h)** — Stale token risk minimized; UX requires
  background refresh. Use for human-supervised agents.
- **Medium (1d–7d)** — The default for most server-to-server agents.
- **Long (30d+)** — Ergonomic but raises the cost of compromise.
  Use only with KMS-wrapped key custody + active anomaly detection.

The policy expiresAt is checked at verify time (denial reason
`POLICY_EXPIRED`). The token expiresAt (from `signAgentToken
ttlSeconds`) is independent and should be **short** (≤ 60 seconds)
regardless of policy lifetime — it's the replay defence.

### Decision 4: Webhook subscriptions to take

You should subscribe to AT LEAST these:

- `cerniq.agent.revoked` — drop the agent's session within seconds.
- `cerniq.agent.policy_expired` — refresh the policy on cue.
- `cerniq.agent.anomaly_detected` — log + page if your action class
  is high-stakes.

Subscribe via `POST /v1/webhooks` (see
[`apps/api/src/modules/webhooks/webhooks.controller.ts`](../apps/api/src/modules/webhooks/webhooks.controller.ts)).
The signing secret is shown once. Store it securely; verify HMAC on
every inbound delivery (Stripe-style: `X-CERNIQ-Signature: t=…,v1=…`).

---

## Day 4-5 — write the integration

### Pattern: composition order

```
inbound request
    ↓
[ pre-validation ]      ← shape / range / format
    ↓
[ cerniq.verify ]        ← cheap; identity errors dominate
    ↓
[ underlying system ]   ← Stripe / Modern Treasury / Plaid / etc.
    ↓
[ persist + audit ]     ← join CERNIQ auditEventId to your system id
    ↓
[ respond ]
```

CERNIQ first, underlying system second. CERNIQ is cheaper and
identity errors dominate denials in agent traffic — failing fast
saves a network round-trip and an SPT slot per rejected request.

### Pattern: idempotency end-to-end

Use the CERNIQ jti as your underlying-system idempotency key:

```ts
const verdict = await cerniq.verify({
  token: cerniqToken,
  // ...
  jti: requestIdempotencyKey, // your dedupe key — also the CERNIQ replay key
});
if (!verdict.valid) return deny(verdict.denialReason);

const charge = await stripe.charges.create({
  // ...
  idempotency_key: verdict.jti, // SAME key — single source of truth
  metadata: { cerniq_audit_event_id: verdict.auditEventId },
});
```

This is documented in [`docs/INTEGRATION_PATTERNS.md` § 11](./INTEGRATION_PATTERNS.md#11-idempotency-end-to-end).

### Pattern: storing the audit-event-id

```sql
ALTER TABLE charges ADD COLUMN cerniq_audit_event_id TEXT;
CREATE INDEX charges_cerniq_audit_event_id_idx ON charges(cerniq_audit_event_id);
```

Storing the CERNIQ auditEventId next to your row makes:

- Reconciliation a 1-line SQL JOIN.
- Forensic investigation answer "which agent did this?" instantly.
- Regulator queries "show me the agent identity for charge X" trivial.

---

## Day 6-10 — harden for production

### Wire the reconciler

```sh
# Daily cron — joins CERNIQ audit events to your charges and surfaces
# the four mismatch classes.
0 2 * * *  cd /opt/cerniq/reconciliation && pnpm cli \
             --cerniq cerniq-export.ndjson --psp charges-export.ndjson --json \
             > /var/log/cerniq-recon-$(date +%Y%m%d).json
```

See [`examples/reconciliation/`](../examples/reconciliation/). Treat
non-zero `denied_present` count as a **paging alert** — that's a
gate-bypass signal.

### Wire the audit verifier

```sh
# Weekly cron — independently confirm CERNIQ's audit chain is intact.
# This is YOUR independent verification of CERNIQ's compliance claim.
0 3 * * 0  npx @cerniq/audit-verifier verify $(latest-export) \
             --jwks https://<your-cerniq-url>/.well-known/audit-signing-key \
             --json > /var/log/cerniq-chain-$(date +%Y%m%d).json
```

If the verifier ever rejects, your CERNIQ deployment has a chain
break. SEV-1; see
[`docs/INCIDENT_RUNBOOK.md` § 1](./INCIDENT_RUNBOOK.md#1-chain-integrity-break).

### Wire the BATE feedback loop

When your reconciler flags a `reversed` row, report it back to
CERNIQ:

```ts
await cerniq.report({
  agentId,
  eventType: bateFeedback === 'fraud_confirmed' ? 'fraud_confirmed' : 'false_positive',
  severity: 'high',
  transactionId: endToEndId,
  description: `system reversal: ${reversalCause}`,
});
```

This closes the loop — over weeks of reconciliation the trust score
converges on each agent's actual reliability, not just its declared
reliability.

---

## Pre-flight checklist (ship gate)

Before you flip the feature flag in production:

### Security

- [ ] Agent private keys are NOT in env vars in production
- [ ] Verify-only key (`cerniq_vk_…`) on the verify edge, not a management key
- [ ] HMAC verification on every inbound webhook
- [ ] Token TTL ≤ 60 seconds
- [ ] Trust-score floors set per action class

### Observability

- [ ] CERNIQ auditEventId persisted on every action row
- [ ] Reconciliation cron scheduled (daily for high-volume, weekly otherwise)
- [ ] Audit-verifier cron scheduled (weekly)
- [ ] Alerting on `denied_present` reconciliation rows

### Integration

- [ ] `cerniq.verify` is checked BEFORE the underlying system call
- [ ] `cerniq jti` is reused as the underlying system's idempotency key
- [ ] Webhook subscriptions: agent.revoked + policy.expired
- [ ] BATE feedback loop wired (chargebacks → fraud_confirmed)

### Compliance

- [ ] [`docs/COMPLIANCE_BUNDLE.md`](./COMPLIANCE_BUNDLE.md) reviewed by your security team
- [ ] DPA signed (if EU customers)
- [ ] BAA signed (if HIPAA in scope; out-of-band)
- [ ] Audit-verifier added to your auditor's evidence kit

### Operational

- [ ] On-call rotation knows where [`docs/INCIDENT_RUNBOOK.md`](./INCIDENT_RUNBOOK.md) lives
- [ ] PagerDuty / Opsgenie has the CERNIQ-related alert routing rules
- [ ] Trust-score floors documented in your config repo

---

## When to ask for help

Tag #cerniq in your shared slack / send a support ticket.

**Send these in your first message:**

- The example you're starting from.
- Your vertical / use case (1 sentence).
- The decision-table answers above (key custody, trust floor, policy
  lifetime, webhook subscriptions).
- What error / verdict you're seeing.

This compresses what would be 30 minutes of back-and-forth into one
exchange.

---

## What we won't help with (and where to go instead)

| Question                             | Goes to                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| "Which PSP should we use?"           | Your finance team                                                                                       |
| "How do we handle 3DS?"              | Your PSP's documentation                                                                                |
| "Is this AML-compliant?"             | Your compliance officer                                                                                 |
| "Can CERNIQ hold our private keys?"  | No (invariant 1). KMS is the answer.                                                                    |
| "Can CERNIQ log raw card numbers?"   | No (PCI scope). Audit chain commits to hashes.                                                          |
| "How do we federate Auth0 → CERNIQ?" | [`docs/INTEGRATION_PATTERNS.md` § 8](./INTEGRATION_PATTERNS.md#8-identity-providers-auth0-clerk-workos) |

---

## Reference

- [`AGENT_BRIEFING.md`](./AGENT_BRIEFING.md) — for engineers who'll touch the CERNIQ codebase
- [`MASTER_ENGINEERING_HANDOFF.md`](./MASTER_ENGINEERING_HANDOFF.md) — the architectural big picture
- [`INTEGRATION_PATTERNS.md`](./INTEGRATION_PATTERNS.md) — full integration playbook
- [`COMPLIANCE_BUNDLE.md`](./COMPLIANCE_BUNDLE.md) — controls map
- [`INCIDENT_RUNBOOK.md`](./INCIDENT_RUNBOOK.md) — on-call playbook
- `examples/` — runnable patterns per vertical
