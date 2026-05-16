// Cross-package parity — apps/api manifest kernel ↔ @aegis/audit-verifier
//
// Why this exists (load-bearing):
//   M-036 Phase 0 ships two independent implementations of the
//   audit-compression manifest:
//     1. `apps/api/src/modules/audit/compression/manifest.{canonical,chain,types}.ts`
//        — Node-side kernel using `node:crypto`. Will be wired into
//        the compressor service when OD-017 lands.
//     2. `packages/audit-verifier/src/manifest.ts` — portable, edge-
//        runtime-safe kernel using `@noble/hashes` + `@noble/ed25519`.
//        The relying-party / auditor offline-verify surface.
//
//   Two ports = two opportunities for silent drift. This spec is the
//   contract: byte-identical canonicalization, byte-identical hashes,
//   byte-identical row-chain anchors, mutual sign/verify.
//
//   Mirrors the existing `audit-chain-parity.spec.ts` pattern.
//
// SEV-1: any failure here means a manifest sealed in production
// cannot be verified by the published audit-verifier package — the
// offline-audit story collapses. Treat exactly like the row-chain
// parity test.

import * as ed from '@noble/ed25519';
import { describe, expect, it } from 'vitest';

// API side — Node kernel (uses node:crypto).
import {
  canonicalJson as apiCanonicalJson,
  canonicalSha256B64Url as apiCanonicalSha256,
  signManifest as apiSignManifest,
  verifyManifest as apiVerifyManifest,
} from '../../apps/api/src/modules/audit/compression/manifest.canonical';
import {
  hashManifestBody as apiHashManifestBody,
  prevManifestHash as apiPrevManifestHash,
  rowChainAnchor as apiRowChainAnchor,
} from '../../apps/api/src/modules/audit/compression/manifest.chain';
import { MANIFEST_GENESIS as API_GENESIS } from '../../apps/api/src/modules/audit/compression/manifest.types';
import type { AuditCompressionManifestBody as ApiBody } from '../../apps/api/src/modules/audit/compression/manifest.types';
import { encodeBase64Url as apiEncodeBase64Url } from '../../apps/api/src/common/crypto/ed25519.util';

// Verifier side — portable kernel (no node:crypto).
import {
  canonicalize as vfCanonicalize,
  encodeBase64Url as vfEncodeBase64Url,
} from '../../packages/audit-verifier/src/canonical';
import {
  canonicalSha256B64Url as vfCanonicalSha256,
  hashManifestBody as vfHashManifestBody,
  prevManifestHash as vfPrevManifestHash,
  rowChainAnchor as vfRowChainAnchor,
  verifyManifest as vfVerifyManifest,
  MANIFEST_GENESIS as VF_GENESIS,
  type AuditCompressionManifestBody as VfBody,
  type SignedAuditCompressionManifest as VfSigned,
} from '../../packages/audit-verifier/src/manifest';

function sampleBody(o: Partial<ApiBody> = {}): ApiBody {
  return {
    v: 1,
    manifestId: '01HZZZAA0000000000000ABCDE',
    tenantSliceId: 'principal_acme',
    sliceStrategy: 'per-tenant',
    firstSeq: 1,
    lastSeq: 5_000_000,
    firstEventId: 'cuid_first',
    lastEventId: 'cuid_last',
    firstChainHashB64Url: null,
    lastChainHashB64Url: 'last-anchor-b64u',
    prevManifestId: null,
    prevManifestHashB64Url: apiPrevManifestHash(null),
    rowCount: 5_000_000,
    bytesUncompressed: 1024 * 1024 * 512,
    bytesCompressed: 1024 * 1024 * 80,
    zstdLevel: 19,
    tier: 'cold',
    parquetSha256B64Url: 'parquet-digest-b64u',
    parquetObjectKey: 'audit/v1/principal_acme/2026/05/11T03/0001-5000000.parquet',
    createdAt: '2026-05-11T03:14:15Z',
    signingKeyId: 'kid-2026-q2',
    retentionFloorDays: 2555, // 7y
    payloadVersionMin: 2,
    payloadVersionMax: 2,
    ...o,
  };
}

