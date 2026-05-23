// Demo "agent" — registers a keypair with CERNIQ, issues a scoped policy,
// signs a token, calls the tool server. End-to-end.
//
// In a real deployment, the AGENT side runs in your customer's environment.
// They generate the keypair LOCALLY (CERNIQ never sees the private key per
// ADR-0002), register the public key with CERNIQ, issue policy tokens for
// each work request, and present those tokens at every tool call.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { cerniq } from './cerniq.js';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function main(): Promise<void> {
  const a = cerniq();

  // 1. Generate keypair locally.
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);

  // 2. Register agent with public key.
  const agent = await a.agents.create({
    name: 'demo-shopping-agent',
    publicKey: b64u(pub),
  });
  console.log(`[agent] registered: ${(agent as { id: string }).id}`);

  // 3. Issue scoped policy.
  const policy = await a.policies.create({
    agentId: (agent as { id: string }).id,
    scopes: [
      {
        category: 'commerce',
        actions: ['commerce.purchase'],
        merchantDomains: ['delta.com', 'amazon.com'],
        spendLimit: { amount: '500.00', currency: 'USD', window: 'per_day' },
      },
    ] as never,
    expiresInSeconds: 3600,
  });
  console.log(`[agent] policy issued: ${(policy as { id: string }).id}`);

  // 4. The agent now signs short-lived tokens for each tool call. In a
  //    real deployment this happens just-in-time before each call. We
  //    use the SDK's signAgentToken helper.
  const { signAgentToken } = await import('@cerniq/sdk/dist/crypto.js');
  const token = await signAgentToken(
    b64u(priv),
    (agent as { id: string }).id,
    (policy as { id: string }).id,
    {
      action: 'commerce.purchase',
      amount: 42,
      currency: 'USD',
      merchantDomain: 'delta.com',
      ttlSeconds: 60,
    },
  );
  console.log(`[agent] token minted (${token.length} chars)`);

  // 5. (Outside this script) — the agent passes the token to the tool
  //    server via the MCP transport. The tool server's wrapMcpHandler
  //    extracts it and calls cerniq.verify. We can simulate that here:
  const verify = await a.verify(token, { action: 'commerce.purchase' });
  console.log(`[agent] verify: ${verify.valid ? 'APPROVED' : `DENIED ${verify.denialReason}`}`);
}

main().catch((e) => {
  console.error('[agent] fatal:', e);
  process.exit(1);
});
