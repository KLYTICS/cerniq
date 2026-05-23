# relying-party-verifier

Demonstrates the relying-party (RP) integration pattern: a service that
**consumes** CERNIQ verify results to decide whether to honor an inbound
agent request. This is the side of the handshake the merchant, API, or
data service writes — distinct from the agent operator side (`node-quickstart`).

## The model

```
   Agent (with private key)            Your service (this example)
   ─────────────────────────           ────────────────────────────
   1. signs a per-request token   →    2. POST /api/checkout
                                              X-CERNIQ-Token: <jwt>
                                              { amount, currency, ... }
                                       3. calls cerniq.verify(token, ctx)
                                       4. CERNIQ API returns valid + scope
                                          + trust + (denialReason if denied)
   ←── 200 allowed / 402 denied ──     5. responds based on the decision
```

Why the merchant (or any RP) does this rather than rolling its own auth: the
verify call is the **only** place where the agent's signature is checked, the
policy's spend cap is consulted, and BATE's trust score is read — all under
the canonical denial-precedence ordering. Skipping it means rebuilding all
three.

## Run

```sh
pnpm install
CERNIQ_API_BASE=http://localhost:4000 \
  CERNIQ_VERIFY_KEY=cerniq_vk_... \
  pnpm tsx src/server.ts
```

`CERNIQ_VERIFY_KEY` should be a verify-only key (`cerniq_vk_…`). Production RPs
must NOT use a full-management key (`cerniq_sk_…`); the SDK's verify path will
work with either, but the management key has too much power for a service
edge.

## Try it

In one terminal, run the server. In another:

```sh
# 1. generate an agent + policy + token via the operator CLI
pnpm --filter @cerniq/scripts run cerniq -- agent register --runtime CUSTOM
pnpm --filter @cerniq/scripts run cerniq -- policy create --agent <agentId> \
  --scope commerce --max-per-tx 100 --expires-in 30d

# 2. sign a token and call the RP
TOKEN=$(pnpm --filter @cerniq/scripts run cerniq -- verify \
  --agent <agentId> --policy <policyId> --action commerce.purchase \
  --amount 49 --domain example.com --json | jq -r '.tokenSentToServer // empty')

# (or sign locally via the SDK as in node-quickstart)

curl -X POST http://localhost:3001/api/checkout \
  -H "Content-Type: application/json" \
  -H "X-CERNIQ-Token: $TOKEN" \
  -d '{"amount": 49, "currency": "USD", "merchantDomain": "example.com"}'
```

## Response shapes

```json
// 200 allowed
{
  "allowed": true,
  "agentId": "cl...",
  "scopes": ["commerce"],
  "trustBand": "VERIFIED",
  "trustScore": 500,
  "ttl": 30
}

// 402 denied
{
  "allowed": false,
  "denialReason": "SPEND_LIMIT_EXCEEDED",
  "description": "Amount exceeds policy limit."
}
```

402 ("Payment Required") matches RFC 9110 §15.5.2 — the request was
authenticated but policy declined. Use `denialReason` for machine-readable
branching; `description` is for logs and dev consoles.
