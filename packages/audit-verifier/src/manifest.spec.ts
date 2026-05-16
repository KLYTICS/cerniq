// Manifest verification specs.
//
// Round-trip sign/verify; every documented tamper mode returns a typed
// reason; chain walk catches every tamper class.
//
// Cross-package byte-parity against the apps/api kernel is guarded by
// `tests/cross-package/audit-manifest-parity.spec.ts`.

import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';

import { canonicalize, encodeBase64Url, utf8 } from './canonical.js';
import {
  GLOBAL_SLICE,
  MANIFEST_GENESIS,
  canonicalSha256B64Url,
  hashManifestBody,
  prevManifestHash,
  rowChainAnchor,
  verifyManifest,
  walkManifestChain,
  type AuditCompressionManifestBody,
  type SignedAuditCompressionManifest,
} from './manifest.js';

async function genKeys(): Promise<{ priv: Uint8Array; pubB64: string }> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pubB64: encodeBase64Url(pub) };
}

async function signBody(
  body: AuditCompressionManifestBody,
  priv: Uint8Array,
): Promise<SignedAuditCompressionManifest> {
  const sig = await ed.signAsync(utf8(canonicalize(body)), priv);
  return { body, signatureB64Url: encodeBase64Url(sig), signatureAlg: 'ed25519' };
}

function body(o: Partial<AuditCompressionManifestBody> = {}): AuditCompressionManifestBody {
  return {
    v: 1,
    manifestId: '01HZZZAA0000000000000ABCDE',
    tenantSliceId: GLOBAL_SLICE,
    sliceStrategy: 'hybrid',
    firstSeq: 1,
    lastSeq: 1000,
    firstEventId: 'cuid_first',
    lastEventId: 'cuid_last',
    firstChainHashB64Url: null,
    lastChainHashB64Url: 'anchor-0',
    prevManifestId: null,
    prevManifestHashB64Url: prevManifestHash(null),
    rowCount: 1000,
    bytesUncompressed: 1024 * 512,
    bytesCompressed: 1024 * 80,
    zstdLevel: 3,
    tier: 'warm',
    parquetSha256B64Url: 'parquet-digest',
    parquetObjectKey: 'audit/v1/global/2026/05/11T03/0001-1000.parquet',
    createdAt: '2026-05-11T03:14:15Z',
    signingKeyId: 'kid-genesis-v1',
    retentionFloorDays: 365,
    payloadVersionMin: 2,
    payloadVersionMax: 2,
    ...o,
  };
}

function chainOf(n: number, slice = GLOBAL_SLICE): AuditCompressionManifestBody[] {
  const out: AuditCompressionManifestBody[] = [];
  let prev: AuditCompressionManifestBody | null = null;
  for (let i = 0; i < n; i++) {
    const b = body({
      manifestId: `m${i}`,
      tenantSliceId: slice,
      firstSeq: i * 100 + 1,
      lastSeq: i * 100 + 100,
      firstEventId: `e${i}_first`,
      lastEventId: `e${i}_last`,
      firstChainHashB64Url: prev ? prev.lastChainHashB64Url : null,
      lastChainHashB64Url: `anchor-${i}`,
      prevManifestId: prev ? prev.manifestId : null,
      prevManifestHashB64Url: prevManifestHash(prev),
    });
    out.push(b);
    prev = b;
  }
  return out;
}

