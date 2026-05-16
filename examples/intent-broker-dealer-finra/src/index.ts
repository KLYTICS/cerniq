// Broker-dealer FINRA Rule 3110 — AEGIS Intent Manifest demo for AI order-routing agents.
//
// Scenario: an AI portfolio-rebalancing agent at a FINRA-supervised broker-
// dealer places a single buy limit order: 100 shares AAPL at $195.00 on
// NASDAQ. Total notional cap: $19,500.00. FINRA Rule 3110 requires the
// broker-dealer to supervise all such orders; the intent manifest provides
// the cryptographic supervision trail — signed intent issued before the
// order hits the OMS, reconciled against the fill report after execution.
//
// Reconciliation: 'strict' — no tolerance on equity orders. Any deviation
// is a supervisory event. Compliance-friendly: the deny path produces a
// precise IntentMismatch.kind that maps directly to a Rule 3110 supervisory
// ledger entry: wrong-endpoint (wrong side or symbol), over-amount-cap
// (oversized fill / price-slippage), wrong-merchant (wrong venue).
//
// In production the OMS verifies the manifest locally on order receipt,
// routes the order to the venue, then on fill receipt POSTs the actuals
// to /v1/intent/{id}/actuals (Idempotency-Key set to the fill report id,
// so partial-fill report retries are dedupe'd by the AEGIS server).

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

import {
  signManifest,
  type ActualCallObservation,
  type IntentManifestBody,
} from '@aegis/intent-manifest';
import { verifyIntent } from '@aegis/verifier-rp';

type EdInternal = { etc: { sha512Sync: (...m: Uint8Array[]) => Uint8Array } };
(ed as unknown as EdInternal).etc.sha512Sync = (...m: Uint8Array[]) => {
  let total = 0;
  for (const a of m) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of m) {
    out.set(a, off);
    off += a.length;
  }
  return sha512(out);
};

export interface DemoOutcome {
  readonly label: string;
  readonly decision: 'approved' | 'denied';
  readonly reason?: string;
  readonly mismatches: ReadonlyArray<{ kind: string; detail: string }>;
}

export async function runDemo(
  now: number = Math.floor(Date.now() / 1000),
): Promise<DemoOutcome[]> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const kid = 'kid-finra-bd-demo-2026-05';

  // Intent: BUY 100 AAPL at $195.00 limit on NASDAQ. Single order. Strict.
  // The venue is encoded in merchantId because the kernel's commerce-action
  // claim doesn't ship a venue field — and for broker-dealer compliance the
  // venue IS the counterparty. Routing to the wrong venue is a supervisory
  // event indistinguishable from routing to the wrong merchant.
  const body: IntentManifestBody = {
    schemaVersion: 1,
    manifestId: 'int_finra_bd_demo_01',
    issuedAt: now,
    expiresAt: now + 60,
    principalId: 'prn_alpha_capital_demo',
    agentId: 'agt_rebalance_executor',
    intent: {
      kind: 'commerce-action',
      action: 'finra.equity.buy',
      merchantId: 'NASDAQ',
      maxCalls: 1,
      amountCap: { amount: '19500.00', currency: 'USD' },
    },
    reconciliation: { strictness: 'strict' },
    verifyTokenJti: 'jti_demo_finra_01',
    verifyTokenSha256B64Url: 'demo-token-hash',
  };

  const signed = signManifest(body, priv, kid);
  const publicKeysByKid = { [kid]: pub };
  const nowMs = () => now * 1000;

  const scenarios: ReadonlyArray<readonly [string, ActualCallObservation]> = [
    [
      'happy-path',
      {
        observedAt: now + 8,
        kind: 'commerce-action',
        payload: {
          action: 'finra.equity.buy',
          merchantId: 'NASDAQ',
          amount: '19450.00',
          currency: 'USD',
          symbol: 'AAPL',
          qty: 100,
          avgFillPrice: '194.50',
        },
      },
    ],
    [
      'wrong-side-buy-to-sell',
      {
        observedAt: now + 8,
        kind: 'commerce-action',
        payload: {
          action: 'finra.equity.sell',
          merchantId: 'NASDAQ',
          amount: '19450.00',
          currency: 'USD',
          symbol: 'AAPL',
          qty: 100,
          avgFillPrice: '194.50',
        },
      },
    ],
    [
      'over-notional-cap',
      {
        observedAt: now + 8,
        kind: 'commerce-action',
        payload: {
          action: 'finra.equity.buy',
          merchantId: 'NASDAQ',
          amount: '20500.00',
          currency: 'USD',
          symbol: 'AAPL',
          qty: 105,
          avgFillPrice: '195.24',
        },
      },
    ],
    [
      'wrong-venue',
      {
        observedAt: now + 8,
        kind: 'commerce-action',
        payload: {
          action: 'finra.equity.buy',
          merchantId: 'NYSE',
          amount: '19450.00',
          currency: 'USD',
          symbol: 'AAPL',
          qty: 100,
          avgFillPrice: '194.50',
        },
      },
    ],
  ];

  return scenarios.map(([label, actual]) => {
    const outcome = verifyIntent({
      manifest: signed,
      actuals: [actual],
      publicKeysByKid,
      // IM-T2 defense — see intent-fintech-acp/src/index.ts for full note.
      expectedVerifyTokenJti: 'jti_demo_finra_01',
      now: nowMs,
    });
    const mismatches =
      outcome.kind === 'denied' && outcome.reason.kind === 'reconciliation_mismatch'
        ? outcome.reason.result.mismatches
        : outcome.kind === 'approved'
          ? outcome.result.mismatches
          : [];
    return {
      label,
      decision: outcome.kind,
      reason: outcome.kind === 'denied' ? outcome.reason.kind : undefined,
      mismatches: mismatches.map((m) => ({ kind: m.kind, detail: m.detail })),
    };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo()
    .then((outcomes) => {
      console.log('AEGIS Intent Manifest — Broker-dealer FINRA demo\n');
      for (const o of outcomes) {
        const reasonPart = o.reason ? ` reason=${o.reason}` : '';
        console.log(`[${o.label}] decision=${o.decision}${reasonPart}`);
        for (const m of o.mismatches) {
          console.log(`  - ${m.kind}: ${m.detail}`);
        }
      }
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
