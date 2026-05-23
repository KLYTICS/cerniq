---
title: CERNIQ Quickstart
audience: developer integrating CERNIQ for the first time
target-time: 90 seconds from cold install to first verified verify-decision
---

# CERNIQ Quickstart

Cold install → working `cerniq.verify()` in **six copy-paste steps**. This doc
mirrors the `/quickstart` page in the dashboard and is the canonical first-run
narrative across terminals (SDK, CLI, dashboard, docs).

## Prerequisites

- Node 18+ for the SDK path, or any HTTP client for the curl path.
- An CERNIQ principal API key (full scope). Get one from the dashboard
  `/billing` page or your CERNIQ admin.
- A reachable CERNIQ API. For local dev: `docker-compose up` then
  `pnpm --filter @cerniq/api dev`. Default base URL: `http://localhost:4000`.

---

## 1. Install the SDK

```bash
pnpm add @cerniq/sdk
```

The SDK is browser- and Edge-runtime-safe — `@noble/ed25519`, no `node:crypto`.

## 2. Generate a keypair locally

```ts
import { generateKeypair } from '@cerniq/sdk';

const { privateKey, publicKey } = await generateKeypair();
// Persist `privateKey` in OS keyring / KMS / Vault — your call.
// CERNIQ only ever sees `publicKey`.
```

> **Invariant 1 (CLAUDE.md):** Private keys never enter CERNIQ. The dashboard
> cannot trigger handshake on your behalf because it would require posting
> the private key — and that's a non-starter.

## 3. Register the agent

```ts
import { Cerniq } from '@cerniq/sdk';

const cerniq = new Cerniq({
  apiKey: process.env.CERNIQ_API_KEY,
  baseUrl: 'http://localhost:4000',
});

const agent = await cerniq.agents.register({
  publicKey,
  runtime: 'ANTHROPIC',
  label: 'shopper for alice@example.com',
});
console.log(agent.agentId); // agt_xxxxxxx
```

The principal-bound API key authenticates the call; the agent is created
under that principal and inherits its policy-engine choice (default
`builtin`, see OD-013).

## 4. Run the handshake

```ts
const result = await cerniq.handshake(agent.agentId, privateKey);
console.log(result.verifiedAt, result.trustScore);
// 2026-05-04T19:21:55Z 600
```

What the SDK does in one call:

1. `POST /v1/agents/:id/challenge` → server returns a 256-bit nonce + the
   exact UTF-8 message to sign.
2. `signHandshake(privateKey, message)` → Ed25519 signature, base64url.
3. `POST /v1/agents/:id/verify-handshake` with `{ signature }` → server
   verifies, lifts trust score to ≥600, writes a 30-day proof-of-possession
   record.

> **Domain-separation:** the signed message is
> `cerniq-handshake-v1::{agentId}::{challenge}` — the protocol prefix prevents
> this signature from being meaningful in any other CERNIQ sub-protocol.

The dashboard's `Key verification` panel on each agent's detail page reflects
the result and offers a curl-based two-step path for non-SDK environments.

## 5. Issue a scoped policy

```ts
const policy = await cerniq.policies.create(agent.agentId, {
  scopes: [
    {
      action: 'commerce.purchase',
      spendLimit: { amount: 200, currency: 'USD', period: 'PER_TRANSACTION' },
      merchantDomains: ['delta.com'],
    },
  ],
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  label: 'demo-policy-1',
});
console.log(policy.policyId); // pol_xxxxxxx
```

Policies are CERNIQ-signed JWTs (EdDSA). Scope, spend, domain allow-list, and
TTL are baked into the token; the verify path enforces them in the canonical
denial-precedence order documented in `docs/SECURITY.md`.

## 6. Sign a verify-token, call `/v1/verify`

```ts
const token = await cerniq.sign(privateKey, agent.agentId, policy.policyId, {
  action: 'commerce.purchase',
  amount: 199,
  currency: 'USD',
  merchantDomain: 'delta.com',
});

const decision = await cerniq.verify(token, {
  action: 'commerce.purchase',
  amount: 199,
  currency: 'USD',
  merchantDomain: 'delta.com',
});
console.log(decision.outcome, decision.deniedReason);
// 'approved' undefined
```

Open the dashboard `/audit` page — your first decision is signed, hash-chained,
and appearing in the table. Every event is offline-verifiable via the public
key at `/.well-known/audit-signing-key`.

---

## One-shot bootstrap

For demos / CI:

```ts
// quickstart.ts — the full flow above, ~30 lines.
import { Cerniq, generateKeypair } from '@cerniq/sdk';

const cerniq = new Cerniq({
  apiKey: process.env.CERNIQ_API_KEY!,
  baseUrl: 'http://localhost:4000',
});
const { privateKey, publicKey } = await generateKeypair();
const agent = await cerniq.agents.register({ publicKey, runtime: 'ANTHROPIC' });

const verified = await cerniq.handshake(agent.agentId, privateKey);
console.log('handshake @', verified.verifiedAt, 'trust', verified.trustScore);

const policy = await cerniq.policies.create(agent.agentId, {
  scopes: [
    {
      action: 'commerce.purchase',
      spendLimit: { amount: 200, currency: 'USD', period: 'PER_TRANSACTION' },
      merchantDomains: ['delta.com'],
    },
  ],
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
});
const token = await cerniq.sign(privateKey, agent.agentId, policy.policyId, {
  action: 'commerce.purchase',
  amount: 199,
  currency: 'USD',
  merchantDomain: 'delta.com',
});
const decision = await cerniq.verify(token, {
  action: 'commerce.purchase',
  amount: 199,
  currency: 'USD',
  merchantDomain: 'delta.com',
});
console.log(decision.outcome); // 'approved'
```

---

## Where to go next

- **Dashboard `/agents`** — every registration appears here with a live status
  dot. Click an agent for the inspector + handshake panel.
- **Dashboard `/audit`** — every verify decision, signed and chained.
- **Dashboard `/webhooks`** — subscribe to `verify.denied`,
  `trust_score_changed`, `agent.revoked`. Stripe-style HMAC signatures.
- **Dashboard `/policies`** — list and revoke active policies. Revocation
  propagates to the verify hot-path within seconds.
- **`docs/SERVICE_MAP.md`** — how the terminals (API, dashboard, SDK, CLI,
  workers, types) fit together.
- **`docs/SECURITY.md`** — denial precedence, audit-chain construction,
  threat model.

## Troubleshooting

| Symptom                                              | Likely cause                                                                | Fix                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `INVALID_HANDSHAKE` after `cerniq.handshake(...)`    | wrong private key for the registered public key, or signature decoded wrong | regenerate keypair, re-register, retry                      |
| `CHALLENGE_EXPIRED` (HTTP 410)                       | nonce TTL elapsed (5 min) or already consumed                               | call `cerniq.handshake(...)` again — it mints a fresh nonce |
| `AGENT_NOT_FOUND` on handshake                       | agent belongs to a different principal                                      | verify your API key matches the agent's principal           |
| `verify` returns `denied` with `TRUST_SCORE_TOO_LOW` | agent below cold-start floor (600)                                          | run handshake — it lifts the score to ≥600                  |
| `verify` returns `denied` with `INVALID_SIGNATURE`   | token signed with a different key than the registered one                   | check you're using the same private key from registration   |