describe('hashManifestBody / canonicalSha256B64Url / prevManifestHash', () => {
  it('hashManifestBody is stable + base64url-only', () => {
    const b = body();
    expect(hashManifestBody(b)).toBe(hashManifestBody(b));
    expect(hashManifestBody(b)).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('hashManifestBody changes when any field changes', () => {
    expect(hashManifestBody(body())).not.toBe(hashManifestBody(body({ rowCount: 1001 })));
  });

  it('canonicalSha256B64Url is independent of object literal key order', () => {
    const a = { x: 1, y: { b: 2, a: 1 }, z: [3, 1, 2] };
    const b2 = { z: [3, 1, 2], y: { a: 1, b: 2 }, x: 1 };
    expect(canonicalSha256B64Url(a)).toBe(canonicalSha256B64Url(b2));
  });

  it('prevManifestHash(null) equals sha256(MANIFEST_GENESIS) base64url', () => {
    const expected = encodeBase64Url(sha256(utf8(MANIFEST_GENESIS)));
    expect(prevManifestHash(null)).toBe(expected);
  });

  it('prevManifestHash(prev) equals hashManifestBody(prev)', () => {
    const prev = body();
    expect(prevManifestHash(prev)).toBe(hashManifestBody(prev));
  });
});

describe('rowChainAnchor', () => {
  it('is deterministic', () => {
    const sig = encodeBase64Url(new Uint8Array(64).fill(0x42));
    expect(rowChainAnchor('cuid_x', sig)).toBe(rowChainAnchor('cuid_x', sig));
  });

  it('different ids → different anchors', () => {
    const sig = encodeBase64Url(new Uint8Array(64).fill(0x42));
    expect(rowChainAnchor('a', sig)).not.toBe(rowChainAnchor('b', sig));
  });

  it('different sigs → different anchors', () => {
    const a = encodeBase64Url(new Uint8Array(64).fill(0x42));
    const b2 = encodeBase64Url(new Uint8Array(64).fill(0x43));
    expect(rowChainAnchor('cuid_x', a)).not.toBe(rowChainAnchor('cuid_x', b2));
  });
});

describe('verifyManifest', () => {
  it('round-trips with a fresh keypair', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signBody(body(), priv);
    expect(await verifyManifest(signed, pubB64)).toEqual({ ok: true });
  });

  it('reason=invalid_signature when body is tampered post-sign', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signBody(body(), priv);
    const tampered: SignedAuditCompressionManifest = {
      ...signed,
      body: { ...signed.body, rowCount: signed.body.rowCount + 1 },
    };
    expect(await verifyManifest(tampered, pubB64)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  it('reason=invalid_signature when sig bits are flipped', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signBody(body(), priv);
    const flipChar = signed.signatureB64Url.charAt(0) === 'A' ? 'B' : 'A';
    const tampered: SignedAuditCompressionManifest = {
      ...signed,
      signatureB64Url: flipChar + signed.signatureB64Url.slice(1),
    };
    const result = await verifyManifest(tampered, pubB64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_signature');
  });

  it('reason=unknown_signing_key when pubkey lookup misses', async () => {
    const { priv } = await genKeys();
    const signed = await signBody(body(), priv);
    expect(await verifyManifest(signed, null)).toEqual({
      ok: false,
      reason: 'unknown_signing_key',
    });
  });

  it('reason=wrong_alg if signatureAlg is forged to something unsupported', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signBody(body(), priv);
    const result = await verifyManifest(
      { ...signed, signatureAlg: 'rsa-pss' as unknown as 'ed25519' },
      pubB64,
    );
    expect(result).toEqual({ ok: false, reason: 'wrong_alg' });
  });

  it('reason=malformed_signature when signature is not valid base64url', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signBody(body(), priv);
    // atob is permissive on base64-url so we test the @noble decode path
    // by forcing an obviously-too-short signature.
    const tampered: SignedAuditCompressionManifest = {
      ...signed,
      signatureB64Url: 'x',
    };
    const result = await verifyManifest(tampered, pubB64);
    // Either malformed_signature (decode throws OR decoded length wrong →
    // throws in ed25519 verify catch path) or invalid_signature (verify
    // returns false). Both indicate "this signature is not valid for this key."
    // The split is meaningful for ops dashboards: malformed_signature points
    // at the producer; invalid_signature points at tamper-in-transit.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['malformed_signature', 'invalid_signature']).toContain(result.reason);
    }
  });

  it('reason=malformed_public_key when JWKS lookup returns junk bytes', async () => {
    // Operator-controlled failure mode: someone published a JWKS entry
    // whose `x` field doesn't round-trip through decodeBase64Url. Splits
    // off from malformed_signature so a dashboard can route the alert
    // ("rotate the JWKS" vs "investigate the producer").
    const { priv } = await genKeys();
    const signed = await signBody(body(), priv);
    const result = await verifyManifest(signed, '!!!not base64url at all!!!');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either malformed_public_key (decode throws) or invalid_signature
      // (decodes to wrong-length bytes that the crypto layer rejects).
      expect(['malformed_public_key', 'invalid_signature']).toContain(result.reason);
    }
  });

  // ── expectedKid kid-pinning short-circuit ─────────────────────────────────

  it('expectedKid=undefined preserves legacy behavior (signature still verifies)', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signBody(body(), priv);
    expect(await verifyManifest(signed, pubB64, undefined)).toEqual({ ok: true });
  });

  it('expectedKid matching body.signingKeyId allows verification', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signBody(body(), priv);
    expect(await verifyManifest(signed, pubB64, signed.body.signingKeyId)).toEqual({ ok: true });
  });

  it('reason=kid_mismatch when expectedKid disagrees with body.signingKeyId', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signBody(body(), priv);
    const result = await verifyManifest(signed, pubB64, 'kid-rotated-out-v0');
    expect(result).toEqual({ ok: false, reason: 'kid_mismatch' });
  });

  it('kid_mismatch short-circuits BEFORE pubkey decode (passing junk pubkey still yields kid_mismatch)', async () => {
    // Defense-in-depth check: even with a malformed pubkey that would
    // otherwise produce malformed_public_key, expectedKid mismatch wins.
    // This proves the short-circuit is in the right place — if it ran
    // after pubkey decode, an operator with a borked JWKS could mask a
    // kid_mismatch as malformed_public_key.
    const { priv } = await genKeys();
    const signed = await signBody(body(), priv);
    const result = await verifyManifest(signed, '!!!junk!!!', 'kid-wrong');
    expect(result).toEqual({ ok: false, reason: 'kid_mismatch' });
  });
});