describe('canonicalJson — byte parity api ↔ audit-verifier', () => {
  const shapes: ReadonlyArray<{ name: string; value: unknown }> = [
    { name: 'flat primitive object', value: { b: 1, a: 'x', c: null } },
    { name: 'nested objects', value: { z: { y: { x: 1 } }, a: 'first' } },
    { name: 'arrays preserve order', value: { items: [3, 1, 2], meta: { k: 'v' } } },
    { name: 'array of objects', value: { rows: [{ b: 1, a: 2 }, { a: 3, b: 4 }] } },
    { name: 'unicode keys + values', value: { 'ünicode': 'café', a: 'b' } },
    { name: 'numeric values', value: { n: 0, m: -1, p: 1.5 } },
    { name: 'boolean + null mix', value: { flag: true, off: false, miss: null } },
    { name: 'empty containers', value: { obj: {}, arr: [] } },
    // Edge cases that would catch genuine port-drift if either side
    // moves off `JSON.stringify(sortKeys(...))` to a custom serializer.
    // These stress escape handling, key-sort stability, and Unicode.
    { name: 'empty-string key', value: { '': 'empty', a: 1 } },
    { name: 'embedded double-quote in value', value: { s: 'has "quote" inside' } },
    { name: 'embedded backslash in value', value: { s: 'path\\to\\thing' } },
    { name: 'embedded control chars (\\n \\t \\r)', value: { s: 'line1\nline2\ttab\rreturn' } },
    { name: 'embedded quote in key', value: { 'k"q': 1, a: 2 } },
    { name: 'high-codepoint Unicode (surrogate pair)', value: { emoji: '🦅', name: 'AEGIS' } },
    { name: 'mixed Unicode in keys', value: { 'café': 1, 'cafe': 2, 'カフェ': 3 } },
    { name: 'key sort with numeric-looking strings', value: { '10': 'a', '2': 'b', '1': 'c' } },
    { name: 'manifest body warm', value: sampleBody({ tier: 'warm', zstdLevel: 3 }) },
    { name: 'manifest body cold', value: sampleBody({ tier: 'cold', zstdLevel: 19 }) },
    {
      name: 'manifest body with anchored chain',
      value: sampleBody({
        firstChainHashB64Url: 'aB_cd-ef-gh-ij-kl-mn-op-qr-st-uv-wx-yz-12-34-56-78',
        prevManifestId: '01HZZZAA9999999999999ABCDE',
        prevManifestHashB64Url: 'PrEvHaShBaSe64UrL',
      }),
    },
  ];

  for (const { name, value } of shapes) {
    it(`parity: ${name}`, () => {
      expect(apiCanonicalJson(value)).toBe(vfCanonicalize(value));
    });
  }

  it('both share the MANIFEST_GENESIS sentinel literal', () => {
    expect(API_GENESIS).toBe(VF_GENESIS);
  });
});

describe('hash primitives — byte parity api ↔ audit-verifier', () => {
  it('canonicalSha256B64Url agrees', () => {
    const b = sampleBody();
    expect(apiCanonicalSha256(b)).toBe(vfCanonicalSha256(b));
  });

  it('hashManifestBody agrees on a warm-tier body', () => {
    const b = sampleBody({ tier: 'warm', zstdLevel: 3 });
    expect(apiHashManifestBody(b)).toBe(vfHashManifestBody(b as unknown as VfBody));
  });

  it('hashManifestBody agrees on a cold-tier body', () => {
    const b = sampleBody({ tier: 'cold', zstdLevel: 19 });
    expect(apiHashManifestBody(b)).toBe(vfHashManifestBody(b as unknown as VfBody));
  });

  it('prevManifestHash(null) agrees', () => {
    expect(apiPrevManifestHash(null)).toBe(vfPrevManifestHash(null));
  });

  it('prevManifestHash(body) agrees', () => {
    const b = sampleBody();
    expect(apiPrevManifestHash(b)).toBe(vfPrevManifestHash(b as unknown as VfBody));
  });

  it('rowChainAnchor agrees over random sig+id', () => {
    const sig = apiEncodeBase64Url(new Uint8Array(64).fill(0x42));
    expect(apiRowChainAnchor('cuid_xyz', sig)).toBe(vfRowChainAnchor('cuid_xyz', sig));
  });
});

