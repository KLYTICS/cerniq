// Audit chain verifier spec — uses round-trip tests against a signer that
// mirrors apps/api/src/common/crypto/audit-chain.util.ts to prove byte-for-
// byte parity. A drift in canonicalization or prev_hash construction would
// surface here long before it surfaces in a live chain break.

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { describe, expect, it } from 'vitest';

import { b64uEncode } from '../src/_internal/b64u.js';
import {
  canonicalize,
  prevHash,
  verifyAuditChain,
  verifyAuditEvent,
  type AegisAuditEvent,
  type AegisAuditJwks,
  type AegisAuditPayload,
} from '../src/audit-chain.js';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();

// Test helper — mirrors AuditChainUtil.sign for round-tripping. If this
// helper drifts from the actual signer, every test passes but production
// signatures fail. Keep it byte-identical to the API implementation.
async function signEvent(
  prevId: string | null,
  prevSig: string | null,
  payload: AegisAuditPayload,
  privKey: Uint8Array,
): Promise<string> {
  const prev = prevHash(prevId, prevSig);
  const canonical = enc.encode(canonicalize(payload));
  const message = new Uint8Array(prev.length + canonical.length);
  message.set(prev, 0);
  message.set(canonical, prev.length);
  const sig = await ed.signAsync(message, privKey);
  return b64uEncode(sig);
}

function newKeypair() {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  return { priv, pub, pubB64: b64uEncode(pub) };
}

function newId(): string {
  return 'evt_' + Math.random().toString(36).slice(2, 10);
}

function basePayload(overrides: Partial<AegisAuditPayload> = {}): AegisAuditPayload {
  return {
    v: 2,
    agentId: 'agent_test',
    claimedAgentId: 'agent_test',
    principalId: 'principal_test',
    decision: 'APPROVED',
    denialReason: null,
    policyId: 'pol_test',
    trustScoreAtEvent: 950,
    trustBandAtEvent: 'PLATINUM',
    currency: 'USD',
    timestamp: '2026-05-20T10:00:00.000Z',
    actionHash: null,
    relyingPartyHash: null,
    requestedAmountHash: null,
    policySnapshotHash: null,
    ...overrides,
  };
}

describe('canonicalize', () => {
  it('sorts object keys deterministically', () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 });
    const b = canonicalize({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it('sorts recursively', () => {
    const out = canonicalize({ z: { b: 1, a: 2 }, a: [{ y: 1, x: 2 }] });
    expect(out).toBe('{"a":[{"x":2,"y":1}],"z":{"a":2,"b":1}}');
  });

  it('passes null and primitives through', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('hi')).toBe('"hi"');
  });
});

describe('prevHash', () => {
  it('returns sha256(GENESIS_SENTINEL) when both args null', () => {
    const h1 = prevHash(null, null);
    const h2 = sha256(enc.encode('AEGIS-AUDIT-GENESIS-v1'));
    expect(h1).toEqual(h2);
  });

  it('throws if one of the args is null but not the other', () => {
    expect(() => prevHash('evt_x', null)).toThrow(/must both be set or both be null/);
    expect(() => prevHash(null, 'sig_x')).toThrow(/must both be set or both be null/);
  });

  it('is deterministic for identical inputs', () => {
    const a = prevHash('evt_1', 'AAAA');
    const b = prevHash('evt_1', 'AAAA');
    expect(a).toEqual(b);
  });
});

