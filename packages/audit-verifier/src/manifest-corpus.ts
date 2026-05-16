// Pure offline-corpus verifier for AEGIS audit-compression manifests.
//
// Given a list of already-parsed `SignedAuditCompressionManifest`s and
// a JWKS, produces a `ManifestCorpusReport` covering:
//   - per-manifest signature verification (typed failure reasons)
//   - per-slice chain walk (only over the slice's signature-valid
//     manifests, in seq-ascending order)
//   - aggregate signing-keys-used and row count
//
// Pure function: no fs, no argv, no env. The CLI shell handles the
// IO and exit-code policy; this module is the testable kernel.
//
// Caller contract for the CLI: parse + shape-validate the input before
// calling. Garbage-in here yields a garbage report (or throws inside
// `verifyManifest`) — by design. The CLI does the JSON.parse + shape
// validation.

import type { JwksDocument } from './types.js';
import {
  verifyManifest,
  walkManifestChain,
  type AuditCompressionManifestBody,
  type ChainWalkFailure,
  type ManifestVerifyFailure,
  type SignedAuditCompressionManifest,
} from './manifest.js';

export interface CorpusManifestResult {
  manifestId: string;
  tenantSliceId: string;
  firstSeq: number;
  lastSeq: number;
  signingKeyId: string;
  signatureValid: boolean;
  signatureReason?: ManifestVerifyFailure;
}

export interface CorpusSliceResult {
  tenantSliceId: string;
  manifestCount: number;
  /** Sum of `rowCount` over signature-valid manifests in this slice.
   *  Note: includes rows from manifests whose slice walk was *skipped*
   *  due to a sibling signature failure — these rows were observed but
   *  not vouched for. For audit-grade "rows we attest to", use
   *  `rowCountVouched` instead. */
  rowCountTotal: number;
  /** Sum of `rowCount` over signature-valid manifests in this slice,
   *  but only when the chain walk both ran AND returned ok. This is the
   *  audit-correct "rows AEGIS vouches for in this slice". 0 when the
   *  walk was skipped or returned a chain failure. */
  rowCountVouched: number;
  /** Whether the chain walk was attempted. Skipped iff any signature in
   *  the slice failed — `walkManifestChain`'s caller contract requires
   *  pre-verified inputs. */
  walked: boolean;
  walkOk?: boolean;
  walkFailedAtIndex?: number;
  walkReason?: ChainWalkFailure;
}

export interface ManifestCorpusReport {
  /** True iff every manifest verified AND every slice walk returned ok. */
  valid: boolean;
  totalManifests: number;
  /** Aggregate over `perSlice[].rowCountTotal`. Preserved for back-compat
   *  with consumers that pre-dated the vouched/observed split; new
   *  callers should prefer `totalRowsVouched` for audit reporting. */
  totalRows: number;
  /** Aggregate over `perSlice[].rowCountVouched` — the audit-correct
   *  "rows AEGIS vouches for across the corpus". */
  totalRowsVouched: number;
  totalSlices: number;
  signingKeysUsed: string[];
  perManifest: CorpusManifestResult[];
  perSlice: CorpusSliceResult[];
  durationMs: number;
}

/** Verify a corpus of signed manifests against a JWKS. Returns a
 *  comprehensive report — never throws on a bad signature or chain
 *  break, those flow into the report as typed failure reasons. Only
 *  throws if a JwksKey is structurally malformed (matches existing
 *  audit-verifier semantics). */
export async function verifyManifestCorpus(
  signed: readonly SignedAuditCompressionManifest[],
  jwks: JwksDocument,
): Promise<ManifestCorpusReport> {
  const start = Date.now();

  const perManifest: CorpusManifestResult[] = [];
  const signingKeysUsed = new Set<string>();
  /** slice → ordered list of *signature-valid* manifest bodies (sorted asc by firstSeq). */
  const bySlice = new Map<string, AuditCompressionManifestBody[]>();
  /** slice → has-any-sig-failure flag. */
  const sliceHasFailure = new Map<string, boolean>();

  // Pass 1 — signature verification + grouping.
  for (const s of signed) {
    const { body } = s;
    signingKeysUsed.add(body.signingKeyId);

    const key = jwks.keys.find((k) => k.kid === body.signingKeyId);
    const result = await verifyManifest(s, key?.x ?? null);

    const sigValid = result.ok;
    const mr: CorpusManifestResult = {
      manifestId: body.manifestId,
      tenantSliceId: body.tenantSliceId,
      firstSeq: body.firstSeq,
      lastSeq: body.lastSeq,
      signingKeyId: body.signingKeyId,
      signatureValid: sigValid,
    };
    if (!result.ok) {
      mr.signatureReason = result.reason;
    }
    perManifest.push(mr);

    if (sigValid) {
      const list = bySlice.get(body.tenantSliceId) ?? [];
      list.push(body);
      bySlice.set(body.tenantSliceId, list);
    } else {
      sliceHasFailure.set(body.tenantSliceId, true);
      // Track the slice even if no valid manifests landed in it, so we
      // emit a per-slice entry that explains why walking was skipped.
      if (!bySlice.has(body.tenantSliceId)) {
        bySlice.set(body.tenantSliceId, []);
      }
    }
  }

  // Pass 2 — per-slice chain walk (only over signature-valid manifests).
  const perSlice: CorpusSliceResult[] = [];
  for (const [slice, bodies] of bySlice) {
    bodies.sort((a, b) => a.firstSeq - b.firstSeq);
    const rowCountTotal = bodies.reduce((acc, b) => acc + b.rowCount, 0);
    const hasFailure = sliceHasFailure.get(slice) === true;

    const result: CorpusSliceResult = {
      tenantSliceId: slice,
      manifestCount: bodies.length,
      rowCountTotal,
      rowCountVouched: 0,
      walked: !hasFailure && bodies.length > 0,
    };

    if (result.walked) {
      const walk = walkManifestChain(bodies);
      result.walkOk = walk.ok;
      if (walk.ok) {
        result.rowCountVouched = rowCountTotal;
      } else {
        result.walkFailedAtIndex = walk.failedAtIndex;
        result.walkReason = walk.reason;
      }
    }
    perSlice.push(result);
  }
  perSlice.sort((a, b) => a.tenantSliceId.localeCompare(b.tenantSliceId));

  const allSigsValid = perManifest.every((m) => m.signatureValid);
  const allWalksOk = perSlice.every((s) => !s.walked || s.walkOk === true);
  const valid = allSigsValid && allWalksOk;

  return {
    valid,
    totalManifests: signed.length,
    totalRows: perSlice.reduce((acc, s) => acc + s.rowCountTotal, 0),
    totalRowsVouched: perSlice.reduce((acc, s) => acc + s.rowCountVouched, 0),
    totalSlices: perSlice.length,
    signingKeysUsed: [...signingKeysUsed].sort(),
    perManifest,
    perSlice,
    durationMs: Date.now() - start,
  };
}
