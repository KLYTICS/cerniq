/**
 * OKORO quickstart — one-file walkthrough of the agent lifecycle using
 * `@okoro/sdk`. Hits a running OKORO API at $OKORO_API_BASE.
 *
 * Steps:
 *   1. Set up an SDK client.
 *   2. Generate a fresh Ed25519 keypair (private key never leaves this process).
 *   3. Register the agent (publicKey only).
 *   4. Create an ACTIVE policy with a $100/transaction commerce cap.
 *   5. Sign a per-request token (60s TTL).
 *   6. Verify the token; print the decision.
 *
 * Required env:
 *   OKORO_API_KEY   — full-management key (e.g. from `pnpm --filter @okoro/scripts seed`)
 *   OKORO_VERIFY_KEY — verify-only key (optional; if unset, OKORO_API_KEY is reused
 *                      and the verify call rides under it — fine for dev only)
 *   OKORO_API_BASE  — default http://localhost:4000
 *
 * Run:
 *   pnpm install
 *   OKORO_API_KEY=okoro_sk_... pnpm tsx src/quickstart.ts
 */

import { Okoro, generateKeypair, signAgentToken } from '@okoro/sdk';

const API_BASE = process.env.OKORO_API_BASE ?? 'http://localhost:4000';
const API_KEY = process.env.OKORO_API_KEY;
const VERIFY_KEY = process.env.OKORO_VERIFY_KEY ?? process.env.OKORO_API_KEY;

function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error(
      'OKORO_API_KEY is required. Run `pnpm --filter @okoro/scripts seed` first; copy the apiKey from its stdout.',
    );
    process.exit(2);
  }

  section('1. SDK client');
  const okoro = new Okoro({ apiKey: API_KEY, baseUrl: API_BASE });
  console.log(`baseUrl: ${API_BASE}`);

  section('2. Keypair (client-side only)');
  const { publicKey, privateKey } = await generateKeypair();
  console.log(`publicKey:  ${publicKey}`);
  console.log(`privateKey: <kept local — ${privateKey.length} chars>`);

  section('3. Register agent');
  const agent = await okoro.agents.register({
    publicKey,
    runtime: 'CUSTOM',
    label: 'quickstart-demo',
  });
  console.log(`agentId:    ${agent.agentId}`);
  console.log(`trustBand:  ${agent.trustBand} (${agent.trustScore})`);

  section('4. Create policy');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const policy = await okoro.policies.create(agent.agentId, {
    label: 'quickstart-policy',
    scopes: [
      {
        category: 'commerce',
        spendLimit: { currency: 'USD', maxPerTransaction: 100 },
      },
    ],
    expiresAt,
  });
  console.log(`policyId:   ${policy.policyId}`);
  console.log(`expiresAt:  ${policy.expiresAt}`);

  section('5. Sign request token');
  const token = await signAgentToken(privateKey, agent.agentId, policy.policyId, {
    action: 'commerce.purchase',
    amount: 49,
    currency: 'USD',
    merchantDomain: 'example.com',
  });
  console.log(`token:      ${token.slice(0, 32)}…(truncated)`);

  section('6. Verify');
  // Use the verify key here — relying parties should never use the management
  // key. In this demo we fall back to the management key if OKORO_VERIFY_KEY
  // is unset, but production deployments must split.
  const verifier = new Okoro({ apiKey: VERIFY_KEY ?? API_KEY, baseUrl: API_BASE });
  const result = await verifier.verify(token, {
    action: 'commerce.purchase',
    amount: 49,
    currency: 'USD',
    merchantDomain: 'example.com',
  });
  console.log(`valid:        ${result.valid}`);
  console.log(`scopes:       ${result.scopesGranted.join(', ')}`);
  console.log(`trustBand:    ${result.trustBand} (${result.trustScore})`);
  console.log(`denialReason: ${result.denialReason ?? 'none'}`);
  console.log(`ttl:          ${result.ttl}s`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`quickstart failed: ${msg}`);
  process.exit(1);
});
