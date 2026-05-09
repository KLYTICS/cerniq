// Agent-side token minter for the fintech-payments quickstart.
//
// Mints a per-request AEGIS token client-side and prints it to stdout
// so a shell harness can pipe it into the merchant API:
//
//   TOKEN=$(pnpm tsx src/agent-sim.ts \
//     --agent ag_xxx --policy po_xxx --amount 49 --mcc 5411)
//   curl -H "X-AEGIS-Token: $TOKEN" -d '{"amount":49,...}' \
//        http://localhost:3001/api/charge
//
// Why this lives in the example (and not just a shell snippet): it
// demonstrates AEGIS invariant #1 in practice — the agent's private
// key never leaves the agent. The merchant service receives only the
// signed JWT; AEGIS only ever held the public key. This file is the
// shortest readable proof of that property.
//
// Inputs:
//   --agent <id>           required — agent identifier (ag_…)
//   --policy <id>          required — policy identifier (po_…)
//   --amount <num>         optional — transaction amount (USD by default)
//   --currency <iso>       optional — defaults to USD
//   --mcc <code>           optional — merchant category code (informational)
//   --domain <hostname>    optional — merchant domain, defaults to acme-checkout.com
//   --action <verb>        optional — defaults to commerce.purchase
//   --ttl <seconds>        optional — token lifetime (default 60, max 60 per spec)
//   --private-key <b64u>   optional — Ed25519 secret key (base64url, raw 32 bytes)
//                          falls back to AEGIS_AGENT_PRIVATE_KEY env, else
//                          generates a fresh keypair (only useful for the
//                          AGENT_NOT_FOUND demo branch)
//   --json                 optional — emit { token, agentId, policyId, ... }
//                                     instead of just the bare token
//
// Exit codes: 0 success, 2 missing required arg, 3 signing error.

import { signAgentToken, generateKeypair } from '@aegis/sdk';

interface CliArgs {
  agentId: string;
  policyId: string;
  amount: number | undefined;
  currency: string;
  mcc: string | undefined;
  merchantDomain: string;
  action: string;
  ttlSeconds: number;
  privateKeyB64u: string | undefined;
  json: boolean;
}

function fail(msg: string, code = 2): never {
  process.stderr.write(`agent-sim: ${msg}\n`);
  process.exit(code);
}

function readArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx === -1 || idx === argv.length - 1) return undefined;
    return argv[idx + 1];
  };
  const agentId = get('--agent');
  const policyId = get('--policy');
  if (!agentId) fail('--agent <id> is required');
  if (!policyId) fail('--policy <id> is required');

  const amountRaw = get('--amount');
  const amount = amountRaw !== undefined ? Number(amountRaw) : undefined;
  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
    fail(`--amount must be a positive number, got "${amountRaw}"`);
  }
  const ttlRaw = get('--ttl');
  const ttlSeconds = ttlRaw !== undefined ? Number(ttlRaw) : 60;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 60) {
    fail(`--ttl must be an integer in 1..60, got "${ttlRaw}"`);
  }

  return {
    agentId: agentId!,
    policyId: policyId!,
    amount,
    currency: get('--currency') ?? 'USD',
    mcc: get('--mcc'),
    merchantDomain: get('--domain') ?? 'acme-checkout.com',
    action: get('--action') ?? 'commerce.purchase',
    ttlSeconds,
    privateKeyB64u: get('--private-key') ?? process.env.AEGIS_AGENT_PRIVATE_KEY,
    json: argv.includes('--json'),
  };
}

async function main(): Promise<number> {
  const args = readArgs(process.argv.slice(2));

  let privateKeyB64u = args.privateKeyB64u;
  let publicKeyB64u: string | undefined;
  let generatedFresh = false;
  if (!privateKeyB64u) {
    // No key supplied — mint an ephemeral one. This is the
    // AGENT_NOT_FOUND demo branch (the public key never reached AEGIS,
    // so the verify call will deny). Useful for the denial walk; never
    // do this in real flows.
    const kp = await generateKeypair();
    privateKeyB64u = kp.privateKey;
    publicKeyB64u = kp.publicKey;
    generatedFresh = true;
    process.stderr.write(
      'agent-sim: no --private-key or AEGIS_AGENT_PRIVATE_KEY — generated an ephemeral keypair (verify will deny AGENT_NOT_FOUND)\n',
    );
  }

  let token: string;
  try {
    token = await signAgentToken(privateKeyB64u, args.agentId, args.policyId, {
      action: args.action,
      amount: args.amount,
      currency: args.currency,
      merchantDomain: args.merchantDomain,
      ttlSeconds: args.ttlSeconds,
    });
  } catch (err) {
    fail(`sign failed — ${err instanceof Error ? err.message : String(err)}`, 3);
  }

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          token,
          agentId: args.agentId,
          policyId: args.policyId,
          action: args.action,
          amount: args.amount,
          currency: args.currency,
          merchantDomain: args.merchantDomain,
          ttlSeconds: args.ttlSeconds,
          ephemeralPublicKey: generatedFresh ? publicKeyB64u : undefined,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(token + '\n');
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`agent-sim: fatal — ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
