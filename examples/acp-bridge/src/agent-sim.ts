// Agent-side simulator for the ACP + OKORO dual-verify flow.
//
// In production:
//   1. The user authorizes the agent through ACP onboarding (Stripe
//      issues an SPT representing the user's payment authorization).
//   2. The user (or their IdP — Auth0/Clerk/WorkOS) registers the
//      agent's public key with OKORO and creates a scoped policy.
//   3. The agent — at action-time — signs a per-tx OKORO token and
//      presents it alongside the SPT to the merchant.
//
// This script simulates step 3 against a running acp-bridge server.
// It mints both tokens client-side (mock SPT for the demo, real
// OKORO token via the SDK) and POSTs /api/charge.
//
// Run:
//   OKORO_AGENT_PRIVATE_KEY=<b64u> \
//   OKORO_AGENT_ID=ag_xxx \
//   OKORO_POLICY_ID=po_xxx \
//   pnpm tsx src/agent-sim.ts --target http://localhost:3002 --amount 4900

import { signAgentToken } from '@okoro/sdk';

import { mintMockSpt } from './spt-verify.js';
import type { ChargeRequest, ChargeResponse } from './types.js';

interface SimArgs {
  target: string;
  amount: number; // cents
  currency: string;
  merchantDomain: string;
  agentId: string;
  policyId: string;
  privateKey: string;
  payerUserId: string;
  ttlSeconds: number;
}

function readArgs(argv: string[]): SimArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx === -1 || idx === argv.length - 1) return undefined;
    return argv[idx + 1];
  };
  const requireFlag = (flag: string, env?: string): string => {
    const v = get(flag) ?? (env ? process.env[env] : undefined);
    if (!v) {
      process.stderr.write(`agent-sim: ${flag}${env ? ` (or ${env} env)` : ''} is required\n`);
      process.exit(2);
    }
    return v;
  };

  const amountRaw = get('--amount') ?? '4900';
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    process.stderr.write(`agent-sim: --amount must be a positive number, got "${amountRaw}"\n`);
    process.exit(2);
  }

  return {
    target: get('--target') ?? 'http://localhost:3002',
    amount,
    currency: get('--currency') ?? 'USD',
    merchantDomain: get('--domain') ?? 'acme-checkout.com',
    agentId: requireFlag('--agent', 'OKORO_AGENT_ID'),
    policyId: requireFlag('--policy', 'OKORO_POLICY_ID'),
    privateKey: requireFlag('--private-key', 'OKORO_AGENT_PRIVATE_KEY'),
    payerUserId: get('--payer') ?? 'usr_demo_payer',
    ttlSeconds: Number(get('--ttl') ?? '60'),
  };
}

async function main(): Promise<number> {
  const args = readArgs(process.argv.slice(2));

  // Stripe-side: a real agent receives this from Stripe ACP onboarding.
  // Demo: mint a mock SPT scoped to 1.5× the request so we don't
  // spuriously fail on amount-cap. Bigger demo: mint a too-small SPT
  // and watch the dual-verify catch it as denialSource: 'stripe'.
  const paymentToken = mintMockSpt({
    maxAmount: Math.ceil(args.amount * 1.5),
    currency: args.currency,
    payerUserId: args.payerUserId,
    ttlSeconds: args.ttlSeconds,
  });

  // OKORO-side: real client-signed token. Private key NEVER leaves
  // the agent — only the signed JWT crosses the wire.
  const okoroToken = await signAgentToken(args.privateKey, args.agentId, args.policyId, {
    action: 'commerce.purchase',
    amount: args.amount / 100, // OKORO expects decimal; ACP uses cents
    currency: args.currency,
    merchantDomain: args.merchantDomain,
    ttlSeconds: args.ttlSeconds,
  });

  const body: ChargeRequest = {
    paymentToken,
    okoroToken,
    amount: args.amount,
    currency: args.currency,
    merchantDomain: args.merchantDomain,
    mcc: '5411',
  };

  const resp = await fetch(`${args.target}/api/charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await resp.json()) as ChargeResponse;

  process.stdout.write(JSON.stringify({ http: resp.status, ...result }, null, 2) + '\n');
  return result.allowed ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`agent-sim: fatal — ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
