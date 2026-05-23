// Cross-package parity test — API signer ↔ audit-verifier verifier.
//
// Why this exists (THE load-bearing test):
//   The signer in `apps/api/src/common/crypto/audit-chain.util.ts` and
//   the verifier in `packages/audit-verifier/src/chain.ts` each
//   implement an INDEPENDENT canonicalization of the audit payload.
//   The two ports are intentionally separate (per ADR-0003: the
//   verifier must run on Cloudflare Workers / browsers without
//   NestJS imports). Two independent ports = two opportunities for
//   silent drift.
//
//   This test is the single canonical regression guard. If it fails,
//   the audit chain stops being externally verifiable — the entire
//   SOC 2 / ISO 27001 evidence story breaks. Treat any failure here
//   as SEV-1.
//
// Run via the workspace harness — `pnpm vitest run` from repo root,
// or `pnpm -r test --filter ...tests/cross-package`.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { describe, expect, it, beforeAll } from 'vitest';

import { AuditChainUtil } from '../../apps/api/src/common/crypto/audit-chain.util';
import { encodeBase64Url as apiEncodeBase64Url } from '../../apps/api/src/common/crypto/ed25519.util';
import { verifyChain } from '../../packages/audit-verifier/src/chain';
import { encodeBase64Url as verifierEncodeBase64Url } from '../../packages/audit-verifier/src/canonical';
import type { AuditEventRow, JwksDocument } from '../../packages/audit-verifier/src/types';
import type {
  AuditChainPayload,
  AuditChainPayloadInput,
} from '../../apps/api/src/common/crypto/audit-chain.util';

beforeAll(() => {
  // Both packages set `ed.etc.sha512Sync` in their own bootstrap. We
  // re-set here so the test runner inherits a known-good handler
  // regardless of which import order vitest picks.
  ed.etc.sha512Sync = (...m): Uint8Array => sha512(ed.etc.concatBytes(...m));
});

// ── Fixtures ─────────────────────────────────────────────────────────

const util = new AuditChainUtil();
const KID = 'kid-cross-package-test-2026';

function basePayloadInput(seed: number): AuditChainPayloadInput {
  return {
    agentId: `agt_${seed}`,
    claimedAgentId: `agt_${seed}`,
    principalId: 'pri_test',
    decision: seed % 2 === 0 ? 'APPROVED' : 'DENIED',
    denialReason: seed % 2 === 0 ? null : 'INVALID_SIGNATURE',
    policyId: 'pol_test',
    trustScoreAtEvent: 600 + (seed % 50),
    trustBandAtEvent: 'VERIFIED',
    currency: 'USD',
    timestamp: `2026-05-05T00:00:${String(seed).padStart(2, '0')}.000Z`,
    action: seed % 3 === 0 ? null : 'commerce.purchase',
    relyingParty: seed % 4 === 0 ? null : 'delta.com',
    requestedAmount: '347.00',
    policySnapshot: [{ category: 'commerce' }],
  };
}

async function generateKeypair(): Promise<{
  priv: Uint8Array;
  pub: Uint8Array;
  pubB64Url: string;
}> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pub, pubB64Url: apiEncodeBase64Url(pub) };
}

interface BuiltRow {
  apiRow: AuditEventRow;
  payload: AuditChainPayload;
}

async function signRow(
  util: AuditChainUtil,
  privateKey: Uint8Array,
  eventId: string,
  prevEventId: string | null,
  prevSignatureB64Url: string | null,
  input: AuditChainPayloadInput,
): Promise<BuiltRow> {
  const built = util.buildPayload(input);
  const signature = await util.sign(
    {
      eventId,
      prevEventId,
      prevSignatureB64Url,
      payload: built.signed,
    },
    privateKey,
  );
  return {
    apiRow: {
      eventId,
      prevEventId,
      prevSignature: prevSignatureB64Url,
      signingKeyId: KID,
      signature,
      payload: built.signed,
    },
    payload: built.signed,
  };
}

// ── The parity test ──────────────────────────────────────────────────

