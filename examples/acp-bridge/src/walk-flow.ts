// Walks the four canonical scenarios for the ACP + AEGIS dual-verify
// gate against a running merchant server. Each scenario is a single
// HTTP request that exercises one branch of the dual-verify state
// machine, so you can read the response and immediately know which
// gate refused.
//
//   1. happy path                    → allowed=true
//   2. AEGIS denies (token tampered) → denialSource=aegis,  reason=INVALID_SIGNATURE
//   3. Stripe denies (amount > SPT)  → denialSource=stripe, errorCode=spt_amount_exceeded
//   4. validation pre-check fails    → denialSource=pre,    400 status
//
// Run with: pnpm tsx src/walk-flow.ts http://localhost:3002

import { signAgentToken } from '@aegis/sdk';

import { mintMockSpt } from './spt-verify.js';
import type { ChargeRequest, ChargeResponse } from './types.js';

const target = process.argv[2] ?? 'http://localhost:3002';

async function call(name: string, body: ChargeRequest): Promise<void> {
  process.stderr.write(`── ${name} ${'─'.repeat(Math.max(0, 50 - name.length))}\n`);
  const resp = await fetch(`${target}/api/charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await resp.json()) as ChargeResponse;
  process.stderr.write(
    `  http=${resp.status}  allowed=${result.allowed}  denial=${result.denialSource ?? '-'}  ` +
      `aegis=${result.aegisDenialReason ?? '-'}  stripe=${result.stripeError ?? '-'}\n`,
  );
}

async function main(): Promise<void> {
  const agentId = mustEnv('AEGIS_AGENT_ID');
  const policyId = mustEnv('AEGIS_POLICY_ID');
  const privateKey = mustEnv('AEGIS_AGENT_PRIVATE_KEY');
  const merchantDomain = process.env.MERCHANT_DOMAIN ?? 'acme-checkout.com';
  const amount = 4900; // $49.00

  const goodSpt = mintMockSpt({
    maxAmount: 10_000,
    currency: 'USD',
    payerUserId: 'usr_demo',
    ttlSeconds: 60,
  });
  const tightSpt = mintMockSpt({
    maxAmount: 1_000, // intentionally < requested amount
    currency: 'USD',
    payerUserId: 'usr_demo',
    ttlSeconds: 60,
  });
  const goodAegis = await signAgentToken(privateKey, agentId, policyId, {
    action: 'commerce.purchase',
    amount: amount / 100,
    currency: 'USD',
    merchantDomain,
    ttlSeconds: 60,
  });
  // Tampered token — flip the last byte of the signature segment.
  const tamperedAegis = goodAegis.slice(0, -1) + (goodAegis.endsWith('A') ? 'B' : 'A');

  await call('happy path', {
    paymentToken: goodSpt,
    aegisToken: goodAegis,
    amount,
    currency: 'USD',
    merchantDomain,
  });
  await call('AEGIS denies (tampered signature)', {
    paymentToken: goodSpt,
    aegisToken: tamperedAegis,
    amount,
    currency: 'USD',
    merchantDomain,
  });
  await call('Stripe denies (amount > SPT cap)', {
    paymentToken: tightSpt,
    aegisToken: goodAegis,
    amount,
    currency: 'USD',
    merchantDomain,
  });
  await call('pre-validation failure (missing currency)', {
    paymentToken: goodSpt,
    aegisToken: goodAegis,
    amount,
    currency: '',
    merchantDomain,
  });
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    process.stderr.write(`walk-flow: ${name} env is required\n`);
    process.exit(2);
  }
  return v;
}

main().catch((err: unknown) => {
  process.stderr.write(`walk-flow: fatal — ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
