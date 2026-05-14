// Cross-package parity test — API NDJSON export shape ↔ @aegis/audit-verifier.
//
// SISTER TEST to `audit-chain-parity.spec.ts`. That one checks the
// canonicalization/signing math agrees between the two ports. This one
// checks the WIRE SHAPE of `/v1/agents/:id/audit/export.ndjson`.
//
// Why a separate test:
//   The export path in `apps/api/src/modules/audit/audit.service.ts`
//   reshapes a Prisma row into the `AuditExportRow` wire object. The
//   verifier package in `packages/audit-verifier` accepts an
//   `AuditEventRow` with five required fields plus a nested `payload`.
//   The export must produce a strict superset of `AuditEventRow`, AND
//   the `payload` field must be byte-identical to what the signer
//   wrote (otherwise canonicalize() produces different bytes and the
//   signature check fails).
//
//   If THIS spec fails, the documented SOC2 third-party-verifier flow
//   breaks the moment we deploy. SEV-1 — same as audit-chain-parity.
//
// Run via the workspace harness — `pnpm vitest run` or `pnpm test:parity`.

import { randomBytes } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { beforeAll, describe, expect, it } from 'vitest';

import { AuditChainUtil } from '../../apps/api/src/common/crypto/audit-chain.util';
import { encodeBase64Url as apiEncodeBase64Url } from '../../apps/api/src/common/crypto/ed25519.util';
import {
  toExportRow,
  rebuildSignedPayload,
} from '../../apps/api/src/modules/audit/audit.service';
import { computeKid } from '../../apps/api/src/modules/wellknown/wellknown.service';
import { verifyChain } from '../../packages/audit-verifier/src/chain';
import type {
  AuditEventRow,
  JwksDocument,
} from '../../packages/audit-verifier/src/types';
import type { AuditEvent as PrismaAuditEvent } from '@prisma/client';

beforeAll(() => {
  ed.etc.sha512Sync = (...m): Uint8Array => sha512(ed.etc.concatBytes(...m));
});

const util = new AuditChainUtil();

// ── Test helpers ─────────────────────────────────────────────────────

interface BuiltChainRow {
  prismaRow: PrismaAuditEvent;
  eventId: string;
  signature: string;
}

/**
 * Build an in-memory chain row in the same way `AuditService.appendInternal`
 * does, then synthesize the Prisma row that would have been persisted.
 *
 * This is "what AuditService writes to the DB". The next step
 * (`toExportRow`) is "what NDJSON export emits given that DB row".
 */