describe('verifyAuditEvent (single)', () => {
  it('verifies a genesis event signed locally', async () => {
    const { priv, pubB64 } = newKeypair();
    const payload = basePayload();
    const sig = await signEvent(null, null, payload, priv);
    const ev: AegisAuditEvent = {
      id: newId(),
      prevEventId: null,
      prevSignatureB64Url: null,
      signature: sig,
      signingKeyId: 'kid-1',
      payload,
    };
    expect(await verifyAuditEvent(ev, null, null, pubB64)).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const { priv, pubB64 } = newKeypair();
    const payload = basePayload();
    const sig = await signEvent(null, null, payload, priv);
    const ev: AegisAuditEvent = {
      id: newId(),
      prevEventId: null,
      prevSignatureB64Url: null,
      signature: sig,
      signingKeyId: 'kid-1',
      payload: { ...payload, trustScoreAtEvent: 1 }, // tampered
    };
    expect(await verifyAuditEvent(ev, null, null, pubB64)).toBe(false);
  });

  it('rejects when caller-supplied prev pointers disagree with the event', async () => {
    const { priv, pubB64 } = newKeypair();
    const payload = basePayload();
    const sig = await signEvent(null, null, payload, priv);
    const ev: AegisAuditEvent = {
      id: newId(),
      prevEventId: null,
      prevSignatureB64Url: null,
      signature: sig,
      signingKeyId: 'kid-1',
      payload,
    };
    // Caller claims this event follows evt_x — it doesn't.
    expect(await verifyAuditEvent(ev, 'evt_x', 'sig_x', pubB64)).toBe(false);
  });

  it('rejects with a wrong public key', async () => {
    const { priv } = newKeypair();
    const wrong = newKeypair();
    const payload = basePayload();
    const sig = await signEvent(null, null, payload, priv);
    const ev: AegisAuditEvent = {
      id: newId(),
      prevEventId: null,
      prevSignatureB64Url: null,
      signature: sig,
      signingKeyId: 'kid-1',
      payload,
    };
    expect(await verifyAuditEvent(ev, null, null, wrong.pubB64)).toBe(false);
  });
});

