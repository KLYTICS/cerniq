// manifest-corpus.spec.ts — pure corpus-verifier coverage.

import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';

import { canonicalize, encodeBase64Url, utf8 } from './canonical.js';
import {
  GLOBAL_SLICE,
  prevManifestHash,
  type AuditCompressionManifestBody,
  type SignedAuditCompressionManifest,
} from './manifest.js';
import { verifyManifestCorpus } from './manifest-corpus.js';
import type { JwksDocument } from './types.js';

async function newKey(kid: string): Promise<{ kid: string; priv: Uint8Array; pubB64: string; jwksKey: JwksDocument['keys'][number] }> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const pubB64 = encodeBase64Url(pub);
  return {
    kid,
    priv,
    pubB64,
    jwksKey: { kty: 'OKP', crv: 'Ed25519', x: pubB64, kid, use: 'sig' },
  };
}

async function sign(body: AuditCompressionManifestBody, priv: Uint8Array): Promise<SignedAuditCompressionManifest> {
  const sig = await ed.signAsync(utf8(canonicalize(body)), priv);
  return { body, signatureB64Url: encodeBase64Url(sig), signatureAlg: 'ed25519' };
}

function body(o: Partial<AuditCompressionManifestBody> = {}): AuditCompressionManifestBody {
  return {
    v: 1,
    manifestId: 'm0',
    tenantSliceId: GLOBAL_SLICE,
    sliceStrategy: 'hybrid',
    firstSeq: 1,
    lastSeq: 100,
    firstEventId: 'e0',
    lastEventId: 'e0',
    firstChainHashB64Url: null,
    lastChainHashB64Url: 'anchor-0',
    prevManifestId: null,
    prevManifestHashB64Url: prevManifestHash(null),
    rowCount: 100,
    bytesUncompressed: 1000,
    bytesCompressed: 200,
    zstdLevel: 3,
    tier: 'warm',
    parquetSha256B64Url: 'pq-0',
    parquetObjectKey: 'k0',
    createdAt: '2026-05-11T00:00:00Z',
    signingKeyId: 'kid-1',
    retentionFloorDays: 365,
    payloadVersionMin: 2,
    payloadVersionMax: 2,
    ...o,
  };
}

async function buildChain(n: number, slice: string, kidName: string, priv: Uint8Array): Promise<SignedAuditCompressionManifest[]> {
  const signed: SignedAuditCompressionManifest[] = [];
  let prev: AuditCompressionManifestBody | null = null;
  for (let i = 0; i < n; i++) {
    const b = body({
      manifestId: `${slice}-m${i}`,
      tenantSliceId: slice,
      firstSeq: i * 100 + 1,
      lastSeq: i * 100 + 100,
      firstEventId: `${slice}-e${i}`,
      lastEventId: `${slice}-e${i}`,
      firstChainHashB64Url: prev ? prev.lastChainHashB64Url : null,
      lastChainHashB64Url: `anchor-${slice}-${i}`,
      prevManifestId: prev ? prev.manifestId : null,
      prevManifestHashB64Url: prevManifestHash(prev),
      signingKeyId: kidName,
    });
    signed.push(await sign(b, priv));
    prev = b;
  }
  return signed;
}

describe('verifyManifestCorpus — happy path', () => {
  it('single slice, single kid, 3 manifests → valid', async () => {
    const k = await newKey('kid-1');
    const jwks: JwksDocument = { keys: [k.jwksKey] };
    const signed = await buildChain(3, GLOBAL_SLICE, 'kid-1', k.priv);
    const report = await verifyManifestCorpus(signed, jwks);

    expect(report.valid).toBe(true);
    expect(report.totalManifests).toBe(3);
    expect(report.totalSlices).toBe(1);
    expect(report.totalRows).toBe(300);
    expect(report.signingKeysUsed).toEqual(['kid-1']);
    expect(report.perSlice[0]!.walked).toBe(true);
    expect(report.perSlice[0]!.walkOk).toBe(true);
  });

  it('multi-slice corpus, separate kid per slice, all chains intact', async () => {
    const k1 = await newKey('kid-1');
    const k2 = await newKey('kid-2');
    const jwks: JwksDocument = { keys: [k1.jwksKey, k2.jwksKey] };

    const a = await buildChain(2, 'principal_acme', 'kid-1', k1.priv);
    const b = await buildChain(3, 'principal_globex', 'kid-2', k2.priv);
    const report = await verifyManifestCorpus([...a, ...b], jwks);

    expect(report.valid).toBe(true);
    expect(report.totalSlices).toBe(2);
    expect(report.totalManifests).toBe(5);
    expect(report.signingKeysUsed).toEqual(['kid-1', 'kid-2']);

    const acme = report.perSlice.find((s) => s.tenantSliceId === 'principal_acme')!;
    const globex = report.perSlice.find((s) => s.tenantSliceId === 'principal_globex')!;
    expect(acme.walkOk).toBe(true);
    expect(globex.walkOk).toBe(true);
    expect(acme.rowCountTotal).toBe(200);
    expect(globex.rowCountTotal).toBe(300);
  });

  it('out-of-order input is sorted by firstSeq within slice', async () => {
    const k = await newKey('kid-1');
    const jwks: JwksDocument = { keys: [k.jwksKey] };
    const ordered = await buildChain(3, GLOBAL_SLICE, 'kid-1', k.priv);
    const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];
    const report = await verifyManifestCorpus(shuffled, jwks);
    expect(report.valid).toBe(true);
  });

  it('empty corpus is vacuously valid', async () => {
    const report = await verifyManifestCorpus([], { keys: [] });
    expect(report.valid).toBe(true);
    expect(report.totalManifests).toBe(0);
    expect(report.totalSlices).toBe(0);
    expect(report.perSlice).toEqual([]);
  });
});

