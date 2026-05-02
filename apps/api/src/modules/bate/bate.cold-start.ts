// Cold-start trust policy — operator decision OD-002 (default until DECIDED).
//
// Where it's used:
//   - Identity register flow: new agents get `INITIAL_SCORE` and `INITIAL_BAND`.
//   - Scoring kernel: respects `KYC_REQUIRED_FLOOR_FOR_BAND` so non-KYC
//     agents cannot cross above a configurable score until the principal
//     completes KYC.
//   - Acceptance thresholds (relying-party guidance): `MIN_FOR_AUTO_APPROVAL`
//     is the score most relying parties default to.
//
// Mirrored in `docs/BATE_ALGORITHM.md` § 5. `OPERATOR_DECISIONS.md` row
// OD-002 tracks the decision state.
//
// Pure constants. No NestJS, no DI — importable from the CF Worker.

import type { TrustBand } from '@prisma/client';

export const COLD_START_VERSION = 'v1.0.0-default-2026-05-01';

/** Score for a freshly-registered agent. */
export const INITIAL_SCORE = 500;

/** Trust band for a freshly-registered agent (matches INITIAL_SCORE in TRUST_BAND_CUTOFFS). */
export const INITIAL_BAND: TrustBand = 'VERIFIED';

/** One-time bonus when the principal completes KYC verification. */
export const KYC_VERIFICATION_BONUS = 150;

/**
 * Without KYC, an agent cannot exceed this score regardless of how many
 * positive signals it accrues. Encourages principals to complete KYC for
 * any high-trust use case (financial, regulated, large-spend).
 *
 * Default rationale: KYC bonus (+150) brings a verified principal from
 * 500 → 650, comfortably above the common 600 acceptance threshold while
 * keeping the gap meaningful.
 */
export const KYC_REQUIRED_SCORE_CEILING = 700;

/**
 * Suggested relying-party threshold for auto-approval. Below this, the
 * relying party should require additional friction (e.g. human approval
 * for the action). This is a recommendation embedded in our SDK docs;
 * relying parties pick their own cutoff.
 */
export const MIN_FOR_AUTO_APPROVAL = 600;

/**
 * Trust accelerator: future feature where a referral from a 750+ agent
 * grants a +X starter bonus to the new agent. Disabled in v1; flag here so
 * the codepath is discoverable.
 */
export const REFERRAL_BONUS_ENABLED = false;
export const REFERRAL_BONUS = 50;
export const REFERRAL_MIN_REFERRER_SCORE = 750;