describe('mutual sign/verify — api signs, audit-verifier verifies (and vice versa)', () => {
  it('api-side sign → audit-verifier verify succeeds', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubB64 = apiEncodeBase64Url(pub);

    const signed = await apiSignManifest(sampleBody(), (m) => ed.signAsync(m, priv));
    const result = await vfVerifyManifest(signed as unknown as VfSigned, pubB64);
    expect(result).toEqual({ ok: true });
  });

  it('audit-verifier sign-equivalent → api verify succeeds (round-trip)', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubB64 = vfEncodeBase64Url(pub);

    // Hand-roll the verifier's signing flow (no signManifest export there
    // by design — verifiers don't sign), using the verifier's canonicalize.
    const body = sampleBody();
    const sig = await ed.signAsync(
      new TextEncoder().encode(vfCanonicalize(body)),
      priv,
    );
    const signed = {
      body,
      signatureB64Url: vfEncodeBase64Url(sig),
      signatureAlg: 'ed25519' as const,
    };

    const result = await apiVerifyManifest(signed, pubB64);
    expect(result).toEqual({ ok: true });
  });

  it('tampered body produced under one impl is rejected by the other', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubB64 = apiEncodeBase64Url(pub);

    const signed = await apiSignManifest(sampleBody(), (m) => ed.signAsync(m, priv));
    const tampered = {
      ...signed,
      body: { ...signed.body, rowCount: signed.body.rowCount + 1 },
    };
    const result = await vfVerifyManifest(tampered as unknown as VfSigned, pubB64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_signature');
  });

  it('byte-level signature parity: same body + key → byte-identical sig on both impls', async () => {
    // Ed25519 is deterministic. A future canonicalize-drift on one side
    // (e.g. accidental trailing newline, BOM, or differing escape) would
    // still round-trip (each side reads what it wrote) but produce
    // different signature bytes than the other. Byte-level sig equality
    // catches that class of bug instantly. Tests across warm + cold +
    // anchored variants to cover the manifest shapes we actually ship.
    const priv = ed.utils.randomPrivateKey();

    const variants: ReadonlyArray<{ name: string; body: ApiBody }> = [
      { name: 'warm tier', body: sampleBody({ tier: 'warm', zstdLevel: 3 }) },
      { name: 'cold tier', body: sampleBody({ tier: 'cold', zstdLevel: 19 }) },
      {
        name: 'anchored row chain',
        body: sampleBody({
          firstChainHashB64Url: 'aB_cd-ef-gh-ij-kl-mn-op-qr-st-uv-wx-yz-12-34-56-78',
          prevManifestId: '01HZZZAA9999999999999ABCDE',
          prevManifestHashB64Url: 'PrEvHaShBaSe64UrL',
        }),
      },
    ];

    for (const { name, body } of variants) {
      const apiSigned = await apiSignManifest(body, (m) => ed.signAsync(m, priv));
      const vfSig = await ed.signAsync(
        new TextEncoder().encode(vfCanonicalize(body)),
        priv,
      );
      const vfSigB64 = vfEncodeBase64Url(vfSig);
      expect(apiSigned.signatureB64Url, `sig parity for ${name}`).toBe(vfSigB64);
    }
  });

  // ── ADR-0015 symmetric-failure-reason parity ──────────────────────────────
  //
  // Both implementations gained malformed_signature / malformed_public_key /
  // kid_mismatch + expectedKid? at the same time. The contract is that
  // identical pathological input produces identical failure reasons on both
  // sides — so a dashboard or runbook keyed off `verifyResult.reason` works
  // regardless of which kernel produced it (apps/api Node side at write
  // time vs. audit-verifier portable side at audit time).

  it('parity: kid_mismatch short-circuits BEFORE pubkey decode on BOTH sides', async () => {
    // Defense-in-depth: an operator with a borked JWKS publishing junk
    // bytes must not mask a kid_mismatch as malformed_public_key. Both
    // kernels must enforce the same ordering of checks.
    const priv = ed.utils.randomPrivateKey();
    const signed = await apiSignManifest(sampleBody(), (m) => ed.signAsync(m, priv));

    const apiResult = await apiVerifyManifest(signed, '!!!junk-pubkey!!!', 'kid-rotated-out');
    const vfResult = await vfVerifyManifest(signed as unknown as VfSigned, '!!!junk-pubkey!!!', 'kid-rotated-out');

    expect(apiResult.ok).toBe(false);
    expect(vfResult.ok).toBe(false);
    if (!apiResult.ok) expect(apiResult.reason).toBe('kid_mismatch');
    if (!vfResult.ok) expect(vfResult.reason).toBe('kid_mismatch');
  });

  it('parity: matching expectedKid + valid pubkey verifies on BOTH sides', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubB64 = apiEncodeBase64Url(pub);
    const body = sampleBody();
    const signed = await apiSignManifest(body, (m) => ed.signAsync(m, priv));

    const kid = body.signingKeyId;
    const apiResult = await apiVerifyManifest(signed, pubB64, kid);
    const vfResult = await vfVerifyManifest(signed as unknown as VfSigned, pubB64, kid);

    expect(apiResult).toEqual({ ok: true });
    expect(vfResult).toEqual({ ok: true });
  });

  it('parity: malformed signature bytes surface the same reason on BOTH sides', async () => {
    // A signature that decodes successfully (atob is permissive) but has
    // the wrong byte-length collapses through the ed25519 verify catch
    // path. A signature that contains literal non-base64url bytes throws
    // at decodeBase64Url. Both paths must surface as malformed_signature
    // OR invalid_signature on both sides — the exact split is
    // implementation-detail, but the SET of acceptable reasons is parity.
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubB64 = apiEncodeBase64Url(pub);
    const signed = await apiSignManifest(sampleBody(), (m) => ed.signAsync(m, priv));

    const tampered = { ...signed, signatureB64Url: 'x' };
    const apiResult = await apiVerifyManifest(tampered, pubB64);
    const vfResult = await vfVerifyManifest(tampered as unknown as VfSigned, pubB64);

    expect(apiResult.ok).toBe(false);
    expect(vfResult.ok).toBe(false);
    if (!apiResult.ok) {
      expect(['malformed_signature', 'invalid_signature']).toContain(apiResult.reason);
    }
    if (!vfResult.ok) {
      expect(['malformed_signature', 'invalid_signature']).toContain(vfResult.reason);
    }
    // Critical: both sides must AGREE on the reason for the same input.
    if (!apiResult.ok && !vfResult.ok) {
      expect(apiResult.reason).toBe(vfResult.reason);
    }
  });

  it('parity: malformed pubkey bytes surface the same reason on BOTH sides', async () => {
    const priv = ed.utils.randomPrivateKey();
    const signed = await apiSignManifest(sampleBody(), (m) => ed.signAsync(m, priv));

    const apiResult = await apiVerifyManifest(signed, '!!!not-base64url!!!');
    const vfResult = await vfVerifyManifest(signed as unknown as VfSigned, '!!!not-base64url!!!');

    expect(apiResult.ok).toBe(false);
    expect(vfResult.ok).toBe(false);
    // Acceptable set: malformed_public_key (decode threw) or
    // invalid_signature (decoded to wrong-length bytes, crypto rejected).
    if (!apiResult.ok) {
      expect(['malformed_public_key', 'invalid_signature']).toContain(apiResult.reason);
    }
    if (!vfResult.ok) {
      expect(['malformed_public_key', 'invalid_signature']).toContain(vfResult.reason);
    }
    if (!apiResult.ok && !vfResult.ok) {
      expect(apiResult.reason).toBe(vfResult.reason);
    }
  });
});
