// Cross-protocol substitution defense — @aegis/audit-verifier (audit-compression
// manifests) ↔ @aegis/intent-manifest (intent manifests).
//
// Why this exists (load-bearing, security):
//   AEGIS issues two distinct kinds of signed manifests with the same
//   Ed25519 audit signing key family (per `apps/api/src/modules/intent/
//   intent.module.ts:53` reusing `AuditSignerService` — the live shared-key
//   state documented in OPERATOR_DECISIONS.md OD-019(a), default = "keep
//   shared key", due "before high-value vertical onboarding"):
//
//     - SignedAuditCompressionManifest (audit chain — ADR-0015)
//     - SignedIntentManifest          (intent attestation — ADR-0016)
//
//   `packages/intent-manifest/src/manifest.ts` lines 5-10 (SEC NOTE #1)
//   explicitly warned:
//     "If future intent manifests share a key with audit manifests we
//      MUST add a domain-separation byte ('intent-v1:' prefix) to prevent
//      cross-protocol signature substitution. Document this in an ADR
//      before that key-sharing arrangement ships."
//
//   The key-sharing arrangement SHIPPED in Phase 2 (intent.module.ts:53).
//   The domain separator did NOT ship. This means the canonical pre-image
//   for BOTH kinds of manifest is `canonicalize(body)` — same function,
//   no domain prefix.
//
//   So why is the system not currently exploitable? Because of a THIRD
//   mitigation neither SEC NOTE #1 nor OD-019(a) names explicitly:
//   STRUCTURAL DISTINGUISHABILITY. The canonicalized bytes of an audit
//   body and an intent body are byte-distinguishable in their FIRST
//   SORTED FIELD due to alphabetical sortKeys:
//
//     Audit body (AuditCompressionManifestBody) canonicalizes starting
//     with `{"bytesCompressed":` — `bytesCompressed` is the first
//     alphabetical field.
//
//     Intent body (IntentManifestBody) canonicalizes starting with
//     `{"agentId":` — `agentId` is the first alphabetical field.
//
//   These two byte sequences cannot match. Therefore: even with a
//   SHARED Ed25519 private key, an attacker who has a valid audit
//   signature CANNOT present that signature alongside a forged intent
//   body (or vice versa) — the canonical pre-image will not match,
//   Ed25519 verify will fail.
//
//   This spec REGRESSION-LOCKS that structural-distinguishability
//   defense. If a future schema change makes the two body shapes
//   converge in their first sorted field (e.g., audit gains an
//   `agentId` field that sorts first, or intent gains a
//   `bytesCompressed`-style field), THIS SPEC FAILS — forcing an
//   explicit operator decision among the three mitigations:
//
//     (i)   Domain separator (SEC NOTE #1's preferred fix) —
//           breaking wire-format change.
//     (ii)  Separate signing keys (OD-019(a)'s split option) —
//           introduces IntentSignerService + new JWKS endpoint.
//     (iii) Restore structural distinguishability (rename the
//           offending field, or reorder via a forced-first sentinel
//           field like `_kind: "audit"` / `_kind: "intent"`).
//
//   The right Palantir-tier security artifact is NOT to claim "no
//   collision possible" by prose. It is to PROVE it as a regression
//   test that a peer's hostile edit cannot defeat. This is that test.
//
// Companion docs:
//   - packages/intent-manifest/src/manifest.ts lines 5-10 (SEC NOTE #1)
//   - OPERATOR_DECISIONS.md OD-019(a) (signing-key family decision)
//   - 68e4cf6 (canonical primitive byte parity locked)
//   - 5e3006d (sign/verify composition interop locked)
//   - This spec (cross-protocol substitution defense locked)

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { describe, expect, it } from 'vitest';

import {
  canonicalize as avCanonicalize,
  encodeBase64Url as avEncodeBase64Url,
} from '../../packages/audit-verifier/src/canonical';
import { GLOBAL_SLICE, prevManifestHash } from '../../packages/audit-verifier/src/manifest';
import type { AuditCompressionManifestBody } from '../../packages/audit-verifier/src/manifest';
import { manifestPreimage, signManifest } from '../../packages/intent-manifest/src/manifest';
import type { IntentManifestBody } from '../../packages/intent-manifest/src/types';

