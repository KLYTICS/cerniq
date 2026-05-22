import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import {
  AuditEventRow,
  canonicalize,
  decodeB64Url,
  prevHash,
  rebuildPayload,
  verifyChain,
} from './audit-verify-chain.js';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();

function toB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function freshKeypair(): Promise<{ priv: Uint8Array; pubB64Url: string }> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pubB64Url: toB64Url(pub) };
}

/**
 * Sign one event using the same algorithm as audit-chain.util.ts. We
 * inline it here so the spec's signing logic is independent of the CLI's
 * verification logic — if either drifts, this spec catches it.
 */
async function signEvent(
  row: AuditEventRow,
  prevId: string | null,
  prevSig: string | null,
  priv: Uint8Array,
): Promise<string> {
  const prev = prevHash(prevId, prevSig);
  const canonical = enc.encode(canonicalize(rebuildPayload(row)));
  const sig = await ed.signAsync(Buffer.concat([prev, canonical]), priv);
  return toB64Url(sig);
}

function buildRow(overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: 'evt_1',
    agentId: 'agt_1',
    claimedAgentId: 'agt_1',
    principalId: 'prc_1',
    decision: 'APPROVED',
    denialReason: null,
    policyId: 'pol_1',
    trustScoreAtEvent: 700,
    trustBandAtEvent: 'VERIFIED',
    currency: 'USD',
    timestamp: new Date('2026-05-02T10:00:00Z'),
    actionHash: createHash('sha256').update('commerce.purchase').digest('base64url'),
    relyingPartyHash: createHash('sha256').update('rp_1').digest('base64url'),
    requestedAmountHash: null,
    policySnapshotHash: null,
    payloadVersion: 2,
    okoroSignature: '', // populated by signEvent
    ...overrides,
  };
}

describe('canonicalize', () => {
  it('sorts keys recursively', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ b: { y: 2, x: 1 }, a: 1 })).toBe('{"a":1,"b":{"x":1,"y":2}}');
  });

  it('handles arrays without sorting their elements', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles primitives + null', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize('s')).toBe('"s"');
    expect(canonicalize(7)).toBe('7');
  });
});

describe('prevHash', () => {
  it('returns the genesis hash when both args are null', () => {
    const h = prevHash(null, null);
    expect(h).toEqual(createHash('sha256').update('OKORO-AUDIT-GENESIS-v1').digest());
  });

  it('rejects partial inputs', () => {
    expect(() => prevHash('id', null)).toThrow(/both/);
    expect(() => prevHash(null, 'sig')).toThrow(/both/);
  });

  it('hashes prevSig bytes || prevId for non-genesis', () => {
    const sigB64 = toB64Url(new Uint8Array([1, 2, 3, 4]));
    const expected = createHash('sha256')
      .update(decodeB64Url(sigB64))
      .update('evt_42', 'utf8')
      .digest();
    expect(prevHash('evt_42', sigB64)).toEqual(expected);
  });
});

describe('verifyChain', () => {
  it('passes a 1-event genesis chain', async () => {
    const { priv, pubB64Url } = await freshKeypair();
    const row = buildRow();
    row.okoroSignature = await signEvent(row, null, null, priv);

    const out = await verifyChain([row], pubB64Url);
    expect(out.passed).toBe(1);
    expect(out.firstBreakAt).toBeNull();
  });

  it('passes a 3-event chain', async () => {
    const { priv, pubB64Url } = await freshKeypair();
    const a = buildRow({ id: 'evt_a' });
    a.okoroSignature = await signEvent(a, null, null, priv);
    const b = buildRow({ id: 'evt_b', timestamp: new Date('2026-05-02T10:00:01Z') });
    b.okoroSignature = await signEvent(b, a.id, a.okoroSignature, priv);
    const c = buildRow({ id: 'evt_c', timestamp: new Date('2026-05-02T10:00:02Z') });
    c.okoroSignature = await signEvent(c, b.id, b.okoroSignature, priv);

    const out = await verifyChain([a, b, c], pubB64Url);
    expect(out.passed).toBe(3);
    expect(out.firstBreakAt).toBeNull();
  });

  it('detects tampering of a payload field — first break flagged at the tampered event', async () => {
    const { priv, pubB64Url } = await freshKeypair();
    const a = buildRow({ id: 'evt_a' });
    a.okoroSignature = await signEvent(a, null, null, priv);
    const b = buildRow({ id: 'evt_b' });
    b.okoroSignature = await signEvent(b, a.id, a.okoroSignature, priv);

    // After signing, an attacker mutates the action hash on event b.
    b.actionHash = createHash('sha256').update('commerce.refund').digest('base64url');

    const out = await verifyChain([a, b], pubB64Url);
    expect(out.passed).toBe(1);
    expect(out.firstBreakAt).toBe(1);
  });

  it('detects a signature swapped from a different keypair', async () => {
    const { pubB64Url: pubA } = await freshKeypair();
    const { priv: privB } = await freshKeypair();
    const row = buildRow();
    row.okoroSignature = await signEvent(row, null, null, privB);

    const out = await verifyChain([row], pubA);
    expect(out.firstBreakAt).toBe(0);
    expect(out.firstBreakReason).toMatch(/signature failed/);
  });

  it('flags unsupported payload version with a typed reason', async () => {
    const { priv, pubB64Url } = await freshKeypair();
    const row = buildRow({ payloadVersion: 99 });
    row.okoroSignature = await signEvent(row, null, null, priv);

    const out = await verifyChain([row], pubB64Url);
    expect(out.firstBreakAt).toBe(0);
    expect(out.firstBreakReason).toMatch(/payloadVersion=99/);
  });

  it('reports passed count even when the chain breaks mid-stream', async () => {
    const { priv, pubB64Url } = await freshKeypair();
    const a = buildRow({ id: 'evt_a' });
    a.okoroSignature = await signEvent(a, null, null, priv);
    const b = buildRow({ id: 'evt_b' });
    b.okoroSignature = await signEvent(b, a.id, a.okoroSignature, priv);
    const c = buildRow({ id: 'evt_c' });
    // c is signed under a wrong prev (skip b) — chain break.
    c.okoroSignature = await signEvent(c, a.id, a.okoroSignature, priv);

    const out = await verifyChain([a, b, c], pubB64Url);
    expect(out.passed).toBe(2);
    expect(out.firstBreakAt).toBe(2);
  });

  it('invokes onEvent for every walked event', async () => {
    const { priv, pubB64Url } = await freshKeypair();
    const a = buildRow({ id: 'evt_a' });
    a.okoroSignature = await signEvent(a, null, null, priv);
    const visits: Array<{ idx: number; ok: boolean }> = [];

    await verifyChain([a], pubB64Url, (idx: number, _row: AuditEventRow, ok: boolean) => {
      visits.push({ idx, ok });
    });
    expect(visits).toEqual([{ idx: 0, ok: true }]);
  });
});
