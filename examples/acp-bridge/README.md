# `acp-bridge` — AEGIS + Stripe Agentic Commerce Protocol (ACP)

The dual-verify merchant pattern. An inbound charge carries **two**
tokens; both must pass before the merchant calls Stripe `charges.create`:

```
  Stripe Shared Payment Token (SPT)   →  is the cardholder authorized for $X?
  AEGIS-signed agent token            →  is the agent the one the cardholder
                                          authorized, is the policy live, has
                                          its behavior been trustworthy?
```

ACP solved the payment leg. AEGIS solves the agent leg. Both questions
must be answered "yes" before the merchant charges. This example is
the §6.2 integration shape from `docs/MASTER_ENGINEERING_HANDOFF.md`,
made runnable end-to-end.

## Why this composition

A merchant that adopts ACP without AEGIS has no way to distinguish:

- the agent the cardholder _actually_ authorized last week, vs.
- a different agent that obtained the SPT via a leaked session, replay,
  or a compromised app token.

Stripe's SPT proves "this token represents that user's intent to spend
up to $X with this merchant for the next N minutes." It does **not**
prove which agent presented the token. That's the slot AEGIS fills.

## The flow

```
  ┌─Agent (with private key)────┐    ┌─Merchant API (this example)────┐
  │                              │    │                                 │
  │  has SPT from Stripe ACP     │    │  POST /api/charge               │
  │  signs AEGIS token client-   │───►│   { paymentToken, aegisToken,   │
  │   side; pkey never leaves    │    │     amount, currency, … }       │
  │                              │    │                                 │
  └──────────────────────────────┘    │  1. aegis.verify(aegisToken)    │
                                      │      → identity + policy + trust│
                                      │  2. spt.verify(paymentToken)    │
                                      │      → amount / currency / exp  │
                                      │  3. stripe.charges.create(...)  │
                                      │      idempotency-key = aegisJti │
                                      └─────────────────────────────────┘
```

Both gates are **fail-closed**. AEGIS is checked first because it's
cheaper and identity errors dominate denials in agent traffic. If AEGIS
denies, we never call Stripe — saves a round-trip and an SPT slot.

## Run

```sh
cd examples/acp-bridge
pnpm install

# 1. Provision the agent + policy out of band (CLI or dashboard).
aegis agents register --runtime CUSTOM --label "checkout-bot-v1" --generate-keypair > agent.json
AGENT_ID=$(jq -r .agentId agent.json)
POLICY_ID=$(aegis policy create --agent "$AGENT_ID" \
              --scope commerce \
              --max-per-tx 100.00 \
              --domain acme-checkout.com \
              --expires-in 30d --json | jq -r .policyId)
PKEY=$(jq -r .privateKey agent.json)

# 2. Boot the merchant API.
AEGIS_VERIFY_KEY=aegis_vk_... \
MERCHANT_DOMAIN=acme-checkout.com \
MIN_TRUST_SCORE=700 \
pnpm tsx src/server.ts &

# 3. Drive a charge from the agent.
AEGIS_AGENT_ID=$AGENT_ID \
AEGIS_POLICY_ID=$POLICY_ID \
AEGIS_AGENT_PRIVATE_KEY=$PKEY \
pnpm tsx src/agent-sim.ts --amount 4900 --currency USD
```

Walk all four scenarios (happy path + each denial branch):

```sh
AEGIS_AGENT_ID=$AGENT_ID \
AEGIS_POLICY_ID=$POLICY_ID \
AEGIS_AGENT_PRIVATE_KEY=$PKEY \
pnpm tsx src/walk-flow.ts http://localhost:3002
```

## Idempotency end-to-end

The example uses the **AEGIS jti** as the Stripe `idempotency-key`.
This single unique key per request closes the "AEGIS approved, Stripe
charged twice on retry" race. The agent never sees the idempotency-
key — it's derived server-side from the token jti.

If your retry layer mints a fresh jti per attempt (which AEGIS's replay
cache requires), you also get a fresh Stripe idempotency-key. If you
retry with the same jti, AEGIS denies as `INVALID_SIGNATURE` (replay)
and Stripe returns the cached prior result.

## Cross-check — payerUserId ↔ principalId

The mock SPT carries `payerUserId`. AEGIS returns the agent's
`principalId`. If your IdP federation maps these (recommended — see
`docs/INDUSTRY_QUICKSTARTS.md` § Identity Federation), confirm they
match before charging:

```ts
if (sptVerdict.payerUserId !== mapPrincipalToUser(aegisVerdict.principalId)) {
  // High-signal anomaly: the agent has the right policy + trust but is
  // presenting an SPT NOT issued for its principal. Almost always a
  // session-leak or a malicious agent. Report back to AEGIS so the
  // BATE engine learns from it.
  await aegis.report({
    agentId: aegisVerdict.agentId,
    eventType: 'suspicious_behavior',
    severity: 'critical',
    description: 'SPT payer mismatch with AEGIS principal',
  });
  return deny('payer_mismatch');
}
```

This is the kind of cross-system signal that compounds in BATE — every
mismatch teaches the trust score what good behavior looks like.

## Production checklist

- [ ] Replace the local `verifySpt` with a real Stripe API call. Map
      Stripe's response onto the `SptVerdict` shape — types are stable.
- [ ] Wire `chargeCard` to `stripe.charges.create()` (or
      `paymentIntents.create`) with the AEGIS jti as
      `idempotency-key`.
- [ ] Subscribe to `aegis.agent.revoked` and `aegis.policy.expired`
      webhooks so the merchant stops accepting an agent within seconds
      of revocation, not at SPT TTL expiry.
- [ ] Cross-link audit trails: every successful charge stores AEGIS
      `auditEventId` next to the Stripe `charge.id`. A regulator can
      independently verify either side.
- [ ] Set `MIN_TRUST_SCORE` per merchant risk appetite. 700 is a
      defensible default; 800+ for high-ticket flows; 600 for
      loss-tolerant verticals.
- [ ] Replay defence: if the agent's `aegisToken` jti is reused, AEGIS
      denies as `INVALID_SIGNATURE`. Make sure your retry layer rolls
      a fresh jti per attempt.
- [ ] Trust score floor for **new** agents: cold-start policy
      (OD-002) determines what score a newly-registered agent receives.
      Most merchants want to gate agents below the cold-start floor for
      the first 7 days even if their AEGIS policy permits the action.

## What's intentionally absent

- **Real Stripe SDK call.** The example uses a self-contained mock so
  the file stays runnable without Stripe creds. The types match what
  Stripe ACP returns; swapping is a 5-line edit.
- **3DS / SCA challenge handoff.** A real production gate uses AEGIS's
  trust band to decide whether to skip 3DS for high-trust agents
  (PLATINUM ≥ 750) or always trigger it. Pattern lives in
  `docs/INTEGRATION_PATTERNS.md` § Card Networks.
- **Settlement reconciliation.** Periodic job that joins AEGIS audit
  events to Stripe settlement records. See `docs/INTEGRATION_PATTERNS.md`
  § Reconciliation.

## Reference

- `docs/MASTER_ENGINEERING_HANDOFF.md` § 6.2 (the architectural shape)
- `docs/INTEGRATION_PATTERNS.md` (this and other patterns)
- `examples/fintech-payments/` (single-token PSP-only pattern — the
  predecessor to this example)
- `packages/verifier-rp/` (drop-in offline verifier the merchant API
  could swap in instead of round-tripping `aegis.verify()`)
