// Treasury API — OKORO verify gate in front of a programmable-banking
// action. The merchant (or in this vertical, the treasury team) layers
// OKORO over their bank adapter (Modern Treasury, Increase, Mercury,
// or direct ISO 20022 to a sponsor bank).
//
// Inbound /api/instruct carries:
//   - okoroToken: agent identity + policy + trust
//   - instruction: the rail-agnostic payment shape (see iso20022-shape)
//
// We gate the agent first, then submit to the (mock) bank rail. OKORO
// signs an audit event regardless of rail outcome — even if the bank
// rejects, you have a tamper-evident record of the agent's attempt.
//
// Why this matters: agent-driven money movement is the highest-stakes
// OKORO surface. A leaked credential moving funds via wire is
// unrecoverable. The combination of (a) Ed25519 identity, (b) scoped
// policy with spend caps, (c) BATE trust score gating high-value
// rails, and (d) signed audit chain is the entire defence-in-depth
// story for treasury automation.

import express, { type Request, type Response } from 'express';
import { Okoro } from '@okoro/sdk';

import type {
  PaymentInstruction,
  InstructResponse,
  BankSubmitVerdict,
  RailType,
} from './iso20022-shape.js';

const okoro = new Okoro({
  baseUrl: process.env.OKORO_API_BASE ?? 'https://api.okorolabs.io',
  verifyKey: requireEnv('OKORO_VERIFY_KEY'),
});

const TREASURY_DOMAIN = requireEnv('TREASURY_DOMAIN');

/** Per-rail trust-score floor. Wire and FedNow are irrevocable; we
 *  insist on PLATINUM for those, while book-transfers (intra-bank,
 *  reversible by ledger entry) tolerate VERIFIED. Mirrors the
 *  industry "limits by rail" pattern most banks already enforce
 *  internally. Operators tune via env. */
const RAIL_MIN_TRUST: Readonly<Record<RailType, number>> = Object.freeze({
  'wire': 800,
  'fednow': 800,
  'rtp': 750,
  'sepa-instant': 750,
  'sepa-ct': 700,
  'ach': 650,
  'book-transfer': 500,
});

const app = express();
app.use(express.json({ limit: '64kb' }));

interface InstructBody {
  okoroToken: string;
  instruction: PaymentInstruction;
}

app.post('/api/instruct', async (req: Request, res: Response) => {
  const body = req.body as InstructBody;
  const validation = validateInstruct(body);
  if (validation !== null) {
    return res.status(400).json({
      allowed: false,
      endToEndId: body?.instruction?.endToEndId ?? '',
      bankRejectionCode: validation,
    });
  }

  const { okoroToken, instruction } = body;
  const minTrust = RAIL_MIN_TRUST[instruction.rail] ?? 700;

  const verdict = await okoro.verify({
    token: okoroToken,
    action: { kind: 'banking.payment', payload: instruction },
    requestedAmount: (instruction.amount / 100).toFixed(2),
    requestedDomain: instruction.creditor.identifier, // bind scope to counterparty
    minTrustScore: minTrust,
    jti: instruction.endToEndId,
    now: new Date().toISOString(),
  });

  if (!verdict.valid) {
    return respond(res, 402, {
      allowed: false,
      endToEndId: instruction.endToEndId,
      auditEventId: verdict.auditEventId,
      okoroDenialReason: verdict.denialReason ?? undefined,
    });
  }

  // OKORO approved — submit to the bank rail. In production this is
  // a Modern Treasury client.payments.create() call (or Increase, or
  // direct pacs.008 to your sponsor bank). The mock below shows the
  // shape; swapping to a real adapter is a 1-file change.
  const submit = await submitToBank(instruction);

  if (!submit.accepted) {
    // The bank refused (malformed routing, insufficient funds, etc.).
    // We still have an OKORO audit row — the agent's INTENT to make
    // this payment is recorded even though the bank wouldn't deliver.
    return respond(res, 502, {
      allowed: false,
      endToEndId: instruction.endToEndId,
      auditEventId: verdict.auditEventId,
      bankRejectionCode: submit.rejectionCode,
    });
  }

  return respond(res, 200, {
    allowed: true,
    endToEndId: instruction.endToEndId,
    bankId: submit.bankId,
    auditEventId: verdict.auditEventId,
  });
});

const port = Number(process.env.PORT ?? '3003');
app.listen(port, () => {
  process.stderr.write(`banking-rails treasury API listening on :${port}\n`);
});

// ── helpers ──────────────────────────────────────────────────────────

function validateInstruct(b: unknown): string | null {
  if (!b || typeof b !== 'object') return 'missing_body';
  const o = b as Record<string, unknown>;
  if (typeof o.okoroToken !== 'string' || (o.okoroToken as string).split('.').length !== 3) return 'okoroToken_invalid';
  const inst = o.instruction as PaymentInstruction | undefined;
  if (!inst) return 'instruction_missing';
  if (typeof inst.endToEndId !== 'string' || inst.endToEndId.length === 0) return 'endToEndId_invalid';
  if (typeof inst.amount !== 'number' || !Number.isFinite(inst.amount) || inst.amount <= 0) return 'amount_invalid';
  if (typeof inst.currency !== 'string' || inst.currency.length !== 3) return 'currency_invalid';
  if (!inst.debtor?.identifier || !inst.creditor?.identifier) return 'parties_invalid';
  return null;
}

function respond(res: Response, status: number, body: InstructResponse): Response {
  return res.status(status).json(body);
}

// Mock bank submitter — production wires to Modern Treasury,
// Increase, Mercury, or direct ISO 20022 SOAP / SFTP to a sponsor.
async function submitToBank(inst: PaymentInstruction): Promise<BankSubmitVerdict> {
  // Refuse same-day wires after 4pm ET (a real cutoff). Demonstrates
  // a bank-side denial that is NOT an OKORO denial — you can see
  // the two rejection paths in the response shape.
  const hourEt = new Date().getUTCHours() - 4;
  if (inst.rail === 'wire' && hourEt >= 16) {
    return {
      accepted: false,
      rejectionCode: 'rail_cutoff_passed',
      rejectionReason: 'wire cutoff 4pm ET; instruction received after cutoff',
    };
  }
  return { accepted: true, bankId: 'bnk_stub_' + inst.endToEndId };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`banking-rails: ${name} is required`);
  return v;
}