async function buildChainRow(args: {
  eventId: string;
  agentId: string | null;
  claimedAgentId: string | null;
  principalId: string;
  prev: { id: string; signature: string } | null;
  signingKeyId: string;
  privateKey: Uint8Array;
  seed: number;
}): Promise<BuiltChainRow> {
  const timestamp = new Date(`2026-05-12T12:00:${String(args.seed).padStart(2, '0')}.000Z`);
  // `AppendAuditInput.action` is required `string` in production, so we
  // never trigger the schema's `actionHash` empty-string substitution
  // path. relyingParty IS nullable end-to-end (the schema column is
  // nullable + the chain util emits a null hash), so we exercise that
  // both ways.
  const action = 'commerce.purchase';
  const relyingParty = args.seed % 4 === 0 ? null : 'delta.com';
  const built = util.buildPayload({
    agentId: args.agentId ?? args.claimedAgentId ?? '__no_agent__',
    claimedAgentId: args.claimedAgentId,
    principalId: args.principalId,
    decision: args.seed % 2 === 0 ? 'APPROVED' : 'DENIED',
    denialReason: args.seed % 2 === 0 ? null : 'INVALID_SIGNATURE',
    policyId: 'pol_test',
    trustScoreAtEvent: 600 + (args.seed % 50),
    trustBandAtEvent: 'VERIFIED',
    currency: 'USD',
    timestamp: timestamp.toISOString(),
    action,
    relyingParty,
    requestedAmount: '347.00',
    policySnapshot: [{ category: 'commerce' }],
  });
  const signature = await util.sign(
    {
      eventId: args.eventId,
      prevEventId: args.prev?.id ?? null,
      prevSignatureB64Url: args.prev?.signature ?? null,
      payload: built.signed,
    },
    args.privateKey,
  );
  // Synthesize the Prisma row exactly as `AuditService.appendInternal`
  // would have persisted it. If the signer's `auditEvent.create` data
  // grows a field, this MUST grow with it (mirror invariant).
  const prismaRow: PrismaAuditEvent = {
    id: args.eventId,
    agentId: args.agentId,
    claimedAgentId: args.claimedAgentId,
    principalId: args.principalId,
    action,
    decision: built.signed.decision as PrismaAuditEvent['decision'],
    denialReason: built.signed.denialReason,
    relyingParty,
    requestedAmount: new (require('@prisma/client/runtime/library').Decimal)('347.00'),
    currency: built.signed.currency,
    policyId: built.signed.policyId,
    policySnapshot: [{ category: 'commerce' }],
    actionHash: built.rawHashes.actionHash ?? util.hashLeaf('')!,
    relyingPartyHash: built.rawHashes.relyingPartyHash,
    requestedAmountHash: built.rawHashes.requestedAmountHash,
    policySnapshotHash: built.rawHashes.policySnapshotHash,
    redactedAt: null,
    redactionReason: null,
    trustScoreAtEvent: built.signed.trustScoreAtEvent,
    trustBandAtEvent: built.signed.trustBandAtEvent as PrismaAuditEvent['trustBandAtEvent'],
    aegisSignature: signature,
    payloadVersion: 2,
    prevEventId: args.prev?.id ?? null,
    prevSignature: args.prev?.signature ?? null,
    signingKeyId: args.signingKeyId,
    policyEngineId: null,
    engineMetadata: null,
    relyingPartyId: null,
    timestamp,
  };
  return { prismaRow, eventId: args.eventId, signature };
}

async function generateKeypair(): Promise<{ priv: Uint8Array; pubBytes: Uint8Array; pubB64Url: string }> {
  const priv = ed.utils.randomPrivateKey();
  const pubBytes = await ed.getPublicKeyAsync(priv);
  return { priv, pubBytes, pubB64Url: apiEncodeBase64Url(pubBytes) };
}

// ── The parity tests ─────────────────────────────────────────────────