describe('verifyAuditChain (sequence)', () => {
  it('verifies a 5-event chain end-to-end', async () => {
    const { priv, pubB64 } = newKeypair();
    const jwks: AegisAuditJwks = {
      keys: [{ kid: 'kid-1', kty: 'OKP', crv: 'Ed25519', x: pubB64 }],
    };
    const events: AegisAuditEvent[] = [];
    let prevId: string | null = null;
    let prevSig: string | null = null;
    for (let i = 0; i < 5; i++) {
      const id = newId();
      const payload = basePayload({
        timestamp: new Date(Date.UTC(2026, 4, 20, 10, i)).toISOString(),
      });
      const sig = await signEvent(prevId, prevSig, payload, priv);
      events.push({
        id,
        prevEventId: prevId,
        prevSignatureB64Url: prevSig,
        signature: sig,
        signingKeyId: 'kid-1',
        payload,
      });
      prevId = id;
      prevSig = sig;
    }
    const result = await verifyAuditChain(events, jwks);
    expect(result.valid).toBe(true);
    expect(result.verified).toBe(5);
    expect(result.brokenAt).toBeUndefined();
  });

  it('reports BROKEN_PREV_LINK when an event is reordered', async () => {
    const { priv, pubB64 } = newKeypair();
    const jwks: AegisAuditJwks = {
      keys: [{ kid: 'kid-1', kty: 'OKP', crv: 'Ed25519', x: pubB64 }],
    };
    const events: AegisAuditEvent[] = [];
    let prevId: string | null = null;
    let prevSig: string | null = null;
    for (let i = 0; i < 3; i++) {
      const id = newId();
      const payload = basePayload({
        timestamp: new Date(Date.UTC(2026, 4, 20, 10, i)).toISOString(),
      });
      const sig = await signEvent(prevId, prevSig, payload, priv);
      events.push({
        id,
        prevEventId: prevId,
        prevSignatureB64Url: prevSig,
        signature: sig,
        signingKeyId: 'kid-1',
        payload,
      });
      prevId = id;
      prevSig = sig;
    }
    // Swap events[1] and events[2] — second event's prev pointers now
    // disagree with what verifier expects from events[0].
    [events[1], events[2]] = [events[2]!, events[1]!];

    const result = await verifyAuditChain(events, jwks);
    expect(result.valid).toBe(false);
    expect(result.verified).toBe(1);
    expect(result.brokenAt?.reason).toBe('BROKEN_PREV_LINK');
    expect(result.brokenAt?.index).toBe(1);
  });

  it('reports UNKNOWN_SIGNING_KEY when JWKS lacks the kid', async () => {
    const { priv } = newKeypair();
    const jwks: AegisAuditJwks = { keys: [] }; // empty
    const payload = basePayload();
    const sig = await signEvent(null, null, payload, priv);
    const events: AegisAuditEvent[] = [
      {
        id: newId(),
        prevEventId: null,
        prevSignatureB64Url: null,
        signature: sig,
        signingKeyId: 'kid-missing',
        payload,
      },
    ];
    const result = await verifyAuditChain(events, jwks);
    expect(result.valid).toBe(false);
    expect(result.brokenAt?.reason).toBe('UNKNOWN_SIGNING_KEY');
    expect(result.brokenAt?.detail).toContain('kid-missing');
  });

  it('reports INVALID_SIGNATURE when a payload is tampered mid-chain', async () => {
    const { priv, pubB64 } = newKeypair();
    const jwks: AegisAuditJwks = {
      keys: [{ kid: 'kid-1', kty: 'OKP', crv: 'Ed25519', x: pubB64 }],
    };
    const events: AegisAuditEvent[] = [];
    let prevId: string | null = null;
    let prevSig: string | null = null;
    for (let i = 0; i < 3; i++) {
      const id = newId();
      const payload = basePayload({
        timestamp: new Date(Date.UTC(2026, 4, 20, 10, i)).toISOString(),
      });
      const sig = await signEvent(prevId, prevSig, payload, priv);
      events.push({
        id,
        prevEventId: prevId,
        prevSignatureB64Url: prevSig,
        signature: sig,
        signingKeyId: 'kid-1',
        payload,
      });
      prevId = id;
      prevSig = sig;
    }
    // Tamper events[1]'s payload after signing. Its signature no longer
    // verifies, but its chain pointers still match events[0].id.
    events[1]!.payload.trustScoreAtEvent = 0;

    const result = await verifyAuditChain(events, jwks);
    expect(result.valid).toBe(false);
    expect(result.brokenAt?.reason).toBe('INVALID_SIGNATURE');
    expect(result.brokenAt?.index).toBe(1);
  });

  it('reports OUT_OF_ORDER_TIMESTAMP when a back-dated event appears', async () => {
    const { priv, pubB64 } = newKeypair();
    const jwks: AegisAuditJwks = {
      keys: [{ kid: 'kid-1', kty: 'OKP', crv: 'Ed25519', x: pubB64 }],
    };
    // Build two events with descending timestamps — possible only if
    // the signing key is compromised; this gate makes it observable.
    const p0 = basePayload({ timestamp: '2026-05-20T10:00:00.000Z' });
    const s0 = await signEvent(null, null, p0, priv);
    const id0 = newId();
    const p1 = basePayload({ timestamp: '2026-05-20T09:59:59.000Z' });
    const s1 = await signEvent(id0, s0, p1, priv);
    const id1 = newId();
    const events: AegisAuditEvent[] = [
      {
        id: id0,
        prevEventId: null,
        prevSignatureB64Url: null,
        signature: s0,
        signingKeyId: 'kid-1',
        payload: p0,
      },
      {
        id: id1,
        prevEventId: id0,
        prevSignatureB64Url: s0,
        signature: s1,
        signingKeyId: 'kid-1',
        payload: p1,
      },
    ];

    const result = await verifyAuditChain(events, jwks);
    expect(result.valid).toBe(false);
    expect(result.brokenAt?.reason).toBe('OUT_OF_ORDER_TIMESTAMP');
    expect(result.brokenAt?.index).toBe(1);
  });

  it('handles key rotation — different signingKeyId per range', async () => {
    const kp1 = newKeypair();
    const kp2 = newKeypair();
    const jwks: AegisAuditJwks = {
      keys: [
        { kid: 'kid-1', kty: 'OKP', crv: 'Ed25519', x: kp1.pubB64 },
        { kid: 'kid-2', kty: 'OKP', crv: 'Ed25519', x: kp2.pubB64 },
      ],
    };
    const p0 = basePayload({ timestamp: '2026-05-20T10:00:00.000Z' });
    const s0 = await signEvent(null, null, p0, kp1.priv);
    const id0 = newId();
    const p1 = basePayload({ timestamp: '2026-05-20T10:01:00.000Z' });
    const s1 = await signEvent(id0, s0, p1, kp2.priv); // signed by kp2 after rotation
    const id1 = newId();
    const events: AegisAuditEvent[] = [
      {
        id: id0,
        prevEventId: null,
        prevSignatureB64Url: null,
        signature: s0,
        signingKeyId: 'kid-1',
        payload: p0,
      },
      {
        id: id1,
        prevEventId: id0,
        prevSignatureB64Url: s0,
        signature: s1,
        signingKeyId: 'kid-2',
        payload: p1,
      },
    ];
    const result = await verifyAuditChain(events, jwks);
    expect(result.valid).toBe(true);
    expect(result.verified).toBe(2);
  });

  it('returns valid=false for an empty chain', async () => {
    const jwks: AegisAuditJwks = { keys: [] };
    const result = await verifyAuditChain([], jwks);
    expect(result.valid).toBe(false);
    expect(result.verified).toBe(0);
  });
});