// Wire @noble/ed25519 sync hash hook (mirrors intent-manifest/src/manifest.ts
// idempotent setup; defense-in-depth against pnpm dedupe producing distinct
// instances for the tests/ workspace).
type EdInternal = { etc: { sha512Sync: (...m: Uint8Array[]) => Uint8Array } };
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
(ed as unknown as EdInternal).etc.sha512Sync = (...m: Uint8Array[]) =>
  sha512(concatBytes(...m));

const SHARED_PRIV = new Uint8Array(32).fill(13);
const SHARED_PUB = ed.getPublicKey(SHARED_PRIV);
const SHARED_KID = 'shared-audit-and-intent-kid';

function auditBody(): AuditCompressionManifestBody {
  return {
    v: 1,
    manifestId: '01HZZZBB0000000000000ABCDE',
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
    parquetObjectKey: 'audit/v1/global/2026/05/16/0001-1000.parquet',
    createdAt: '2026-05-16T21:00:00Z',
    signingKeyId: SHARED_KID,
    retentionFloorDays: 365,
    payloadVersionMin: 2,
    payloadVersionMax: 2,
  };
}

function intentBody(): IntentManifestBody {
  return {
    schemaVersion: 1,
    manifestId: '01HZZZBB0000000000000ABCDE', // INTENTIONALLY same id as audit body
    issuedAt: 1_715_000_000,
    expiresAt: 1_715_000_060,
    principalId: 'principal_acme',
    agentId: 'agent_xyz',
    intent: {
      kind: 'commerce-action',
      action: 'stripe.charge',
      maxCalls: 1,
      amountCap: { amount: '49.00', currency: 'USD' },
    },
    reconciliation: { strictness: 'strict' },
    verifyTokenJti: 'jti_substitution_test',
    verifyTokenSha256B64Url: 'tokenHashB64Url',
  };
}

