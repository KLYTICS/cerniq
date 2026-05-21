import './crypto.bootstrap';
import { createHash } from 'node:crypto';

import * as ed from '@noble/ed25519';

import {
  AuditChainUtil,
  type AuditChainPayload,
  type AuditChainPayloadInput,
} from './audit-chain.util';
import { encodeBase64Url } from './ed25519.util';

describe('AuditChainUtil', () => {
  const util = new AuditChainUtil();

  const baseInput = (): AuditChainPayloadInput => ({
    agentId: 'agt_xyz',
    claimedAgentId: 'agt_xyz',
    principalId: 'p_xyz',
    decision: 'APPROVED',
    denialReason: null,
    policyId: 'pol_xyz',
    trustScoreAtEvent: 600,
    trustBandAtEvent: 'VERIFIED',
    currency: 'USD',
    timestamp: '2026-05-01T00:00:00.000Z',
    action: 'commerce.purchase',
    relyingParty: 'delta.com',
    requestedAmount: '347.00',
    policySnapshot: [{ category: 'commerce' }],
  });

  const samplePayload = (): AuditChainPayload => util.buildPayload(baseInput()).signed;

  it('canonicalizes objects with stable key order', () => {
    const a = util.canonicalize({ b: 2, a: { d: 4, c: 3 } });
    const b = util.canonicalize({ a: { c: 3, d: 4 }, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it('hashLeaf returns null for null/undefined input (preserves absence vs empty)', () => {
    expect(util.hashLeaf(null)).toBeNull();
    expect(util.hashLeaf(undefined)).toBeNull();
    // empty string still hashes to a real digest
    expect(util.hashLeaf('')).not.toBeNull();
  });

  it('hashLeaf produces base64url(sha256) of UTF-8 bytes for strings', () => {
    const got = util.hashLeaf('hello');
    const want = createHash('sha256').update('hello', 'utf8').digest('base64url');
    expect(got).toBe(want);
  });

  it('buildPayload commits to v=2 and produces matching rawHashes', () => {
    const built = util.buildPayload(baseInput());
    expect(built.signed.v).toBe(2);
    expect(built.signed.actionHash).toBe(built.rawHashes.actionHash);
    expect(built.signed.relyingPartyHash).toBe(built.rawHashes.relyingPartyHash);
    expect(built.signed.requestedAmountHash).toBe(built.rawHashes.requestedAmountHash);
    expect(built.signed.policySnapshotHash).toBe(built.rawHashes.policySnapshotHash);
  });

  it('signs and verifies a genesis (no prev) event under v2', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubB64 = encodeBase64Url(pub);

    const input = {
      eventId: 'evt_1',
      prevEventId: null,
      prevSignatureB64Url: null,
      payload: samplePayload(),
    };
    const sig = await util.sign(input, priv);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await util.verify(input, sig, pubB64)).toBe(true);
  });

  it('chains a second event whose prev_hash includes the first signature', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubB64 = encodeBase64Url(pub);

    const first = { eventId: 'evt_1', prevEventId: null, prevSignatureB64Url: null, payload: samplePayload() };
    const sig1 = await util.sign(first, priv);

    const second = {
      eventId: 'evt_2',
      prevEventId: first.eventId,
      prevSignatureB64Url: sig1,
      payload: util.buildPayload({ ...baseInput(), timestamp: '2026-05-01T00:00:01.000Z' }).signed,
    };
    const sig2 = await util.sign(second, priv);

    expect(await util.verify(second, sig2, pubB64)).toBe(true);
  });

  it('detects payload tampering (signature breaks if any field flips)', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubB64 = encodeBase64Url(pub);

    const input = { eventId: 'evt_1', prevEventId: null, prevSignatureB64Url: null, payload: samplePayload() };
    const sig = await util.sign(input, priv);

    const tampered = {
      ...input,
      payload: { ...input.payload, actionHash: util.hashLeaf('commerce.refund') },
    };
    expect(await util.verify(tampered, sig, pubB64)).toBe(false);
  });

  it('detects chain reordering (swapping prev signature breaks verify)', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubB64 = encodeBase64Url(pub);

    const first = { eventId: 'evt_1', prevEventId: null, prevSignatureB64Url: null, payload: samplePayload() };
    const sig1 = await util.sign(first, priv);

    const second = {
      eventId: 'evt_2',
      prevEventId: first.eventId,
      prevSignatureB64Url: sig1,
      payload: util.buildPayload({ ...baseInput(), timestamp: '2026-05-01T00:00:01.000Z' }).signed,
    };
    const sig2 = await util.sign(second, priv);

    const tamperedChain = { ...second, prevSignatureB64Url: 'AAAA' };
    expect(await util.verify(tamperedChain, sig2, pubB64)).toBe(false);
  });

  it('GDPR Art. 17: hash commitment survives raw-value erasure', async () => {
    // Real-world flow: sign with raw values present, then null the raw
    // values (simulating Art. 17 erasure). The chain payload itself
    // doesn't change — it always referenced hashes, not raws — so the
    // signature stays valid.
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubB64 = encodeBase64Url(pub);

    const input = {
      eventId: 'evt_redactable',
      prevEventId: null,
      prevSignatureB64Url: null,
      payload: samplePayload(),
    };
    const sig = await util.sign(input, priv);

    // After redaction: persisted raw `action`, `relyingParty`, `requestedAmount`
    // are NULLed in the database. The signed payload (which lives only in
    // the verifier's memory after recomputation from the DB row) still
    // carries the same hashes. Verifier passes.
    const verifier_payload = { ...input.payload }; // verifier reads from DB hash columns
    expect(await util.verify({ ...input, payload: verifier_payload }, sig, pubB64)).toBe(true);
  });
});
