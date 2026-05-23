// Minimal payment-authorization service with an CERNIQ verify gate.
//
// Route: POST /api/charge
//   Header X-CERNIQ-Token: a JWT signed by an agent (jti, exp, scope, etc.).
//   Body { amount, currency, mcc, merchantDomain, idempotencyKey? }.
//
// On every request:
//   1. Read the token + the per-merchant policy bindings.
//   2. Call cerniq.verify({ policyJwt, agentSignature, action, ... }).
//   3. If valid: charge the card (stub) and respond 200.
//   4. If denied: respond 402 + denialReason (RFC 9110 §15.5.2).
//
// CERNIQ does NOT see card data. Card processing is your PSP's job.
// CERNIQ gates *agent authorization* — who, scoped to what, with what
// trust — not *payment authorization*.
//
// Read examples/fintech-payments/README.md for the production
// checklist (verify-only key, min trust score per vertical, idempotency,
// webhook handlers for revocation).

import express, { type Request, type Response } from 'express';
import { Cerniq } from '@cerniq/sdk';
import { randomUUID } from 'node:crypto';

const cerniq = new Cerniq({
  baseUrl: process.env.CERNIQ_API_BASE ?? 'https://api.cerniq.io',
  // Verify-only key (cerniq_vk_…), never a management key on a service edge.
  verifyKey: requireEnv('CERNIQ_VERIFY_KEY'),
});

const MIN_TRUST_SCORE = Number(process.env.MIN_TRUST_SCORE ?? '700');
const MERCHANT_DOMAIN = requireEnv('MERCHANT_DOMAIN');

const app = express();
app.use(express.json({ limit: '64kb' }));

app.post('/api/charge', async (req: Request, res: Response) => {
  const token = req.header('x-cerniq-token');
  if (!token) {
    return res.status(400).json({ error: 'missing X-CERNIQ-Token header' });
  }
  const body = req.body as ChargeBody;
  if (!isValidChargeBody(body)) {
    return res.status(400).json({ error: 'invalid charge body' });
  }

  // The SDK extracts the policyJwt + agentSignature from the token.
  // Action is domain-specific — the merchant says "this is a
  // commerce.purchase for $49 at MCC 5411 on acme-checkout.com" and
  // CERNIQ verifies the agent's signed policy permits that exact shape.
  const verdict = await cerniq.verify({
    token,
    action: { kind: 'commerce.purchase', payload: body },
    requestedAmount: body.amount.toFixed(2),
    requestedDomain: body.merchantDomain,
    minTrustScore: MIN_TRUST_SCORE,
    jti: randomUUID(),
    now: new Date().toISOString(),
  });

  if (!verdict.valid) {
    return res.status(402).json({
      allowed: false,
      denialReason: verdict.denialReason,
      auditEventId: verdict.auditEventId,
    });
  }

  // The merchant's own business logic. CERNIQ does not call the PSP.
  const charge = await chargeCard({
    amount: body.amount,
    currency: body.currency,
    idempotencyKey: body.idempotencyKey ?? randomUUID(),
  });

  return res.status(200).json({
    allowed: true,
    chargeId: charge.id,
    agentId: verdict.agentId,
    scopes: verdict.scopesGranted,
    trustScore: verdict.trustScore,
    auditEventId: verdict.auditEventId,
  });
});

const port = Number(process.env.PORT ?? '3001');
app.listen(port, () => {
  // Status messages on stderr (the SDK convention) so JSON output on
  // stdout from tooling stays parseable.
  process.stderr.write(`fintech-payments listening on :${port}\n`);
});

// --- helpers ------------------------------------------------------

interface ChargeBody {
  amount: number;
  currency: string;
  mcc: string;
  merchantDomain: string;
  idempotencyKey?: string;
}

function isValidChargeBody(b: unknown): b is ChargeBody {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return (
    typeof o.amount === 'number' &&
    o.amount > 0 &&
    typeof o.currency === 'string' &&
    typeof o.mcc === 'string' &&
    typeof o.merchantDomain === 'string'
  );
}

// chargeCard is a pure stub. Wire it to your real PSP (Stripe, Adyen,
// Worldpay, Lithic, etc.) — CERNIQ has no opinion on which one. The
// CERNIQ verify gate runs upstream of this call.
async function chargeCard(req: {
  amount: number;
  currency: string;
  idempotencyKey: string;
}): Promise<{ id: string }> {
  return { id: 'ch_stub_' + req.idempotencyKey };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`fintech-payments: ${name} is required`);
  }
  return v;
}
