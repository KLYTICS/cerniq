// Cross-package parity — marketing /security page ↔ wellknown discovery
// STANDARDS_IMPLEMENTED list.
//
// WHY THIS GATE EXISTS
//
// `/security` is the highest-stakes claim surface in the marketing site:
// it's where buyers evaluate AEGIS's standards posture during procurement.
// The page renders an `IMPLEMENTED` array of RFC entries; the API serves
// the same list at `/.well-known/aegis-configuration#standards_implemented`
// via `wellknown.service.ts`. Buyers compare both during security review.
//
// If the two drift — marketing claims an RFC that discovery doesn't, or
// discovery exposes one the marketing page omits — a sophisticated buyer's
// first technical reviewer catches it and credibility evaporates. The
// docs/spec/05_FAPI_2_0_PROFILE.md document is explicit on this:
//
//   "If marketing copy advances beyond the discoverable proof, the wedge
//    becomes a lie and the first technical reviewer at any sophisticated
//    buyer will catch it."
//
// HOW IT WORKS
//
// Imports IMPLEMENTED + ALIGNED arrays from the marketing security page
// (exported for this spec) and instantiates WellknownService with a fake
// config to read the canonical `standards_implemented` /
// `standards_aligned` lists. Normalizes both sides (space ↔ hyphen,
// strip §section suffixes) and asserts symmetric set equality, filtering
// out AEGIS-specific entries that aren't RFC-tied.
//
// WHEN ADDING A NEW STANDARD
//
// Either side first is fine — the other side fails this spec until both
// are updated. Update order:
//
//   1. Promote in wellknown.service.ts STANDARDS_IMPLEMENTED (or _ALIGNED).
//   2. Add the entry to IMPLEMENTED[] (or ALIGNED[]) on the security page
//      with `rfc`, `name`, `blurb`, `evidence`.
//   3. Update docs/spec/05_FAPI_2_0_PROFILE.md §2 (or §3) with binding
//      contract + promotion-test reference.
//
// LIMITATIONS
//
//   • AEGIS-specific entries (e.g. `'AEGIS Discovery'`) are excluded from
//     the comparison — they're AEGIS-coined, not external standards. The
//     ALLOWED_NON_RFC_ENTRIES set names them explicitly so a new one
//     can't sneak through without conscious update here.
//   • This spec compares the RFC LIST. It does not check that the page's
//     `blurb` / `evidence` text accurately describes the implementation
//     (that requires the docs/spec FAPI profile and is a separate gate).

import { describe, expect, it } from 'vitest';

import { IMPLEMENTED, ALIGNED } from '../../apps/marketing/app/security/page';
import { WellknownService } from '../../apps/api/src/modules/wellknown/wellknown.service';
import { encodeBase64Url } from '../../apps/api/src/common/crypto/ed25519.util';

const ZERO_KEY_B64 = encodeBase64Url(new Uint8Array(32));

function buildWellknown(): WellknownService {
  const svc = new WellknownService({
    aegisSigningPublicKey: ZERO_KEY_B64,
    aegisSigningKeyRotatedAt: '2026-01-01T00:00:00.000Z',
  } as never);
  svc.onModuleInit();
  return svc;
}

/**
 * Marketing-page rfc strings ("RFC 8032", "RFC 6749 §5.2") use a space
 * separator and may carry §section suffixes for human readability.
 * Discovery emits the IETF-canonical hyphenated form ("RFC-8032",
 * "RFC-6749"). Normalize to the discovery form for comparison.
 */
function normalizeRfc(s: string): string {
  return s
    .replace(/^RFC\s+/, 'RFC-')   // "RFC 8032"      → "RFC-8032"
    .replace(/\s*§.*$/, '')        // "RFC-6749 §5.2" → "RFC-6749"
    .trim();
}

/**
 * Non-RFC entries from the marketing page that legitimately don't have
 * a matching wellknown counterpart. Each must be reviewed and named here
 * explicitly — bare "RFC 8032" / "RFC 6749" / etc. should never enter
 * this set; only AEGIS-coined or non-IETF compliance frameworks belong.
 */
const ALLOWED_NON_RFC_IMPLEMENTED = new Set<string>([
  'AEGIS Discovery', // AEGIS-coined; the discovery endpoint itself
]);

const ALLOWED_NON_RFC_ALIGNED = new Set<string>([
  'FAPI 2.0',                  // composite profile, not a single RFC
  'NIST AI Agent Identity',    // emerging guidance, not an RFC
  'SOC 2 Type I',              // attestation, not an RFC
  'ISO 27001',                 // certification, not an RFC
]);

describe('marketing-security ↔ wellknown standards parity', () => {
  it('IMPLEMENTED RFC list (marketing) matches standards_implemented (wellknown discovery)', () => {
    const marketingImplementedRfcs = IMPLEMENTED.map((e) => e.rfc)
      .filter((rfc) => !ALLOWED_NON_RFC_IMPLEMENTED.has(rfc))
      .map(normalizeRfc)
      .sort();

    const wellknownStandardsImplemented = [
      ...buildWellknown().getAegisConfiguration().standards_implemented,
    ].sort();

    expect(marketingImplementedRfcs).toEqual(wellknownStandardsImplemented);
  });

  it('ALIGNED RFC list (marketing) matches standards_aligned (wellknown discovery)', () => {
    const marketingAlignedRfcs = ALIGNED.map((e) => e.rfc)
      .filter((rfc) => !ALLOWED_NON_RFC_ALIGNED.has(rfc))
      .map(normalizeRfc)
      .sort();

    const wellknownStandardsAligned = [
      ...buildWellknown().getAegisConfiguration().standards_aligned,
    ].sort();

    expect(marketingAlignedRfcs).toEqual(wellknownStandardsAligned);
  });

  it('marketing IMPLEMENTED + ALIGNED are disjoint (a standard cannot be both)', () => {
    // Mirrors the wellknown gate at wellknown.service.spec.ts —
    // a standard appearing on both ledgers would be a category violation
    // (claiming implementation while also roadmapping it).
    const impl = new Set(IMPLEMENTED.map((e) => normalizeRfc(e.rfc)));
    const aligned = new Set(ALIGNED.map((e) => normalizeRfc(e.rfc)));
    const overlap = [...impl].filter((r) => aligned.has(r));
    expect(overlap).toEqual([]);
  });

  it('every marketing-page non-RFC entry is in an ALLOWED_NON_RFC set (catches drive-by AEGIS-coined claims)', () => {
    // If someone adds a new entry like `{ rfc: 'AEGIS Trust Score' }`
    // to IMPLEMENTED without registering it in ALLOWED_NON_RFC_IMPLEMENTED,
    // this test fails — forcing a conscious choice between "this is
    // RFC-tied (use the RFC number)" and "this is AEGIS-coined
    // (register it here with a rationale)."
    const allMarketingNonRfc = [
      ...IMPLEMENTED.filter((e) => !/^RFC[\s-]/.test(e.rfc)).map((e) => e.rfc),
      ...ALIGNED.filter((e) => !/^RFC[\s-]/.test(e.rfc)).map((e) => e.rfc),
    ];
    const allAllowed = new Set([...ALLOWED_NON_RFC_IMPLEMENTED, ...ALLOWED_NON_RFC_ALIGNED]);
    const unregistered = allMarketingNonRfc.filter((rfc) => !allAllowed.has(rfc));
    expect(unregistered).toEqual([]);
  });
});
