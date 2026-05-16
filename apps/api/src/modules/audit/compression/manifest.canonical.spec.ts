// manifest.canonical.spec.ts — kernel parity + sign/verify tests.
//
// Hard guarantees this spec enforces:
//
//   1. `canonicalJson` produces byte-identical output to
//      `AuditChainUtil.canonicalize`. If either drifts, this test fails
//      before the build ships — protecting manifests from a silent
//      canonicalization split.
//
//   2. Manifest sign/verify round-trips with both a stable kid and a
//      deterministic key. Tamper paths each return a *typed* failure
//      reason (not an exception, not a generic boolean) so callers can
//      drive metric labels.
//
//   3. Key order, nested structure, and null-vs-absent are handled
//      identically for the manifest canonicalizer and the row-chain
//      canonicalizer.

import * as ed from '@noble/ed25519';
import '../../../common/crypto/crypto.bootstrap';
import { AuditChainUtil } from '../../../common/crypto/audit-chain.util';
import {
  canonicalJson,
  canonicalSha256B64Url,
  signManifest,
  verifyManifest,
} from './manifest.canonical';
import type {
  AuditCompressionManifestBody,
  SignedAuditCompressionManifest,
} from './manifest.types';
import { encodeBase64Url } from '../../../common/crypto/ed25519.util';

function sampleBody(overrides: Partial<AuditCompressionManifestBody> = {}): AuditCompressionManifestBody {
  return {
    v: 1,
    manifestId: '01HZZZAA0000000000000ABCDE',
    tenantSliceId: 'global',
    sliceStrategy: 'hybrid',
    firstSeq: 1,
    lastSeq: 1000,
    firstEventId: 'cuid_first',
    lastEventId: 'cuid_last',
    firstChainHashB64Url: null,
    lastChainHashB64Url: 'AAAA_aaaa-______________________________aaa',
    prevManifestId: null,
    prevManifestHashB64Url: 'sha-of-genesis',
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
    ...overrides,
  };
}

