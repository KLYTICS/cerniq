/**
 * AEGIS — relying-party verifier example.
 *
 * Demonstrates the *other side* of the AEGIS handshake: a service that
 * receives an AEGIS-signed request from an AI agent and decides whether to
 * honor it. The pattern is generic — checkout, data access, comms, etc.
 *
 * Wire:
 *   POST /api/checkout
 *     headers: X-AEGIS-Token: <signed jwt the agent presented>
 *     body:    { amount, currency, merchantDomain }
 *
 *   → 200 { allowed: true,  agentId, scopes, trustBand }
 *   → 402 { allowed: false, denialReason, description }
 *
 * 402 ("Payment Required") is the right code here per RFC 9110 §15.5.2:
 * "the server denies for reasons relating to authorisation, payment, or
 * policy". HTTP 401/403 don't fit; the client *was* authenticated, the
 * agent's *policy* didn't allow the action.
 *
 * Run:
 *   AEGIS_VERIFY_KEY=aegis_vk_... pnpm tsx src/server.ts
 */

import express, { Request, Response } from 'express';
import { Aegis } from '@aegis/sdk';

const PORT = Number(process.env.PORT ?? '3001');
const API_BASE = process.env.AEGIS_API_BASE ?? 'http://localhost:4000';
const VERIFY_KEY = process.env.AEGIS_VERIFY_KEY ?? process.env.AEGIS_API_KEY;

if (!VERIFY_KEY) {
  console.error('AEGIS_VERIFY_KEY (or AEGIS_API_KEY) is required.');
  process.exit(2);
}

const aegis = new Aegis({ apiKey: VERIFY_KEY, baseUrl: API_BASE });

// Ordered to mirror DENIAL_REASON_PRECEDENCE (packages/types/src/constants.ts).
// All 12 reasons mapped so an upgraded AEGIS API doesn't surface "Unknown"
// to the relying-party operator for reasons added by ADR-0014 (2026-05-05)
// and ADR-0016 (2026-05-15).
const DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  PLAN_LIMIT_EXCEEDED: 'Plan tier monthly verify quota exhausted.',
  AGENT_NOT_FOUND: 'Unknown agent.',
  AGENT_REVOKED: 'Agent has been revoked.',
  INVALID_SIGNATURE: 'Token signature did not verify.',
  POLICY_REVOKED: 'Policy revoked.',
  POLICY_EXPIRED: 'Policy expired.',
  SCOPE_NOT_GRANTED: 'Action / domain outside policy scope.',
  TRIAL_EXHAUSTED: 'Free-trial quota exhausted; upgrade required.',
  SPEND_LIMIT_EXCEEDED: 'Amount exceeds policy limit.',
  TRUST_SCORE_TOO_LOW: 'Trust score below threshold.',
  ANOMALY_FLAGGED: 'Anomaly detected.',
  INTENT_MISMATCH: 'Actual call deviated from declared intent.',
});

const app = express();
app.use(express.json());

app.post('/api/checkout', async (req: Request, res: Response) => {
  const token = req.header('X-AEGIS-Token');
  if (!token) {
    res.status(400).json({ allowed: false, error: 'missing X-AEGIS-Token header' });
    return;
  }
  const body = req.body as
    | { amount?: number; currency?: string; merchantDomain?: string; action?: string }
    | undefined;

  try {
    const result = await aegis.verify(token, {
      action: body?.action ?? 'commerce.purchase',
      amount: body?.amount,
      currency: body?.currency,
      merchantDomain: body?.merchantDomain,
    });

    if (!result.valid) {
      const reason = result.denialReason ?? 'UNKNOWN';
      res.status(402).json({
        allowed: false,
        denialReason: reason,
        description: DESCRIPTIONS[reason] ?? 'denied',
      });
      return;
    }

    if (!result.scopesGranted.includes('commerce')) {
      res.status(402).json({
        allowed: false,
        denialReason: 'SCOPE_NOT_GRANTED',
        description: 'commerce scope not granted by policy',
      });
      return;
    }

    res.status(200).json({
      allowed: true,
      agentId: result.agentId,
      scopes: result.scopesGranted,
      trustBand: result.trustBand,
      trustScore: result.trustScore,
      ttl: result.ttl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ allowed: false, error: `verify failed: ${msg}` });
  }
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`relying-party-verifier listening on http://localhost:${PORT}`);
  console.log(`  AEGIS API: ${API_BASE}`);
});
