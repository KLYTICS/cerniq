# `@aegis/sdk`

> Verified identity, scoped policy, and behavioral attestation for AI agents.

```bash
npm install @aegis/sdk
```

## Quickstart

```ts
import { Aegis, generateKeypair } from '@aegis/sdk';

// 1. Create a keypair on the agent host. Persist the private key locally —
//    AEGIS never receives it.
const { publicKey, privateKey } = await generateKeypair();

// 2. Register the agent with AEGIS.
const aegis = new Aegis({ apiKey: process.env.AEGIS_API_KEY! });
const agent = await aegis.agents.register({
  publicKey,
  runtime: 'ANTHROPIC',
  model: 'claude-sonnet-4-5',
  label: 'Shopping agent for alice@example.com',
});

// 3. Issue a scoped policy.
const policy = await aegis.policies.create(agent.agentId, {
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
const token = await aegis.sign(privateKey, agent.agentId, policy.policyId, {
  action: 'commerce.purchase',
  amount: 347,
  currency: 'USD',
  merchantDomain: 'delta.com',
});

// 5. The relying party verifies the token.
const result = await aegis.verify(token, {
  action: 'commerce.purchase',
  amount: 347,
  merchantDomain: 'delta.com',
});

if (!result.valid) {
  // result.denialReason: AGENT_REVOKED | INVALID_SIGNATURE | POLICY_EXPIRED | …
}
```

## Security guarantees

- **Private keys never transit AEGIS.** `generateKeypair` produces them
  client-side; only the public key is registered.
- **Tokens are short-lived.** Default TTL is 60 seconds. Override with
  `ttlSeconds` per-call if your relying party flow needs more.
- **Revocation is instant.** `aegis.agents.revoke(agentId)` propagates to the
  edge cache in seconds; existing tokens immediately fail verification.

## Runtime

Works in Node.js ≥ 18, Cloudflare Workers, Deno, and modern browsers.
Crypto uses `@noble/ed25519` (audited, zero native deps).

## License

MIT.