describe('canonicalJson — parity with AuditChainUtil.canonicalize', () => {
  const util = new AuditChainUtil();

  const cases: ReadonlyArray<{ name: string; value: unknown }> = [
    { name: 'flat primitive object', value: { b: 1, a: 'x', c: null } },
    { name: 'nested objects', value: { z: { y: { x: 1 } }, a: 'first' } },
    { name: 'arrays preserve order', value: { items: [3, 1, 2], meta: { k: 'v' } } },
    { name: 'array-of-objects with mixed keys', value: { rows: [{ b: 1, a: 2 }, { a: 3, b: 4 }] } },
    { name: 'unicode keys + values', value: { 'ünicode': 'café', 'a': 'b' } },
    { name: 'numeric values', value: { n: 0, m: -1, p: 1.5 } },
    { name: 'boolean + null mix', value: { flag: true, off: false, miss: null } },
    { name: 'empty object', value: {} },
    { name: 'empty array', value: { xs: [] } },
    { name: 'sample manifest body', value: sampleBody() },
    {
      name: 'manifest body with anchored row chain',
      value: sampleBody({
        firstChainHashB64Url: 'aB_cd-ef-gh-ij-kl-mn-op-qr-st-uv-wx-yz-12-34-56-78',
        prevManifestId: '01HZZZAA9999999999999ABCDE',
        prevManifestHashB64Url: 'PrEvHaShBaSe64UrL',
      }),
    },
  ];

  for (const { name, value } of cases) {
    it(`parity: ${name}`, () => {
      const fromKernel = canonicalJson(value);
      const fromUtil = util.canonicalize(value);
      expect(fromKernel).toBe(fromUtil);
    });
  }

  it('is deterministic across permutations of input key order', () => {
    const a = { x: 1, y: 2, z: { d: 4, c: 3, b: 2, a: 1 } };
    const b = { z: { a: 1, b: 2, c: 3, d: 4 }, y: 2, x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array order (arrays are not sorted)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('produces no whitespace', () => {
    const s = canonicalJson({ a: 1, b: [2, 3], c: { d: 4 } });
    expect(s).not.toMatch(/\s/u);
  });
});

describe('canonicalSha256B64Url', () => {
  it('is stable across calls', () => {
    const body = sampleBody();
    expect(canonicalSha256B64Url(body)).toBe(canonicalSha256B64Url(body));
  });

  it('changes when any field changes', () => {
    const a = sampleBody();
    const b = sampleBody({ rowCount: 1001 });
    expect(canonicalSha256B64Url(a)).not.toBe(canonicalSha256B64Url(b));
  });

  it('uses base64url alphabet only (no + / =)', () => {
    expect(canonicalSha256B64Url(sampleBody())).toMatch(/^[A-Za-z0-9_-]+$/u);
  });
});

describe('signManifest / verifyManifest', () => {
  async function genKeys(): Promise<{ priv: Uint8Array; pubB64: string }> {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    return { priv, pubB64: encodeBase64Url(pub) };
  }

  it('round-trips with a fresh keypair', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signManifest(sampleBody(), (msg) => ed.signAsync(msg, priv));
    const result = await verifyManifest(signed, pubB64);
    expect(result.ok).toBe(true);
  });

  it('fails with reason=invalid_signature when the body is tampered post-sign', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signManifest(sampleBody(), (msg) => ed.signAsync(msg, priv));
    const tampered: SignedAuditCompressionManifest = {
      ...signed,
      body: { ...signed.body, rowCount: signed.body.rowCount + 1 },
    };
    const result = await verifyManifest(tampered, pubB64);
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('fails with reason=invalid_signature when the signature is tampered', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signManifest(sampleBody(), (msg) => ed.signAsync(msg, priv));
    const flipChar = signed.signatureB64Url.charAt(0) === 'A' ? 'B' : 'A';
    const tampered: SignedAuditCompressionManifest = {
      ...signed,
      signatureB64Url: flipChar + signed.signatureB64Url.slice(1),
    };
    const result = await verifyManifest(tampered, pubB64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_signature');
  });

  it('fails with reason=unknown_signing_key when pubkey lookup misses', async () => {
    const { priv } = await genKeys();
    const signed = await signManifest(sampleBody(), (msg) => ed.signAsync(msg, priv));
    const result = await verifyManifest(signed, null);
    expect(result).toEqual({ ok: false, reason: 'unknown_signing_key' });
  });

  it('fails with reason=wrong_alg if signatureAlg is forged to an unsupported value', async () => {
    const { priv, pubB64 } = await genKeys();
    const signed = await signManifest(sampleBody(), (msg) => ed.signAsync(msg, priv));
    const result = await verifyManifest(
      { ...signed, signatureAlg: 'rsa-pss' as unknown as 'ed25519' },
      pubB64,
    );
    expect(result).toEqual({ ok: false, reason: 'wrong_alg' });
  });

  it('signing is deterministic for ed25519 (same body + key = same sig)', async () => {
    const { priv } = await genKeys();
    const a = await signManifest(sampleBody(), (msg) => ed.signAsync(msg, priv));
    const b = await signManifest(sampleBody(), (msg) => ed.signAsync(msg, priv));
    expect(a.signatureB64Url).toBe(b.signatureB64Url);
  });

  it('different bodies under the same key produce different signatures', async () => {
    const { priv } = await genKeys();
    const a = await signManifest(sampleBody(), (msg) => ed.signAsync(msg, priv));
    const b = await signManifest(sampleBody({ lastSeq: 9999 }), (msg) => ed.signAsync(msg, priv));
    expect(a.signatureB64Url).not.toBe(b.signatureB64Url);
  });

  it('the signed bytes are exactly canonicalJson(body) — independent of key sort order in the body object literal', async () => {
    const { priv, pubB64 } = await genKeys();
    // build the same body two different ways
    const bodyA = sampleBody();
    const bodyB: AuditCompressionManifestBody = {
      // intentionally inverted property declaration order
      payloadVersionMax: bodyA.payloadVersionMax,
      payloadVersionMin: bodyA.payloadVersionMin,
      retentionFloorDays: bodyA.retentionFloorDays,
      signingKeyId: bodyA.signingKeyId,
      createdAt: bodyA.createdAt,
      parquetObjectKey: bodyA.parquetObjectKey,
      parquetSha256B64Url: bodyA.parquetSha256B64Url,
      tier: bodyA.tier,
      zstdLevel: bodyA.zstdLevel,
      bytesCompressed: bodyA.bytesCompressed,
      bytesUncompressed: bodyA.bytesUncompressed,
      rowCount: bodyA.rowCount,
      prevManifestHashB64Url: bodyA.prevManifestHashB64Url,
      prevManifestId: bodyA.prevManifestId,
      lastChainHashB64Url: bodyA.lastChainHashB64Url,
      firstChainHashB64Url: bodyA.firstChainHashB64Url,
      lastEventId: bodyA.lastEventId,
      firstEventId: bodyA.firstEventId,
      lastSeq: bodyA.lastSeq,
      firstSeq: bodyA.firstSeq,
      sliceStrategy: bodyA.sliceStrategy,
      tenantSliceId: bodyA.tenantSliceId,
      manifestId: bodyA.manifestId,
      v: bodyA.v,
    };
    const a = await signManifest(bodyA, (msg) => ed.signAsync(msg, priv));
    const b = await signManifest(bodyB, (msg) => ed.signAsync(msg, priv));
    expect(a.signatureB64Url).toBe(b.signatureB64Url);
    const verifyA = await verifyManifest(a, pubB64);
    const verifyB = await verifyManifest(b, pubB64);
    expect(verifyA.ok).toBe(true);
    expect(verifyB.ok).toBe(true);
  });
});

