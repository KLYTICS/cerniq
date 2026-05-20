# `@aegis/sdk`

> Verified identity, scoped policy, and behavioral attestation for AI agents.

```bash
npm install @aegis/sdk
```

## Quickstart — one call

Round 25 — `Aegis.quickstart()` collapses the canonical 5-step flow into a
single call. Reads `AEGIS_API_KEY` from env, generates and stores a
keypair, registers the agent, mints a default policy, and returns a
pre-bound signer:

```ts
import { Aegis } from '@aegis/sdk';

const { aegis, sign } = await Aegis.quickstart({ label: 'my-first-agent' });

const token = await sign({ action: 'commerce.purchase', amount: 100, currency: 'USD' });
const result = await aegis.verify(token);
console.log(result.valid ? 'ok' : result.denialReason);
```

The keypair lives on disk at `~/.aegis/keys/my-first-agent.json` (Node),
in IndexedDB (browser), or in-memory (Cloudflare Workers / Vercel Edge).
Pass `storage:` to override — see [Key storage](#key-storage) below.

## Quickstart — explicit (the underlying 5 steps)

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

## Runtime + regions

```ts
Aegis.runtime();      // 'node' | 'edge' | 'browser' | 'bun' | 'deno' | 'cloudflare-workers' | 'unknown'
Aegis.capabilities(); // { runtime, hasFilesystem, hasBrowserStorage, hasWebCrypto, hasFetch }
```

Region selection (US/EU/APAC) — set `AEGIS_REGION=eu` in env or pass
`new Aegis({ region: 'eu' })`. Explicit `baseUrl` and `AEGIS_API_URL`
env take precedence so self-hosted AEGIS deployments work without code
changes.

## Key storage

```ts
import { fileSystemKeyStorage, indexedDBKeyStorage, memoryKeyStorage } from '@aegis/sdk';

// Node: ~/.aegis/keys/<name>.json, mode 0600 (default on Node).
const storage = fileSystemKeyStorage();

// Browser: origin-scoped IndexedDB.
// const storage = indexedDBKeyStorage();

// Edge / tests: in-process Map.
// const storage = memoryKeyStorage();

const bundle = await Aegis.quickstart({ label: 'prod-agent', storage });
```

For production browser flows or any high-stakes context, use a KMS-backed
adapter (the SDK ships the `KmsKeyStorage` shape; provider implementations
land in companion `@aegis/adapter-*` packages).

## Errors — every error tells you what to do

Round 25 — every `AegisError` carries `next` and `docsUrl`:

```ts
import { AegisError } from '@aegis/sdk';

try {
  await aegis.verify(token);
} catch (err) {
  if (err instanceof AegisError) {
    console.error(err.message);         // customer-safe message
    console.error('Next:', err.next);   // one-line fix
    console.error('Docs:', err.docsUrl);
  }
}
```

## Runtime support

Works in Node.js ≥ 18, Cloudflare Workers, Deno, Bun, Vercel Edge Runtime,
and modern browsers. Crypto uses `@noble/ed25519` (audited, zero native
deps).

## License

MIT.