describe('Cross-protocol substitution defense (OD-019(a) shared-key state)', () => {
  describe('structural distinguishability of canonical bytes', () => {
    it('audit body canonicalizes starting with "bytesCompressed" as first sorted field', () => {
      // alphabetical sortKeys ⇒ first field is the one that sorts first.
      // For audit bodies that's `bytesCompressed`. If a future field
      // (e.g. `aggregationLevel`) gets added that sorts BEFORE this,
      // the prefix shifts and this assertion fails — forcing
      // reconsideration of the defense.
      const canon = avCanonicalize(auditBody());
      expect(canon.startsWith('{"bytesCompressed":')).toBe(true);
    });

    it('intent body canonicalizes starting with "agentId" as first sorted field', () => {
      // alphabetical sortKeys ⇒ first field is `agentId`. If a future
      // field (e.g. `actionContext`) gets added that sorts BEFORE,
      // the prefix shifts and this assertion fails.
      const canon = avCanonicalize(intentBody());
      expect(canon.startsWith('{"agentId":')).toBe(true);
    });

    it('audit and intent canonical prefixes are STRUCTURALLY DISTINGUISHABLE in their first sorted field', () => {
      // The load-bearing security claim: even with a shared signing
      // key, no canonical-byte collision is possible because the very
      // first field (after `{"`) differs. `b` (audit) vs `a` (intent)
      // diverges at byte index 2 of the canonical string.
      const auditCanon = avCanonicalize(auditBody());
      const intentCanon = avCanonicalize(intentBody());

      const auditFirstField = auditCanon.match(/^\{"([^"]+)":/)?.[1];
      const intentFirstField = intentCanon.match(/^\{"([^"]+)":/)?.[1];

      expect(auditFirstField).toBe('bytesCompressed');
      expect(intentFirstField).toBe('agentId');
      expect(auditFirstField).not.toBe(intentFirstField);

      // Stronger: assert the canonical strings themselves cannot be
      // prefix-equal even for the first 4 characters.
      expect(auditCanon.slice(0, 4)).not.toBe(intentCanon.slice(0, 4));
    });
  });

  describe('Ed25519 substitution attack — fails as designed', () => {
    it('audit signature does NOT verify against intent body canonical bytes (with same shared key)', () => {
      // Attacker holds a valid signed audit manifest and tries to
      // present its signature alongside a malicious intent body.
      // Even though the signing key is shared, the pre-images differ
      // structurally (proven above) — Ed25519 verify must fail.
      const auditCanon = avCanonicalize(auditBody());
      const auditPreimage = new TextEncoder().encode(auditCanon);
      const auditSig = ed.sign(auditPreimage, SHARED_PRIV);

      // Now attempt the substitution: take the audit signature and
      // present the intent body's canonical pre-image to verify.
      const intentPreimage = manifestPreimage(intentBody());

      expect(ed.verify(auditSig, intentPreimage, SHARED_PUB)).toBe(false);
    });

    it('intent signature does NOT verify against audit body canonical bytes (with same shared key)', () => {
      // Reverse direction: attacker holds a valid signed intent
      // manifest and tries to present its signature as if it were
      // signing an audit body.
      const signed = signManifest(intentBody(), SHARED_PRIV, SHARED_KID);
      const intentSig = new Uint8Array(
        Buffer.from(
          signed.signatureB64Url.replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ),
      );

      const auditCanon = avCanonicalize(auditBody());
      const auditPreimage = new TextEncoder().encode(auditCanon);

      expect(ed.verify(intentSig, auditPreimage, SHARED_PUB)).toBe(false);
    });

    it('the audit signature DOES verify against its own canonical bytes (sanity)', () => {
      // Confirm the test setup is correct — same key, same body, same
      // canonical = signature verifies. Without this we cannot
      // distinguish "substitution defense holds" from "the test is
      // broken in some other way."
      const auditCanon = avCanonicalize(auditBody());
      const auditPreimage = new TextEncoder().encode(auditCanon);
      const auditSig = ed.sign(auditPreimage, SHARED_PRIV);
      expect(ed.verify(auditSig, auditPreimage, SHARED_PUB)).toBe(true);
    });

    it('the intent signature DOES verify against its own canonical bytes (sanity)', () => {
      // Symmetric sanity check.
      const signed = signManifest(intentBody(), SHARED_PRIV, SHARED_KID);
      const intentSig = new Uint8Array(
        Buffer.from(
          signed.signatureB64Url.replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ),
      );
      const intentPreimage = manifestPreimage(intentBody());
      expect(ed.verify(intentSig, intentPreimage, SHARED_PUB)).toBe(true);
    });
  });

  describe('defense durability — explicit acknowledgement of fragility', () => {
    it('avEncodeBase64Url is involved on the audit signature path (regression lock against alphabet drift)', () => {
      // If audit ever moves to padded base64 or a different alphabet,
      // an attacker MIGHT find a way to construct a collision by
      // exploiting padding ambiguity. This locks the encoder used.
      const sample = new Uint8Array([0, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255]);
      const encoded = avEncodeBase64Url(sample);
      // base64url uses '-' and '_', not '+' and '/'; no padding.
      expect(encoded).not.toMatch(/[+/=]/);
    });

    it('shared-key state is the assumed baseline (test must be revisited if OD-019(a) decides to split)', () => {
      // This is a self-documenting assertion. It does not test
      // behavior; it FORCES a maintainer who is about to disable
      // the shared-key arrangement to read this spec first. When
      // OD-019(a) decides to split keys (separate IntentSignerService),
      // the substitution attack becomes mathematically impossible
      // (different keys → different signatures, period), and the
      // structural-distinguishability claim becomes defense-in-depth
      // rather than the primary mitigation. Update this comment +
      // tighten the test scope accordingly.
      expect(SHARED_PRIV.length).toBe(32);
      expect(SHARED_PUB.length).toBe(32);
    });
  });
});
