// Agentic Commerce Protocol (ACP) merchant — AEGIS Intent Manifest end-to-end demo.
//
// Scenario: an AI shopping agent acts for a user buying flowers at ACME-FLORIST.
// The agent (via AEGIS) issues a signed intent manifest declaring it will charge
// up to $200 USD at ACME-FLORIST, exactly once. The merchant verifies the manifest
// locally (no AEGIS API in the request path), processes the charge, then reconciles
// the actuals: clean = approved, over-cap or wrong-merchant = denied.
//
// On detected mismatch, the merchant emits INTENT_MISMATCH_OBSERVED to AEGIS
// asynchronously. The agent's trust score drops by ≤300 per scoring window
// (apps/api/src/modules/bate/bate.weights.ts:57); the next /v1/verify against
// ANY relying party returns TRUST_SCORE_TOO_LOW — the penalty travels with the
// agent across the entire AEGIS-protected surface area.
//
// This file runs OFFLINE — no AEGIS API required. In production the signing
// happens at POST /v1/intent (apps/api/src/modules/intent/), and the merchant
// pulls the verification JWKS from /.well-known/audit-signing-key.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

import {
  signManifest,
  type ActualCallObservation,
  type IntentManifestBody,
} from '@aegis/intent-manifest';
import { verifyIntent } from '@aegis/verifier-rp';

// Sync sha512 hook for @noble/ed25519 — required for synchronous sign/verify
// in environments where the dynamic sha512 import is too slow (CF Workers,
// Deno). Same pattern as packages/intent-manifest/src/manifest.ts.
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
  // 1. Keypair. AEGIS holds this in KMS in production (M-051); the merchant
  //    pulls the public key from /.well-known/audit-signing-key.
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const kid = 'kid-acp-demo-2026-05';

  // 2. The agent's declared intent — bounded action commitment.
  const body: IntentManifestBody = {
    schemaVersion: 1,
    manifestId: 'int_acp_demo_01',
    issuedAt: now,
    expiresAt: now + 60,
    principalId: 'prn_acme_florist_demo',
    agentId: 'agt_shopper_demo',
    intent: {
      kind: 'commerce-action',
      action: 'acp.payment',
      merchantId: 'ACME-FLORIST',
      maxCalls: 1,
      amountCap: { amount: '200.00', currency: 'USD' },
    },
    reconciliation: { strictness: 'strict' },
    verifyTokenJti: 'jti_demo_acp_01',
    verifyTokenSha256B64Url: 'demo-token-hash',
  };

  const signed = signManifest(body, priv, kid);
  const publicKeysByKid = { [kid]: pub };
  const nowMs = () => now * 1000;

  // 3. Three reconciliation paths the merchant exercises in turn.
  const scenarios: ReadonlyArray<readonly [string, ActualCallObservation]> = [
    [
      'happy-path',
      {
        observedAt: now + 5,
        kind: 'commerce-action',
        payload: {
          action: 'acp.payment',
          merchantId: 'ACME-FLORIST',
          amount: '187.50',
          currency: 'USD',
        },
      },
    ],
    [
      'over-amount-cap',
      {
        observedAt: now + 5,
        kind: 'commerce-action',
        payload: {
          action: 'acp.payment',
          merchantId: 'ACME-FLORIST',
          amount: '250.00',
          currency: 'USD',
        },
      },
    ],
    [
      'wrong-merchant',
      {
        observedAt: now + 5,
        kind: 'commerce-action',
        payload: {
          action: 'acp.payment',
          merchantId: 'ROGUE-MERCHANT',
          amount: '187.50',
          currency: 'USD',
        },
      },
    ],
  ];

  return scenarios.map(([label, actual]) => {
    const outcome = verifyIntent({
      manifest: signed,
      actuals: [actual],
      publicKeysByKid,
      // IM-T2 defense: bind the manifest to the verify-token the RP is
      // about to honor. In production, extract this from the JWT's jti
      // claim via your existing AegisVerifier decode.
      expectedVerifyTokenJti: 'jti_demo_acp_01',
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
      console.log('AEGIS Intent Manifest — ACP merchant demo\n');
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
