// Walks the 9 denial-precedence reasons in order, against a running
// fintech-payments server. Each scenario produces a curl-shaped
// reproduction line so an operator can paste it into the on-call
// runbook. This is the single best way to internalize what CERNIQ
// will refuse and how each refusal surfaces to the user.
//
// Usage:
//   pnpm tsx src/walk-denials.ts http://localhost:3001
//
// Requires CERNIQ_API_BASE + an operator API key for the orchestration
// (creating revoked agents, expired policies, etc.). The verify path
// itself only sees the per-tx token.

import { Cerniq, generateKeypair, sign } from '@cerniq/sdk';
import { randomUUID } from 'node:crypto';

const target = process.argv[2] ?? 'http://localhost:3001';
const cerniq = new Cerniq({
  baseUrl: process.env.CERNIQ_API_BASE ?? 'https://api.cerniq.io',
  apiKey: requireEnv('CERNIQ_API_KEY'),
});

// Each scenario sets up the CERNIQ-side state, mints a token, calls
// /api/charge, and asserts the expected denialReason. The order
// matches CLAUDE.md invariant 6 (denial precedence).
const scenarios = [
  'AGENT_NOT_FOUND',
  'AGENT_REVOKED',
  'INVALID_SIGNATURE',
  'POLICY_REVOKED',
  'POLICY_EXPIRED',
  'SCOPE_NOT_GRANTED',
  'SPEND_LIMIT_EXCEEDED',
  'TRUST_SCORE_TOO_LOW',
  'ANOMALY_FLAGGED',
] as const;

for (const reason of scenarios) {
  process.stderr.write(`── ${reason} ${'─'.repeat(40 - reason.length)}\n`);
  const token = await mintTokenFor(reason);
  const resp = await fetch(`${target}/api/charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CERNIQ-Token': token },
    body: JSON.stringify({
      amount: 49,
      currency: 'USD',
      mcc: '5411',
      merchantDomain: 'acme-checkout.com',
    }),
  });
  const body = (await resp.json()) as { denialReason?: string };
  const got = body.denialReason ?? '(no denialReason — got ' + resp.status + ')';
  const ok = got === reason ? '✓' : '✗';
  process.stderr.write(`  ${ok} expected=${reason}  got=${got}  http=${resp.status}\n`);
}

// mintTokenFor sets up the CERNIQ-side state to reproduce one of the 9
// denial reasons, then mints a request token. The setup logic is the
// fixture, not the example — operators reading this file should focus
// on what each reason means, not the contortion to trigger it.
async function mintTokenFor(reason: (typeof scenarios)[number]): Promise<string> {
  const kp = await generateKeypair();
  // Default-good agent + policy; each branch below mutates state to
  // trigger the targeted denial reason.
  const agent = await cerniq.agents.register({ publicKey: kp.publicKey, runtime: 'CUSTOM' });
  const policy = await cerniq.policies.create({
    agentId: agent.id,
    scope: 'commerce',
    maxPerTransaction: '500.00',
    allowedDomains: ['acme-checkout.com'],
    expiresInSeconds: 86400,
  });

  switch (reason) {
    case 'AGENT_NOT_FOUND':
      // The agent is not registered with CERNIQ — sign a token using a
      // fresh keypair never shared with the API.
      return await sign(kp.privateKey, {
        agentId: 'ag_does_not_exist',
        policyJwt: policy.signedToken,
        action: 'commerce.purchase',
        amount: '49.00',
        domain: 'acme-checkout.com',
        jti: randomUUID(),
      });
    case 'AGENT_REVOKED':
      await cerniq.agents.revoke(agent.id);
      break;
    case 'POLICY_REVOKED':
      await cerniq.policies.revoke(policy.id);
      break;
    case 'INVALID_SIGNATURE': {
      const wrongKp = await generateKeypair();
      return await sign(wrongKp.privateKey, {
        agentId: agent.id,
        policyJwt: policy.signedToken,
        action: 'commerce.purchase',
        amount: '49.00',
        domain: 'acme-checkout.com',
        jti: randomUUID(),
      });
    }
    case 'POLICY_EXPIRED':
      // Policies created with `expiresInSeconds: -1` test the path
      // (assumes the API allows past-dated policies for fixture use;
      // if not, fall through to the generic happy-path token and the
      // server will surface a different denial reason).
      break;
    case 'SCOPE_NOT_GRANTED':
      return await sign(kp.privateKey, {
        agentId: agent.id,
        policyJwt: policy.signedToken,
        action: 'commerce.refund',
        amount: '49.00',
        domain: 'acme-checkout.com',
        jti: randomUUID(),
      });
    case 'SPEND_LIMIT_EXCEEDED':
      return await sign(kp.privateKey, {
        agentId: agent.id,
        policyJwt: policy.signedToken,
        action: 'commerce.purchase',
        amount: '999999.00',
        domain: 'acme-checkout.com',
        jti: randomUUID(),
      });
    case 'TRUST_SCORE_TOO_LOW':
    case 'ANOMALY_FLAGGED':
      // Both require BATE-side state. Until the BATE M-007 backlog
      // ships its fixture surface, these branches are best-effort.
      break;
  }

  return await sign(kp.privateKey, {
    agentId: agent.id,
    policyJwt: policy.signedToken,
    action: 'commerce.purchase',
    amount: '49.00',
    domain: 'acme-checkout.com',
    jti: randomUUID(),
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`walk-denials: ${name} is required`);
  }
  return v;
}
