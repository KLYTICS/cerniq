# `fintech-payments` — CERNIQ verify gate for a payment authorization flow

A minimal but realistic payment-authorization service that places an
CERNIQ verify call between an inbound agent request and the actual
charge. The shape mirrors how Stripe-style merchants integrate today,
just with CERNIQ as the cryptographic gate underneath the merchant's
own business logic.

## Why this pattern

A payment service that takes an action on behalf of an AI agent has
three things to know before it charges a card:

1. **Who** is the agent? (cryptographic identity, not a session
   cookie or a string-typed `actor=` field)
2. **Was it authorized** for this specific action under these specific
   limits? (scoped policy, signed JWT)
3. **Is its behavior trustable** right now? (rolling trust score from
   BATE, refusing below a per-merchant threshold)

CERNIQ answers all three in a single `verify` call — and writes a
tamper-evident audit row regardless of the outcome. The payment
service stays focused on the payment domain; CERNIQ handles identity,
policy, and audit as a substrate.

## The flow

```
   Agent (with private key)         Your merchant API (this example)
   ─────────────────────────        ──────────────────────────────────
   1. signs a per-tx token   →      2. POST /api/charge
                                          X-CERNIQ-Token: <jwt>
                                          { amount, currency, mcc, ... }
                                    3. cerniq.verify(token, ctx)
                                    4. CERNIQ returns valid + scope
                                       + trust + denialReason
                                    5. on valid:  charge the card
                                       on denied: 402 + denialReason
   ←── 200 charged / 402 denied ─
```

Notice what CERNIQ does _not_ do: it doesn't talk to your card network,
doesn't see your PAN, doesn't store your customers. The verify call is
purely about agent authorization. Card processing stays in your
existing PCI-scoped service.

## Run

```sh
cd examples/fintech-payments
pnpm install

CERNIQ_API_BASE=https://api.cerniq.io \
CERNIQ_VERIFY_KEY=cerniq_vk_... \
MIN_TRUST_SCORE=700 \
MERCHANT_DOMAIN=acme-checkout.com \
pnpm tsx src/server.ts
```

In another terminal, simulate an agent making a charge:

```sh
# generate an agent + policy via the operator CLI
cerniq init --industry fintech-payments  # if you haven't yet
cerniq agents register --runtime CUSTOM --name "checkout-bot-v1"
cerniq policy create --agent <agentId> --scope commerce --max-per-tx 500 \
  --domain acme-checkout.com --expires-in 30d

# sign a request token (the SDK does this client-side; the agent
# never shares its private key with CERNIQ or with your service)
TOKEN=$(pnpm tsx src/agent-sim.ts \
  --agent <agentId> --policy <policyId> --amount 49 --mcc 5411)

curl -X POST http://localhost:3001/api/charge \
  -H "Content-Type: application/json" \
  -H "X-CERNIQ-Token: $TOKEN" \
  -d '{"amount": 49, "currency": "USD", "mcc": "5411", "merchantDomain": "acme-checkout.com"}'
```

## Walk the denial-precedence ladder

The `make demo` target walks all 9 denial reasons in order. This is
the single best way to understand what CERNIQ will refuse and how to
surface each refusal to a human operator. See
`docs/cerniq-denial-mapping.md` (template in
`docs/CERNIQ_AS_BACKBONE.md` § 5) for the user-facing translation
table.

## Production checklist

- [ ] `CERNIQ_VERIFY_KEY` is a verify-only key (`cerniq_vk_…`), not a
      management key. The dashboard issues both kinds; never put a
      management key on a service edge.
- [ ] `MIN_TRUST_SCORE` is set per merchant risk appetite, not
      hard-coded. 700 is a defensible default; 800+ for high-ticket
      flows; 600 for low-ticket / loss-tolerant verticals.
- [ ] Idempotency: the `jti` in every token must be unique per request.
      CERNIQ's replay cache enforces this server-side, but a duplicate
      `jti` from your own retries will surface as `INVALID_SIGNATURE`
      to the user — make sure your retry layer rolls a fresh `jti`.
- [ ] Cross-link: every `verify` response carries an `auditEventId`.
      Persist it next to your own charge row so a regulator or your
      own ops can trace the agent → policy → audit chain in one query.
- [ ] Webhook handler: subscribe to `agent.revoked` and
      `policy.expired` so a compromised agent stops charging within
      seconds of revocation, not at TTL expiry.

## What's intentionally absent

- No mock card processor. The `chargeCard()` helper is a pure stub
  that returns a fake authorization id — you wire it to your real
  PSP. CERNIQ is the agent-authorization gate, not the payment gate.
- No retry / circuit-breaker around the CERNIQ verify call. Production
  RPs should add one (matches `@cerniq/sdk` retry semantics). Kept out
  of the example to keep the gate logic readable.
- No Spanish-localized denial messages. Adopt the table in
  `docs/CERNIQ_AS_BACKBONE.md` § 5 verbatim if your verticals span
  PR / LATAM.

## Reference

- `docs/SECURITY.md` § Denial Precedence (the 9 reasons)
- `docs/CERNIQ_AS_BACKBONE.md` § 2.3 (recommended consumption pattern)
- `examples/relying-party-verifier/` (the generic RP pattern this
  fintech vertical specializes)
- WORK_BOARD M-040e (the ticket this example completes)