describe('verifyManifestCorpus — failure modes', () => {
  it('signature failure marks corpus invalid + skips slice walk', async () => {
    const k = await newKey('kid-1');
    const jwks: JwksDocument = { keys: [k.jwksKey] };
    const signed = await buildChain(3, GLOBAL_SLICE, 'kid-1', k.priv);
    // Tamper one manifest post-sign.
    signed[1] = {
      ...signed[1]!,
      body: { ...signed[1]!.body, rowCount: signed[1]!.body.rowCount + 1 },
    };
    const report = await verifyManifestCorpus(signed, jwks);

    expect(report.valid).toBe(false);
    expect(report.perManifest[1]!.signatureValid).toBe(false);
    expect(report.perManifest[1]!.signatureReason).toBe('invalid_signature');
    const slice = report.perSlice[0]!;
    expect(slice.walked).toBe(false); // walk skipped because slice had a sig failure
    expect(slice.walkOk).toBeUndefined();
  });

  it('unknown_signing_key when manifest references kid not in JWKS', async () => {
    const known = await newKey('kid-1');
    const unknown = await newKey('kid-rogue');
    const jwks: JwksDocument = { keys: [known.jwksKey] }; // only kid-1
    const rogue = await buildChain(1, GLOBAL_SLICE, 'kid-rogue', unknown.priv);
    const report = await verifyManifestCorpus(rogue, jwks);

    expect(report.valid).toBe(false);
    expect(report.perManifest[0]!.signatureReason).toBe('unknown_signing_key');
  });

  it('chain break inside a slice is reported with index + reason', async () => {
    const k = await newKey('kid-1');
    const jwks: JwksDocument = { keys: [k.jwksKey] };
    const chain = await buildChain(4, GLOBAL_SLICE, 'kid-1', k.priv);
    // Drop index 1 — chain hole. Re-sign nothing else (we kept original sigs).
    const withHole = [chain[0]!, chain[2]!, chain[3]!];
    const report = await verifyManifestCorpus(withHole, jwks);

    expect(report.valid).toBe(false);
    const slice = report.perSlice[0]!;
    expect(slice.walked).toBe(true);
    expect(slice.walkOk).toBe(false);
    expect(slice.walkFailedAtIndex).toBe(1);
    expect(['prev_hash_mismatch', 'row_chain_break']).toContain(slice.walkReason!);
  });

  it('one slice failing does not invalidate another good slice in the same report', async () => {
    const k = await newKey('kid-1');
    const jwks: JwksDocument = { keys: [k.jwksKey] };
    const good = await buildChain(2, 'principal_good', 'kid-1', k.priv);
    const bad = await buildChain(3, 'principal_bad', 'kid-1', k.priv);
    bad[1] = { ...bad[1]!, body: { ...bad[1]!.body, rowCount: 999 } };

    const report = await verifyManifestCorpus([...good, ...bad], jwks);
    expect(report.valid).toBe(false);
    const goodSlice = report.perSlice.find((s) => s.tenantSliceId === 'principal_good')!;
    const badSlice = report.perSlice.find((s) => s.tenantSliceId === 'principal_bad')!;
    expect(goodSlice.walkOk).toBe(true);
    expect(badSlice.walked).toBe(false);

    // Vouched-vs-observed split: bad slice's surviving signature-valid
    // manifests count in `rowCountTotal` (observed) but NOT in
    // `rowCountVouched` (audit-correct). Good slice contributes to both.
    expect(goodSlice.rowCountVouched).toBe(goodSlice.rowCountTotal);
    expect(badSlice.rowCountVouched).toBe(0);
    expect(badSlice.rowCountTotal).toBeGreaterThan(0);
    expect(report.totalRowsVouched).toBe(goodSlice.rowCountTotal);
    expect(report.totalRows).toBeGreaterThan(report.totalRowsVouched);
  });

  it('chain break: walked slice with walkOk=false contributes 0 to rowCountVouched', async () => {
    const k = await newKey('kid-1');
    const jwks: JwksDocument = { keys: [k.jwksKey] };
    const chain = await buildChain(4, GLOBAL_SLICE, 'kid-1', k.priv);
    const withHole = [chain[0]!, chain[2]!, chain[3]!];
    const report = await verifyManifestCorpus(withHole, jwks);
    const slice = report.perSlice[0]!;
    expect(slice.walked).toBe(true);
    expect(slice.walkOk).toBe(false);
    expect(slice.rowCountTotal).toBeGreaterThan(0);
    expect(slice.rowCountVouched).toBe(0);
    expect(report.totalRowsVouched).toBe(0);
  });

  it('signing-keys-used aggregates across slices and sorts deterministically', async () => {
    const k1 = await newKey('kid-z');
    const k2 = await newKey('kid-a');
    const jwks: JwksDocument = { keys: [k1.jwksKey, k2.jwksKey] };
    const a = await buildChain(1, 's1', 'kid-z', k1.priv);
    const b = await buildChain(1, 's2', 'kid-a', k2.priv);
    const report = await verifyManifestCorpus([...a, ...b], jwks);
    expect(report.signingKeysUsed).toEqual(['kid-a', 'kid-z']);
  });
});
