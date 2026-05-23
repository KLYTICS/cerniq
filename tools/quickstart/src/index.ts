// CERNIQ quickstart — your first verify in 30 seconds.
//
// What this script does, end to end:
//   1. Generate a fresh Ed25519 keypair (client-side, never sent).
//   2. Register the agent with CERNIQ — only the public key transits.
//   3. Create a scoped policy with a $500 commerce cap.
//   4. Sign a per-request token (still client-side).
//   5. Call /v1/verify with the token + the action context.
//   6. Print the verdict — happy path approved, or the denial reason.
//
// What this script DOESN'T do (deliberately):
//   - Persist the keypair. The whole point of "private keys never
//     enter CERNIQ" is the agent owns the private key. We print it
//     once so you can rerun, but nothing is saved.
//   - Cover the denial branches. See examples/fintech-payments/
//     src/walk-denials.ts for that.
//
// Required env:
//   CERNIQ_API_BASE     base URL (e.g. https://api.cerniq.io)
//   CERNIQ_API_KEY      management key (cerniq_sk_…) for the registration
//
// Optional:
//   CERNIQ_VERIFY_KEY   verify-only key (cerniq_vk_…) for the verify call.
//                      Falls back to CERNIQ_API_KEY if absent — fine for
//                      a quickstart, NOT fine for production where the
//                      verify edge should never see a management key.

import { Cerniq, generateKeypair, signAgentToken } from '@cerniq/sdk';

const API_BASE = process.env.CERNIQ_API_BASE ?? 'https://api.cerniq.io';
const API_KEY = requireEnv('CERNIQ_API_KEY');
const VERIFY_KEY = process.env.CERNIQ_VERIFY_KEY ?? API_KEY;

async function main(): Promise<number> {
  step('1', 'Generate Ed25519 keypair (client-side; private never sent)');
  const kp = await generateKeypair();
  process.stderr.write(`     publicKey  ${kp.publicKey}\n`);
  process.stderr.write(
    `     privateKey ${kp.privateKey.slice(0, 16)}…  (truncated; never persisted)\n`,
  );

  step('2', 'Register the agent with CERNIQ — public key only');
  const cerniqMgmt = new Cerniq({ baseUrl: API_BASE, apiKey: API_KEY });
  const agent = await cerniqMgmt.agents.register({
    publicKey: kp.publicKey,
    runtime: 'CUSTOM',
    label: 'cerniq-quickstart',
  });
  process.stderr.write(`     agentId    ${agent.agentId}\n`);
  process.stderr.write(`     trustScore ${agent.trustScore}\n`);

  step('3', 'Create a scoped policy ($500 per-tx commerce cap)');
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const policy = await cerniqMgmt.policies.create(agent.agentId, {
    scopes: [
      {
        category: 'commerce',
        spendLimit: { currency: 'USD', maxPerTransaction: 500 },
        allowedDomains: ['acme-checkout.com'],
      },
    ],
    expiresAt,
    label: 'quickstart-policy',
  });
  process.stderr.write(`     policyId   ${policy.policyId}\n`);

  step('4', 'Sign a per-request agent token (client-side)');
  const token = await signAgentToken(kp.privateKey, agent.agentId, policy.policyId, {
    action: 'commerce.purchase',
    amount: 49,
    currency: 'USD',
    merchantDomain: 'acme-checkout.com',
    ttlSeconds: 60,
  });
  process.stderr.write(`     token      ${token.slice(0, 60)}…  (truncated)\n`);

  step('5', 'Call /v1/verify with the token + action context');
  const cerniqRp = new Cerniq({ baseUrl: API_BASE, verifyKey: VERIFY_KEY });
  const verdict = await cerniqRp.verify(token, {
    action: 'commerce.purchase',
    amount: 49,
    currency: 'USD',
    merchantDomain: 'acme-checkout.com',
  });

  step('6', 'Verdict');
  process.stderr.write('\n');
  if (verdict.valid) {
    process.stderr.write('✓ APPROVED\n');
    process.stderr.write(`  agentId       ${verdict.agentId}\n`);
    process.stderr.write(`  trustBand     ${verdict.trustBand}\n`);
    process.stderr.write(`  trustScore    ${verdict.trustScore}\n`);
    process.stderr.write(`  scopesGranted ${(verdict.scopesGranted ?? []).join(', ')}\n`);
  } else {
    process.stderr.write('✗ DENIED\n');
    process.stderr.write(`  denialReason  ${verdict.denialReason ?? '(unknown)'}\n`);
  }
  process.stderr.write('\n');
  process.stderr.write('Next steps:\n');
  process.stderr.write('  • examples/fintech-payments/  — single-token PSP gate\n');
  process.stderr.write('  • examples/acp-bridge/         — Stripe ACP dual-verify\n');
  process.stderr.write('  • examples/banking-rails/      — programmable banking\n');
  process.stderr.write('  • docs/INTEGRATION_PATTERNS.md — full integration playbook\n');
  process.stderr.write('  • docs/PARTNER_ONBOARDING.md   — picking your first vertical\n');

  // Print the verdict to stdout as JSON so tooling can pipe it.
  process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');

  return verdict.valid ? 0 : 1;
}

function step(num: string, message: string): void {
  process.stderr.write(`\n[${num}/6] ${message}\n`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    process.stderr.write(`quickstart: ${name} env is required\n`);
    process.stderr.write('\n');
    process.stderr.write('Quick setup:\n');
    process.stderr.write(
      '  1. Boot CERNIQ locally: cd /path/to/cerniq && pnpm db:up && pnpm dev\n',
    );
    process.stderr.write(
      '  2. Mint an API key (see docs/RUNBOOK.md § "Issuing the first API key")\n',
    );
    process.stderr.write(
      '  3. CERNIQ_API_BASE=http://localhost:4000 CERNIQ_API_KEY=cerniq_sk_… pnpm start\n',
    );
    process.exit(2);
  }
  return v;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(
      `quickstart: fatal — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
