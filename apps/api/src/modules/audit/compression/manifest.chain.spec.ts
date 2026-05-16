// manifest.chain.spec.ts — manifest chain walk + row-chain anchor parity.
//
// Verifies that `walkManifestChain` detects every documented tamper mode
// and that `rowChainAnchor` matches the algorithm in
// `AuditChainUtil.prevHash` (so the manifest's row anchors line up with
// what the live audit chain produces row-by-row).

import { createHash, randomBytes } from 'node:crypto';
import { AuditChainUtil } from '../../../common/crypto/audit-chain.util';
import { encodeBase64Url } from '../../../common/crypto/ed25519.util';
import {
  hashManifestBody,
  prevManifestHash,
  rowChainAnchor,
  walkManifestChain,
} from './manifest.chain';
import type { AuditCompressionManifestBody } from './manifest.types';
import { MANIFEST_GENESIS } from './manifest.types';

function body(overrides: Partial<AuditCompressionManifestBody>): AuditCompressionManifestBody {
  return {
    v: 1,
    manifestId: 'm0',
    tenantSliceId: 'global',
    sliceStrategy: 'hybrid',
    firstSeq: 1,
    lastSeq: 100,
    firstEventId: 'cuid_a',
    lastEventId: 'cuid_b',
    firstChainHashB64Url: null,
    lastChainHashB64Url: 'anchor-out-0',
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
    signingKeyId: 'kid-genesis-v1',
    retentionFloorDays: 365,
    payloadVersionMin: 2,
    payloadVersionMax: 2,
    ...overrides,
  };
}

function chainOf(n: number, slice = 'global'): AuditCompressionManifestBody[] {
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
      lastChainHashB64Url: `anchor-out-${i}`,
      prevManifestId: prev ? prev.manifestId : null,
      prevManifestHashB64Url: prevManifestHash(prev),
    });
    out.push(b);
    prev = b;
  }
  return out;
}

describe('prevManifestHash / hashManifestBody', () => {
  it('at genesis, prevManifestHash(null) equals sha256(MANIFEST_GENESIS) base64url', () => {
    const expected = createHash('sha256').update(MANIFEST_GENESIS).digest();
    const encoded = expected
      .toString('base64')
      .replace(/=+$/u, '')
      .replace(/\+/gu, '-')
      .replace(/\//gu, '_');
    expect(prevManifestHash(null)).toBe(encoded);
  });

  it('hashManifestBody is stable + base64url alphabet only', () => {
    const b = body({});
    const h1 = hashManifestBody(b);
    const h2 = hashManifestBody(b);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('hashManifestBody differs when any field changes', () => {
    const a = hashManifestBody(body({}));
    const b = hashManifestBody(body({ rowCount: 101 }));
    expect(a).not.toBe(b);
  });
});

describe('rowChainAnchor — parity with AuditChainUtil.prevHash', () => {
  const util = new AuditChainUtil();

  it('matches util.prevHash for the (id, sig) branch', () => {
    const sigBytes = randomBytes(64);
    const sigB64 = encodeBase64Url(sigBytes);
    const id = 'cuid_event_42';

    const expected = util.prevHash(id, sigB64);
    const expectedB64 = expected
      .toString('base64')
      .replace(/=+$/u, '')
      .replace(/\+/gu, '-')
      .replace(/\//gu, '_');

    expect(rowChainAnchor(id, sigB64)).toBe(expectedB64);
  });

  it('different ids under same sig produce different anchors', () => {
    const sig = encodeBase64Url(randomBytes(64));
    expect(rowChainAnchor('a', sig)).not.toBe(rowChainAnchor('b', sig));
  });

  it('different sigs under same id produce different anchors', () => {
    const id = 'cuid_x';
    expect(
      rowChainAnchor(id, encodeBase64Url(randomBytes(64))),
    ).not.toBe(rowChainAnchor(id, encodeBase64Url(randomBytes(64))));
  });
});

describe('walkManifestChain — happy path', () => {
  it('verifies a clean 5-manifest chain', () => {
    const chain = chainOf(5);
    expect(walkManifestChain(chain)).toEqual({ ok: true, verified: 5 });
  });

  it('verifies a 1-manifest chain at genesis', () => {
    const chain = chainOf(1);
    expect(walkManifestChain(chain)).toEqual({ ok: true, verified: 1 });
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
    const chain = chainOf(3);
    chain[1] = { ...chain[1], tenantSliceId: 'principal_other' };
    const res = walkManifestChain(chain);
    expect(res).toEqual({ ok: false, failedAtIndex: 1, reason: 'slice_mismatch' });
  });

  it('prev_hash_mismatch when a manifest body changes after the next is signed', () => {
    const chain = chainOf(3);
    // mutate index 1 *without* re-deriving index 2's prevManifestHash
    chain[1] = { ...chain[1], rowCount: chain[1].rowCount + 1 };
    const res = walkManifestChain(chain);
    expect(res).toEqual({ ok: false, failedAtIndex: 2, reason: 'prev_hash_mismatch' });
  });

  it('prev_hash_mismatch when a manifest is dropped (chain hole)', () => {
    const chain = chainOf(4);
    const withHole = [chain[0], chain[2], chain[3]];
    const res = walkManifestChain(withHole);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.failedAtIndex).toBe(1);
      // either prev_hash_mismatch (manifest chain break) or
      // seq_not_monotonic could fire first, depending on whose check
      // runs earlier — the impl runs prev_hash first.
      expect(['prev_hash_mismatch', 'row_chain_break']).toContain(res.reason);
    }
  });

  it('seq_not_monotonic when seqs go backwards', () => {
    const chain = chainOf(3);
    chain[2] = {
      ...chain[2],
      firstSeq: chain[1].lastSeq, // overlaps — not strictly greater
      prevManifestHashB64Url: hashManifestBody(chain[1]),
    };
    const res = walkManifestChain(chain);
    expect(res).toEqual({ ok: false, failedAtIndex: 2, reason: 'seq_not_monotonic' });
  });

  it('row_chain_break when firstChainHash of i does not match lastChainHash of i-1', () => {
    const chain = chainOf(3);
    chain[2] = {
      ...chain[2],
      firstChainHashB64Url: 'wrong-anchor',
      prevManifestHashB64Url: hashManifestBody(chain[1]),
    };
    const res = walkManifestChain(chain);
    expect(res).toEqual({ ok: false, failedAtIndex: 2, reason: 'row_chain_break' });
  });

  it('row_chain_break when firstChainHash is null at a non-genesis index', () => {
    const chain = chainOf(3);
    chain[2] = {
      ...chain[2],
      firstChainHashB64Url: null,
      prevManifestHashB64Url: hashManifestBody(chain[1]),
    };
    const res = walkManifestChain(chain);
    expect(res).toEqual({ ok: false, failedAtIndex: 2, reason: 'row_chain_break' });
  });

  it('reordering two valid manifests breaks the chain', () => {
    const chain = chainOf(3);
    const reordered = [chain[0], chain[2], chain[1]];
    const res = walkManifestChain(reordered);
    expect(res.ok).toBe(false);
  });
});
