// Treasury-agent simulator. Mints an AEGIS token client-side and
// posts a payment instruction to the treasury API.
//
// Usage:
//   AEGIS_AGENT_PRIVATE_KEY=<b64u> \
//   AEGIS_AGENT_ID=ag_xxx AEGIS_POLICY_ID=po_xxx \
//   pnpm tsx src/agent-sim.ts \
//     --rail ach --amount 50000 --currency USD \
//     --debtor-bic GSCRUS33 --creditor-bic CHASUS33 \
//     --memo "vendor payment INV-1042"

import { signAgentToken } from '@aegis/sdk';

import type { PaymentInstruction, RailType, Iso4217Currency } from './iso20022-shape.js';

interface CliArgs {
  target: string;
  rail: RailType;
  amount: number;
  currency: Iso4217Currency;
  debtorIdentifier: string;
  creditorIdentifier: string;
  memo: string | undefined;
  agentId: string;
  policyId: string;
  privateKey: string;
}

const VALID_RAILS: readonly RailType[] = ['ach', 'wire', 'rtp', 'fednow', 'sepa-ct', 'sepa-instant', 'book-transfer'];
const VALID_CURRENCIES: readonly Iso4217Currency[] = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'BRL', 'CHF', 'MXN'];

function readArgs(argv: string[]): CliArgs {
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

  const railRaw = (get('--rail') ?? 'ach') as RailType;
  if (!VALID_RAILS.includes(railRaw)) {
    process.stderr.write(`agent-sim: --rail must be one of ${VALID_RAILS.join('|')}, got "${railRaw}"\n`);
    process.exit(2);
  }
  const currencyRaw = (get('--currency') ?? 'USD') as Iso4217Currency;
  if (!VALID_CURRENCIES.includes(currencyRaw)) {
    process.stderr.write(`agent-sim: --currency must be one of ${VALID_CURRENCIES.join('|')}, got "${currencyRaw}"\n`);
    process.exit(2);
  }
  const amountRaw = get('--amount') ?? '5000';
  const amount = Number(amountRaw);
  if (!Number.isInteger(amount) || amount <= 0) {
    process.stderr.write(`agent-sim: --amount must be a positive integer (cents), got "${amountRaw}"\n`);
    process.exit(2);
  }

  return {
    target: get('--target') ?? 'http://localhost:3003',
    rail: railRaw,
    amount,
    currency: currencyRaw,
    debtorIdentifier: get('--debtor-bic') ?? 'GSCRUS33',
    creditorIdentifier: get('--creditor-bic') ?? 'CHASUS33',
    memo: get('--memo'),
    agentId: requireFlag('--agent', 'AEGIS_AGENT_ID'),
    policyId: requireFlag('--policy', 'AEGIS_POLICY_ID'),
    privateKey: requireFlag('--private-key', 'AEGIS_AGENT_PRIVATE_KEY'),
  };
}

async function main(): Promise<number> {
  const args = readArgs(process.argv.slice(2));

  const endToEndId = `e2e_${Date.now()}_${(globalThis.crypto?.randomUUID?.() ?? '').replace(/-/g, '').slice(0, 8)}`;
  const valueDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10); // T+1 default

  const instruction: PaymentInstruction = {
    endToEndId,
    rail: args.rail,
    debtor: { identifier: args.debtorIdentifier, kind: 'bic' },
    creditor: { identifier: args.creditorIdentifier, kind: 'bic' },
    amount: args.amount,
    currency: args.currency,
    valueDate,
    remittanceInfo: args.memo,
  };

  // Bind the AEGIS scope check to the creditor BIC. Policies for
  // treasury agents typically allow-list specific counterparties; the
  // creditor identifier is the "domain" the policy gates against.
  const aegisToken = await signAgentToken(args.privateKey, args.agentId, args.policyId, {
    action: 'banking.payment',
    amount: args.amount / 100,
    currency: args.currency,
    merchantDomain: args.creditorIdentifier,
    ttlSeconds: 60,
  });

  const resp = await fetch(`${args.target}/api/instruct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aegisToken, instruction }),
  });
  const result = (await resp.json()) as Record<string, unknown>;

  process.stdout.write(JSON.stringify({ http: resp.status, ...result }, null, 2) + '\n');
  return resp.status >= 200 && resp.status < 300 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`agent-sim: fatal — ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