describe('audit-export ↔ @aegis/audit-verifier parity', () => {
  it('toExportRow output verifies cleanly through verifyChain (5-row chain)', async () => {
    const { priv, pubBytes, pubB64Url } = await generateKeypair();
    const kid = computeKid(pubBytes);
    const rows: AuditEventRow[] = [];
    let prev: { id: string; signature: string } | null = null;
    for (let i = 0; i < 5; i++) {
      const eventId = `evt_${i.toString().padStart(2, '0')}_${randomBytes(4).toString('hex')}`;
      const built = await buildChainRow({
        eventId,
        agentId: 'agt_chain',
        claimedAgentId: 'agt_chain',
        principalId: 'prn_test',
        prev,
        signingKeyId: kid,
        privateKey: priv,
        seed: i,
      });
      const exported = toExportRow(built.prismaRow);
      // Cast to the verifier's `AuditEventRow` — our export shape is
      // a structural superset.
      rows.push(exported as unknown as AuditEventRow);
      prev = { id: eventId, signature: built.signature };
    }

    const jwks: JwksDocument = {
      keys: [{ kty: 'OKP', crv: 'Ed25519', x: pubB64Url, kid, use: 'sig' }],
    };
    const report = await verifyChain(rows, { jwks });
    expect(report.valid).toBe(true);
    expect(report.totalRows).toBe(5);
    expect(report.firstBreak).toBeNull();
    // Cross-check: every exported row's `signingKeyId` matches the
    // published JWK. This is the assertion that was failing in
    // production before M-038 (all rows had `kid-genesis-v1`).
    for (const r of rows) {
      expect(r.signingKeyId).toBe(kid);
    }
    // And the chain-link columns are NOT NULL after the first row.
    expect(rows[0]!.prevEventId).toBeNull();
    expect(rows[0]!.prevSignature).toBeNull();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.prevEventId).toBe(rows[i - 1]!.eventId);
      expect(rows[i]!.prevSignature).toBe(rows[i - 1]!.signature);
    }
  });

  it('toExportRow `payload` is byte-identical to what the signer signed', async () => {
    // The verifier reconstructs the signed message from
    // `row.payload`. If `rebuildSignedPayload` ever diverges from the
    // signer's `buildPayload({...})` call, signature verification fails
    // even though the row is well-formed. This test pins them together.
    const { priv } = await generateKeypair();
    const built = await buildChainRow({
      eventId: 'evt_solo',
      agentId: 'agt_solo',
      claimedAgentId: 'agt_solo',
      principalId: 'prn_test',
      prev: null,
      signingKeyId: 'kid-test',
      privateKey: priv,
      seed: 9,
    });
    const exported = toExportRow(built.prismaRow);
    const rebuilt = rebuildSignedPayload(built.prismaRow);
    // Same object identity not required, but the canonical bytes must match.
    expect(util.canonicalize(exported.payload)).toBe(util.canonicalize(rebuilt));
  });

  it('AGENT_NOT_FOUND row (agentId=null) reconstructs payload via claimedAgentId fallback', async () => {
    // When a verify call references an agent that doesn't exist, the
    // audit row has `agentId=null` and `claimedAgentId="<the bad id>"`.
    // The signer falls back to `claimedAgentId` for the SIGNED
    // `agentId` field. `rebuildSignedPayload` must apply the same
    // fallback or the verifier will canonicalize different bytes.
    const { priv, pubBytes, pubB64Url } = await generateKeypair();
    const kid = computeKid(pubBytes);
    const built = await buildChainRow({
      eventId: 'evt_nf',
      agentId: null,
      claimedAgentId: 'agt_does_not_exist',
      principalId: 'prn_test',
      prev: null,
      signingKeyId: kid,
      privateKey: priv,
      seed: 11,
    });
    const exported = toExportRow(built.prismaRow);
    expect(exported.payload.agentId).toBe('agt_does_not_exist');
    expect(exported.payload.claimedAgentId).toBe('agt_does_not_exist');

    const report = await verifyChain([exported as unknown as AuditEventRow], {
      jwks: { keys: [{ kty: 'OKP', crv: 'Ed25519', x: pubB64Url, kid, use: 'sig' }] },
    });
    expect(report.valid).toBe(true);
  });

  it('legacy row with kid not in JWKS is reported as unverifiable, not silently passed', async () => {
    // Pre-M-038 rows have `signingKeyId='kid-genesis-v1'` baked in
    // because the env-fallback path used that placeholder. Their
    // signatures are still valid against the published Ed25519 key,
    // but their kid will not resolve in JWKS unless an operator
    // publishes a `kid-genesis-v1` alias entry. The verifier should
    // report this as a break, NOT pass silently — auditors need to
    // see the gap.
    const { priv, pubBytes, pubB64Url } = await generateKeypair();
    const realKid = computeKid(pubBytes);
    const built = await buildChainRow({
      eventId: 'evt_legacy',
      agentId: 'agt_legacy',
      claimedAgentId: 'agt_legacy',
      principalId: 'prn_test',
      prev: null,
      signingKeyId: 'kid-genesis-v1', // <- the historical placeholder
      privateKey: priv,
      seed: 3,
    });
    const exported = toExportRow(built.prismaRow);
    const report = await verifyChain([exported as unknown as AuditEventRow], {
      jwks: { keys: [{ kty: 'OKP', crv: 'Ed25519', x: pubB64Url, kid: realKid, use: 'sig' }] },
    });
    expect(report.valid).toBe(false);
    expect(report.firstBreak?.reason).toMatch(/not present in JWKS/);
  });
});