describe('audit-chain parity — API signer ↔ @cerniq/audit-verifier', () => {
  it('verifier accepts an API-signed 5-row chain', async () => {
    const { priv, pubB64Url } = await generateKeypair();
    const rows: AuditEventRow[] = [];
    let prevEventId: string | null = null;
    let prevSignature: string | null = null;
    for (let i = 0; i < 5; i++) {
      const built = await signRow(
        util,
        priv,
        `evt_${i}`,
        prevEventId,
        prevSignature,
        basePayloadInput(i),
      );
      rows.push(built.apiRow);
      prevEventId = built.apiRow.eventId;
      prevSignature = built.apiRow.signature;
    }
    const jwks: JwksDocument = {
      keys: [{ kty: 'OKP', crv: 'Ed25519', x: pubB64Url, kid: KID, use: 'sig' }],
    };
    const report = await verifyChain(rows, { jwks });
    expect(report.valid).toBe(true);
    expect(report.totalRows).toBe(5);
    expect(report.firstBreak).toBeNull();
  });

  it('verifier rejects an API-signed chain after one byte of payload mutation', async () => {
    const { priv, pubB64Url } = await generateKeypair();
    const built = await signRow(util, priv, 'evt_x', null, null, basePayloadInput(1));
    // Tamper: mutate trustScoreAtEvent post-signing.
    built.apiRow.payload.trustScoreAtEvent = 1;
    const jwks: JwksDocument = {
      keys: [{ kty: 'OKP', crv: 'Ed25519', x: pubB64Url, kid: KID, use: 'sig' }],
    };
    const report = await verifyChain([built.apiRow], { jwks });
    expect(report.valid).toBe(false);
    expect(report.firstBreak?.signatureValid).toBe(false);
  });

  it('verifier handles GDPR-redactable payload shape (v2 commitment hashes)', async () => {
    // Round-trip a payload where some fields are null (representing
    // either originally-absent OR redacted-via-GDPR-Art-17 values).
    const { priv, pubB64Url } = await generateKeypair();
    const input = basePayloadInput(7);
    input.action = null; // simulate redacted action field
    input.relyingParty = null; // simulate redacted RP field
    const built = await signRow(util, priv, 'evt_redacted', null, null, input);
    const jwks: JwksDocument = {
      keys: [{ kty: 'OKP', crv: 'Ed25519', x: pubB64Url, kid: KID, use: 'sig' }],
    };
    const report = await verifyChain([built.apiRow], { jwks });
    expect(report.valid).toBe(true);
    // The signature held even with null PII commitments — ADR-0006
    // in practice.
    expect(built.apiRow.payload.actionHash).toBeNull();
    expect(built.apiRow.payload.relyingPartyHash).toBeNull();
  });

  it('verifier detects chain-link mismatch when a row is dropped', async () => {
    const { priv, pubB64Url } = await generateKeypair();
    const rows: AuditEventRow[] = [];
    let prevEventId: string | null = null;
    let prevSignature: string | null = null;
    for (let i = 0; i < 3; i++) {
      const built = await signRow(
        util,
        priv,
        `evt_${i}`,
        prevEventId,
        prevSignature,
        basePayloadInput(i),
      );
      rows.push(built.apiRow);
      prevEventId = built.apiRow.eventId;
      prevSignature = built.apiRow.signature;
    }
    // Drop the middle row. Row[2] now claims a prev pointer that
    // doesn't match what the verifier observed (row[0]).
    const report = await verifyChain([rows[0]!, rows[2]!], {
      jwks: { keys: [{ kty: 'OKP', crv: 'Ed25519', x: pubB64Url, kid: KID, use: 'sig' }] },
    });
    expect(report.valid).toBe(false);
    expect(report.firstBreak?.chainLinkValid).toBe(false);
  });

  it('encodeBase64Url byte-identical between API and verifier ports', () => {
    // Tiny but high-leverage: if base64url encoding ever drifts (e.g.
    // padding handling change) every signature breaks at the wire
    // boundary. This locks the two ports byte-equal.
    const samples: Uint8Array[] = [
      new Uint8Array([0]),
      new Uint8Array([0xff]),
      new Uint8Array([0xfb, 0xff, 0xbf]), // bytes that map to + and / in base64
      new Uint8Array(32).fill(0x42), // realistic Ed25519-key-shape
      new Uint8Array(64).fill(0xab), // realistic signature-shape
    ];
    for (const bytes of samples) {
      expect(verifierEncodeBase64Url(bytes)).toBe(apiEncodeBase64Url(bytes));
    }
  });
});
