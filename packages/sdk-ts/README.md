# `@cerniq/sdk`

> Verified identity, scoped policy, and behavioral attestation for AI agents.

```bash
npm install @cerniq/sdk
```

## Quickstart

```ts
import { Cerniq, generateKeypair } from '@cerniq/sdk';

// 1. Create a keypair on the agent host. Persist the private key locally —
//    CERNIQ never receives it.
const { publicKey, privateKey } = await generateKeypair();

// 2. Register the agent with CERNIQ.
const cerniq = new Cerniq({ apiKey: process.env.CERNIQ_API_KEY! });
const agent = await cerniq.agents.register({
  publicKey,
  runtime: 'ANTHROPIC',
  model: 'claude-sonnet-4-5',
  label: 'Shopping agent for alice@example.com',
});

// 3. Issue a scoped policy.
const policy = await cerniq.policies.create(agent.agentId, {
  label: 'Buy flights under $500',
  scopes: [
    {
      category: 'commerce',
      spendLimit: { currency: 'USD', maxPerTransaction: 500, maxPerDay: 1000 },
      allowedDomains: ['delta.com', 'united.com'],
    },
  ],
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
});

// 4. Before each agent action, sign a token.
const token = await cerniq.sign(privateKey, agent.agentId, policy.policyId, {
  action: 'commerce.purchase',
  amount: 347,
  currency: 'USD',
  merchantDomain: 'delta.com',
});

// 5. The relying party verifies the token.
const result = await cerniq.verify(token, {
  action: 'commerce.purchase',
  amount: 347,
  merchantDomain: 'delta.com',
});

if (!result.valid) {
  // result.denialReason: AGENT_REVOKED | INVALID_SIGNATURE | POLICY_EXPIRED | …
}
```

## Security guarantees

- **Private keys never transit CERNIQ.** `generateKeypair` produces them
  client-side; only the public key is registered.
- **Tokens are short-lived.** Default TTL is 60 seconds. Override with
  `ttlSeconds` per-call if your relying party flow needs more.
- **Revocation is instant.** `cerniq.agents.revoke(agentId)` propagates to the
  edge cache in seconds; existing tokens immediately fail verification.

## Runtime

Works in Node.js ≥ 18, Cloudflare Workers, Deno, and modern browsers.
Crypto uses `@noble/ed25519` (audited, zero native deps).

## License

MIT.