describe('walkManifestChain — happy path', () => {
  it('verifies a clean 5-manifest chain', () => {
    expect(walkManifestChain(chainOf(5))).toEqual({ ok: true, verified: 5 });
  });

  it('verifies a 1-manifest chain at genesis', () => {
    expect(walkManifestChain(chainOf(1))).toEqual({ ok: true, verified: 1 });
  });
});

describe('walkManifestChain — tamper modes', () => {
  it('empty_input on empty array', () => {
    expect(walkManifestChain([])).toEqual({
      ok: false,
      failedAtIndex: -1,
      reason: 'empty_input',
    });
  });

  it('slice_mismatch when one manifest jumps slices', () => {
    const c = chainOf(3);
    c[1] = { ...c[1]!, tenantSliceId: 'principal_other' };
    expect(walkManifestChain(c)).toEqual({
      ok: false,
      failedAtIndex: 1,
      reason: 'slice_mismatch',
    });
  });

  it('prev_hash_mismatch when index 1 body is mutated after index 2 was sealed', () => {
    const c = chainOf(3);
    c[1] = { ...c[1]!, rowCount: c[1]!.rowCount + 1 };
    expect(walkManifestChain(c)).toEqual({
      ok: false,
      failedAtIndex: 2,
      reason: 'prev_hash_mismatch',
    });
  });

  it('detects a missing manifest (chain hole)', () => {
    const c = chainOf(4);
    const withHole = [c[0]!, c[2]!, c[3]!];
    const res = walkManifestChain(withHole);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.failedAtIndex).toBe(1);
      expect(['prev_hash_mismatch', 'row_chain_break']).toContain(res.reason);
    }
  });

  it('seq_not_monotonic when seqs overlap', () => {
    const c = chainOf(3);
    c[2] = {
      ...c[2]!,
      firstSeq: c[1]!.lastSeq, // overlaps prior — not strictly greater
      prevManifestHashB64Url: hashManifestBody(c[1]!),
    };
    expect(walkManifestChain(c)).toEqual({
      ok: false,
      failedAtIndex: 2,
      reason: 'seq_not_monotonic',
    });
  });

  it('row_chain_break when firstChainHash diverges from prior lastChainHash', () => {
    const c = chainOf(3);
    c[2] = {
      ...c[2]!,
      firstChainHashB64Url: 'wrong-anchor',
      prevManifestHashB64Url: hashManifestBody(c[1]!),
    };
    expect(walkManifestChain(c)).toEqual({
      ok: false,
      failedAtIndex: 2,
      reason: 'row_chain_break',
    });
  });

  it('row_chain_break when firstChainHash is null at non-genesis', () => {
    const c = chainOf(3);
    c[2] = {
      ...c[2]!,
      firstChainHashB64Url: null,
      prevManifestHashB64Url: hashManifestBody(c[1]!),
    };
    expect(walkManifestChain(c)).toEqual({
      ok: false,
      failedAtIndex: 2,
      reason: 'row_chain_break',
    });
  });

  it('reordering breaks the chain', () => {
    const c = chainOf(3);
    const reordered = [c[0]!, c[2]!, c[1]!];
    expect(walkManifestChain(reordered).ok).toBe(false);
  });
});
