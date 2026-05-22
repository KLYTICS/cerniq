import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { sha512 } from '@noble/hashes/sha2';
import { describe, it, expect } from 'vitest';

import { canonicalize, encodeBase64Url, utf8 } from './canonical.js';
import { buildSignedMessage, computePrevHash, verifyChain } from './chain.js';
import type { AuditChainPayload, AuditEventRow, JwksDocument } from './types.js';

ed.etc.sha512Sync = (...m): Uint8Array => sha512(ed.etc.concatBytes(...m));

// ── Test fixtures: synthesise a 3-row chain signed with a known keypair ──

async function makeKeypair() {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

function basePayload(decision: AuditChainPayload['decision']): AuditChainPayload {
  return {
    agentId: 'ag_test',
    claimedAgentId: 'ag_test',
    principalId: 'pri_test',
    decision,
    denialReason: decision === 'DENIED' ? 'INVALID_SIGNATURE' : null,
    policyId: 'po_test',
    trustScoreAtEvent: 750,
    trustBandAtEvent: 'PLATINUM',
    currency: 'USD',
    timestamp: '2026-05-05T00:00:00.000Z',
    actionHash: null,
    relyingPartyHash: null,
    requestedAmountHash: null,
    policySnapshotHash: null,
    v: 2,
  };
}

async function buildChain(privateKey: Uint8Array, kid: string, count: number): Promise<AuditEventRow[]> {
  const rows: AuditEventRow[] = [];
  let prevEventId: string | null = null;
  let prevSignature: string | null = null;
  for (let i = 0; i < count; i++) {
    const eventId = `evt_${i}`;
    const payload = basePayload(i % 2 === 0 ? 'APPROVED' : 'DENIED');
    const message = buildSignedMessage(prevEventId, prevSignature, payload);
    const signature = encodeBase64Url(await ed.signAsync(message, privateKey));
    rows.push({ eventId, prevEventId, prevSignature, signingKeyId: kid, signature, payload });
    prevEventId = eventId;
    prevSignature = signature;
  }
  return rows;
}

function jwksFor(kid: string, publicKey: Uint8Array): JwksDocument {
  return {
    keys: [{ kty: 'OKP', crv: 'Ed25519', x: encodeBase64Url(publicKey), kid, use: 'sig' }],
  };
}

// ── computePrevHash unit ─────────────────────────────────────────────

describe('computePrevHash', () => {
  it('returns the genesis hash when both inputs are null', () => {
    const got = computePrevHash(null, null);
    const expected = sha256(utf8('OKORO-AUDIT-GENESIS-v1'));
    expect(Array.from(got)).toEqual(Array.from(expected));
  });

  it('throws when only one of the two prev fields is null', () => {
    expect(() => computePrevHash('evt_1', null)).toThrow(/both/);
    expect(() => computePrevHash(null, 'sig')).toThrow(/both/);
  });

  it('combines prev signature bytes with prev event id', () => {
    const got = computePrevHash('evt_1', encodeBase64Url(new Uint8Array([0xaa, 0xbb])));
    expect(got.length).toBe(32);
  });
});

// ── End-to-end chain verification ────────────────────────────────────

describe('verifyChain (intact path)', () => {
  it('reports valid=true for a freshly-signed 3-row chain', async () => {
    const kp = await makeKeypair();
    const rows = await buildChain(kp.privateKey, 'kid-test-2026', 3);
    const report = await verifyChain(rows, { jwks: jwksFor('kid-test-2026', kp.publicKey) });
    expect(report.valid).toBe(true);
    expect(report.totalRows).toBe(3);
    expect(report.signingKeys).toEqual(['kid-test-2026']);
    expect(report.firstBreak).toBeNull();
  });

  it('records a rotation event when kid changes mid-stream', async () => {
    const kp1 = await makeKeypair();
    const kp2 = await makeKeypair();
    const old = await buildChain(kp1.privateKey, 'kid-2026-04', 2);
    // Continue the chain with a new kid — re-sign starting from the
    // last row of `old` so prev pointers stay correct.
    let prevEventId = old[old.length - 1]!.eventId;
    let prevSignature = old[old.length - 1]!.signature;
    const newer: AuditEventRow[] = [];
    for (let i = 0; i < 2; i++) {
      const eventId = `evt_n${i}`;
      const payload = basePayload('APPROVED');
      const message = buildSignedMessage(prevEventId, prevSignature, payload);
      const signature = encodeBase64Url(await ed.signAsync(message, kp2.privateKey));
      newer.push({ eventId, prevEventId, prevSignature, signingKeyId: 'kid-2026-05', signature, payload });
      prevEventId = eventId;
      prevSignature = signature;
    }
    const jwks: JwksDocument = {
      keys: [
        { kty: 'OKP', crv: 'Ed25519', x: encodeBase64Url(kp1.publicKey), kid: 'kid-2026-04', use: 'sig' },
        { kty: 'OKP', crv: 'Ed25519', x: encodeBase64Url(kp2.publicKey), kid: 'kid-2026-05', use: 'sig' },
      ],
    };
    const report = await verifyChain([...old, ...newer], { jwks });
    expect(report.valid).toBe(true);
    expect(report.rotationEvents).toEqual([
      { atIndex: 2, fromKid: 'kid-2026-04', toKid: 'kid-2026-05' },
    ]);
  });
});

describe('verifyChain (break detection)', () => {
  it('flags a tampered payload', async () => {
    const kp = await makeKeypair();
    const rows = await buildChain(kp.privateKey, 'kid-test', 3);
    // Mutate the middle row's payload after signing.
    rows[1]!.payload.trustScoreAtEvent = 1; // was 750
    const report = await verifyChain(rows, { jwks: jwksFor('kid-test', kp.publicKey) });
    expect(report.valid).toBe(false);
    expect(report.firstBreak?.index).toBe(1);
    expect(report.firstBreak?.signatureValid).toBe(false);
  });

  it('flags a chain-link mismatch (dropped row)', async () => {
    const kp = await makeKeypair();
    const rows = await buildChain(kp.privateKey, 'kid-test', 3);
    // Drop the middle row — row[2] now claims a prev pointer that
    // doesn't match what the verifier observed (row[0]).
    const report = await verifyChain([rows[0]!, rows[2]!], {
      jwks: jwksFor('kid-test', kp.publicKey),
    });
    expect(report.valid).toBe(false);
    expect(report.firstBreak?.chainLinkValid).toBe(false);
    expect(report.firstBreak?.reason).toMatch(/chain link mismatch/);
  });

  it('reports unknown kid as a break', async () => {
    const kp = await makeKeypair();
    const rows = await buildChain(kp.privateKey, 'kid-test', 1);
    const wrongJwks: JwksDocument = {
      keys: [{ kty: 'OKP', crv: 'Ed25519', x: encodeBase64Url(kp.publicKey), kid: 'kid-other', use: 'sig' }],
    };
    const report = await verifyChain(rows, { jwks: wrongJwks });
    expect(report.valid).toBe(false);
    expect(report.firstBreak?.reason).toMatch(/not present in JWKS/);
  });

  it('continues walking when failFast=false', async () => {
    const kp = await makeKeypair();
    const rows = await buildChain(kp.privateKey, 'kid-test', 3);
    rows[0]!.payload.trustScoreAtEvent = 1; // tamper row 0
    const report = await verifyChain(rows, {
      jwks: jwksFor('kid-test', kp.publicKey),
      failFast: false,
    });
    expect(report.valid).toBe(false);
    expect(report.totalRows).toBe(3);
    // First break is still recorded but we walked the rest.
    expect(report.firstBreak?.index).toBe(0);
  });
});

describe('canonicalize parity with API signer expectations', () => {
  it('produces identical output regardless of property ordering', () => {
    const a = canonicalize(basePayload('APPROVED'));
    const reordered: AuditChainPayload = {
      v: 2,
      timestamp: '2026-05-05T00:00:00.000Z',
      decision: 'APPROVED',
      agentId: 'ag_test',
      claimedAgentId: 'ag_test',
      principalId: 'pri_test',
      denialReason: null,
      policyId: 'po_test',
      trustScoreAtEvent: 750,
      trustBandAtEvent: 'PLATINUM',
      currency: 'USD',
      actionHash: null,
      relyingPartyHash: null,
      requestedAmountHash: null,
      policySnapshotHash: null,
    };
    const b = canonicalize(reordered);
    expect(a).toBe(b);
  });
});
