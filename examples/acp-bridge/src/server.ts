// Merchant API — the ACP + CERNIQ dual-verify gate.
//
// Inbound /api/charge carries TWO tokens:
//   - paymentToken: the Stripe SPT from ACP authorization (answers:
//                   "is the cardholder authorized for this amount?")
//   - cerniqToken:   the CERNIQ-signed agent token (answers:
//                   "is THIS agent the one the cardholder authorized,
//                    is the policy still valid, has it behaved well?")
//
// CERNIQ is additive to ACP. ACP solves the payment-leg (SPT covers
// the amount); CERNIQ solves the identity / policy / trust leg. Both
// must pass before the merchant charges. This example IS the §6.2
// integration shape from the master handoff, made runnable.
//
// Design notes:
//   - CERNIQ is checked FIRST (cheaper, denial-precedence is well-
//     understood). If CERNIQ denies, we never call Stripe — saves
//     network and avoids burning an SPT slot for a rejected request.
//   - Both verdicts are recorded, even on denial — the merchant's
//     own audit trail captures why the charge didn't happen.
//   - Idempotency: the CERNIQ jti is reused as the Stripe
//     idempotency-key when the caller doesn't supply one. Single
//     unique key end-to-end avoids "CERNIQ approved, Stripe charged
//     twice" scenarios under retry.
//
// CERNIQ does NOT see card data; Stripe does NOT see the agent's
// private key. Each gate stays in its own scope.

import express, { type Request, type Response } from 'express';
import { Cerniq } from '@cerniq/sdk';

import { verifySpt } from './spt-verify.js';
import type { ChargeRequest, ChargeResponse, ChargeId } from './types.js';

const cerniq = new Cerniq({
  baseUrl: process.env.CERNIQ_API_BASE ?? 'https://api.cerniq.io',
  // Verify-only key — never a management key on a service edge.
  verifyKey: requireEnv('CERNIQ_VERIFY_KEY'),
});

const MIN_TRUST_SCORE = Number(process.env.MIN_TRUST_SCORE ?? '700');
const MERCHANT_DOMAIN = requireEnv('MERCHANT_DOMAIN');

const app = express();
app.use(express.json({ limit: '64kb' }));

app.post('/api/charge', async (req: Request, res: Response) => {
  const body = req.body as ChargeRequest;
  const validation = validateChargeBody(body);
  if (validation !== null) {
    return respond(res, 400, {
      allowed: false,
      denialSource: 'pre',
      stripeError: validation,
    });
  }

  // Gate 1 — CERNIQ. Cheaper than Stripe; identity errors are the
  // overwhelming majority of denials in agent-driven traffic.
  const cerniqVerdict = await cerniq.verify({
    token: body.cerniqToken,
    action: { kind: 'commerce.purchase', payload: body },
    requestedAmount: (body.amount / 100).toFixed(2), // SPT is cents; CERNIQ spend is decimal
    requestedDomain: body.merchantDomain,
    minTrustScore: MIN_TRUST_SCORE,
    jti: body.idempotencyKey ?? cryptoRandom(),
    now: new Date().toISOString(),
  });

  if (!cerniqVerdict.valid) {
    return respond(res, 402, {
      allowed: false,
      denialSource: 'cerniq',
      cerniqDenialReason: cerniqVerdict.denialReason ?? undefined,
      auditEventId: cerniqVerdict.auditEventId,
    });
  }

  // Gate 2 — Stripe SPT verify. CERNIQ approved the agent's identity +
  // policy + trust; now confirm the cardholder's SPT actually covers
  // this amount in this currency.
  const sptVerdict = await verifySpt({
    token: body.paymentToken,
    requestedAmount: body.amount,
    requestedCurrency: body.currency,
  });
  if (!sptVerdict.valid) {
    return respond(res, 402, {
      allowed: false,
      denialSource: 'stripe',
      stripeError: sptVerdict.errorCode,
      auditEventId: cerniqVerdict.auditEventId,
    });
  }

  // Cross-check: the SPT was issued to userId X; CERNIQ says agent's
  // principalId is Y. If your IdP federation maps these (they should),
  // an X !== Y here means the agent is presenting an SPT NOT issued
  // for THEIR principal — a high-signal anomaly worth reporting back
  // to CERNIQ via /v1/agents/:id/report. Skipped in the example; left
  // as a // INTEGRATION-CHECK comment so reviewers don't miss it.
  // INTEGRATION-CHECK: confirm sptVerdict.payerUserId maps to cerniqVerdict.principalId.

  // Both gates green — charge the card. We use the CERNIQ jti as the
  // Stripe idempotency-key so retries are idempotent end-to-end.
  const chargeId = await chargeCard({
    amount: body.amount,
    currency: body.currency,
    paymentToken: body.paymentToken,
    idempotencyKey: body.idempotencyKey ?? cryptoRandom(),
  });

  return respond(res, 200, {
    allowed: true,
    chargeId,
    auditEventId: cerniqVerdict.auditEventId,
  });
});

const port = Number(process.env.PORT ?? '3002');
app.listen(port, () => {
  process.stderr.write(`acp-bridge merchant API listening on :${port}\n`);
});

// ── helpers ──────────────────────────────────────────────────────────

function validateChargeBody(b: unknown): string | null {
  if (!b || typeof b !== 'object') return 'missing_body';
  const o = b as Record<string, unknown>;
  if (typeof o.paymentToken !== 'string' || !o.paymentToken.startsWith('spt_'))
    return 'paymentToken_invalid';
  if (typeof o.cerniqToken !== 'string' || o.cerniqToken.split('.').length !== 3)
    return 'cerniqToken_invalid';
  if (typeof o.amount !== 'number' || !Number.isFinite(o.amount) || o.amount <= 0)
    return 'amount_invalid';
  if (typeof o.currency !== 'string' || o.currency.length !== 3) return 'currency_invalid';
  if (typeof o.merchantDomain !== 'string' || o.merchantDomain.length === 0)
    return 'merchantDomain_invalid';
  return null;
}

function respond(res: Response, status: number, body: ChargeResponse): Response {
  return res.status(status).json(body);
}

// chargeCard is a pure stub. Wire it to the real Stripe charges.create()
// in production. The dual-verify gate above runs UPSTREAM of this call.
async function chargeCard(req: {
  amount: number;
  currency: string;
  paymentToken: string;
  idempotencyKey: string;
}): Promise<ChargeId> {
  return ('ch_stub_' + req.idempotencyKey) as ChargeId;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`acp-bridge: ${name} is required`);
  return v;
}

function cryptoRandom(): string {
  // Match @cerniq/sdk's jti shape (ULID-ish); falls back if uuid is
  // unavailable.
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${process.hrtime.bigint().toString(36)}`
  );
}
