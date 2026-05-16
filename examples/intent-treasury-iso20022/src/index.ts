// Treasury ISO 20022 (pacs.008) — AEGIS Intent Manifest demo for AI treasury agents.
//
// Scenario: an AI treasury agent at a corporate treasury management system (TMS)
// is executing a EUR 50,000 wire to vendor BENEF_GMBH_DE89AB for purpose code
// GDDS (purchase of goods). The treasury platform verifies the signed manifest,
// dispatches the SWIFT MT103 / ISO 20022 pacs.008 message, then reconciles the
// settlement notification against the declared intent.
//
// The chosen reconciliation policy is `graduated` with 5% tolerance — chosen
// to exercise the kernel's footgun on purpose: graduated mode tolerates
// over-call-count up to floor(maxCalls * 1.05), but NON-COUNT mismatches
// (wrong-beneficiary, over-amount-cap) remain STRICTLY denying regardless of
// the tolerance setting. See packages/intent-manifest/src/reconcile.ts:232.
// This is the right semantics for treasury: a one-off batch overrun is
// forgivable, but a wire to the wrong account is unrecoverable in seconds.
//
// ISO 20022 migration is in flight across SWIFT, Fedwire, and CHAPS through
// 2025–2027; AI treasury agents are emerging in major TMS platforms (Kyriba,
// SAP, Trovata). Cryptographic intent binding gives the treasury platform a
// non-repudiable supervision trail the auditor can replay.

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
  const kid = 'kid-treasury-iso20022-demo-2026-05';

  // Treasury intent: a single EUR 50,000 wire to BENEF_GMBH_DE89AB.
  // The beneficiary IBAN identity is encoded in merchantId — the kernel
  // doesn't ship an IBAN-specific field, but commerce-action's merchantId
  // is the semantic equivalent: the counterparty identity the intent
  // commits to. A wire-receiver mismatch fires the same wrong-merchant
  // mismatch kind the BATE scorer is wired for.
  const body: IntentManifestBody = {
    schemaVersion: 1,
    manifestId: 'int_treasury_iso20022_demo_01',
    issuedAt: now,
    expiresAt: now + 60,
    principalId: 'prn_acme_corp_treasury',
    agentId: 'agt_treasury_executor',
    intent: {
      kind: 'commerce-action',
      action: 'iso20022.pacs.008',
      merchantId: 'BENEF_GMBH_DE89AB',
      maxCalls: 1,
      amountCap: { amount: '50000.00', currency: 'EUR' },
    },
    reconciliation: { strictness: 'graduated', tolerance: 5 },
    verifyTokenJti: 'jti_demo_treasury_01',
    verifyTokenSha256B64Url: 'demo-token-hash',
  };

  const signed = signManifest(body, priv, kid);
  const publicKeysByKid = { [kid]: pub };
  const nowMs = () => now * 1000;

  const scenarios: ReadonlyArray<readonly [string, ActualCallObservation]> = [
    [
      'happy-path',
      {
        observedAt: now + 12,
        kind: 'commerce-action',
        payload: {
          action: 'iso20022.pacs.008',
          merchantId: 'BENEF_GMBH_DE89AB',
          amount: '49750.00',
          currency: 'EUR',
          purposeCode: 'GDDS',
          endToEndId: 'E2E-DEMO-2026-001',
        },
      },
    ],
    [
      'wrong-beneficiary-hijack',
      {
        observedAt: now + 12,
        kind: 'commerce-action',
        payload: {
          action: 'iso20022.pacs.008',
          merchantId: 'ROGUE_LLC_GB99XX',
          amount: '49750.00',
          currency: 'EUR',
          purposeCode: 'GDDS',
          endToEndId: 'E2E-DEMO-2026-001',
        },
      },
    ],
    [
      'over-amount-cap',
      {
        observedAt: now + 12,
        kind: 'commerce-action',
        payload: {
          action: 'iso20022.pacs.008',
          merchantId: 'BENEF_GMBH_DE89AB',
          amount: '55000.00',
          currency: 'EUR',
          purposeCode: 'GDDS',
          endToEndId: 'E2E-DEMO-2026-001',
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
      expectedVerifyTokenJti: 'jti_demo_treasury_01',
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
      console.log('AEGIS Intent Manifest — Treasury ISO 20022 demo\n');
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
