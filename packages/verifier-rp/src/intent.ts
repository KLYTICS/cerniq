// verifyIntent — the relying-party adoption wedge for AEGIS Intent
// Manifest (ADR-0016 + ADR-0017). One-line call replaces the
// boilerplate every ACP merchant / treasury platform / broker-dealer
// would otherwise have to write themselves:
//
//   import { verifyIntent } from '@aegis/verifier-rp';
//
//   const result = await verifyIntent({
//     manifest,                  // SignedIntentManifest from POST /v1/intent
//     actual,                    // ActualCallObservation built from your handler input
//     publicKeysByKid,           // your JWKS-cached AEGIS audit signing keys
//   });
//   if (result.kind === 'denied') return res.status(403).json({ reason: result.reason });
//
// This is two operations stitched into one:
//   1. verifyManifest()   — Ed25519 signature integrity over the body
//   2. reconcileIntent()  — semantic reconciliation of actual vs declared
//
// Both come from @aegis/intent-manifest (the framework-free kernel).
// This wrapper exists in verifier-rp because:
//   - relying parties already depend on this package for verify-token
//     offline verification (AegisVerifier class)
//   - the JWKS cache they use for verify tokens is the SAME cache that
//     should hold the intent-manifest signing keys (audit signer family
//     per ADR-0011 + M-051)
//   - bundling avoids the relying party having two near-identical
//     ed25519 verification code paths
//
// Edge-runtime safe (no Node-only APIs) per CLAUDE.md invariant #2.

import {
  reconcileIntent,
  verifyManifest,
  type ActualCallObservation,
  type ReconciliationResult,
  type SignedIntentManifest,
  type VerifyFailure as KernelVerifyFailure,
} from '@aegis/intent-manifest';

// ────────────────────────────────────────────────────────────────────────
// Public types — small, closed, easy to switch on in RP code
// ────────────────────────────────────────────────────────────────────────

export interface VerifyIntentInput {
  /** The signed intent manifest. Typically delivered alongside the verify token. */
  manifest: SignedIntentManifest;
  /**
   * The actual call observation(s). For typical ACP / single-charge
   * flows pass an array of length 1. For batch reconciliation
   * (treasury settlement, FINRA execution reports) pass N.
   */
  actuals: readonly ActualCallObservation[];
  /**
   * Audit signing key bag keyed by kid. Use the SAME JWKS the
   * AegisVerifier instance uses for verify-token JWS — intent
   * manifests share the AEGIS audit signing key family (ADR-0011 §3).
   * The relying party MUST cache this from /.well-known/audit-signing-key.
   */
  publicKeysByKid: Readonly<Record<string, Uint8Array>>;
  /** Override the system clock for tests. */
  now?: () => number;
}

export type VerifyIntentDenialReason =
  /** Manifest signature did not verify (one of the kernel VerifyFailure kinds). */
  | { kind: 'manifest_signature'; cause: KernelVerifyFailure; detail?: string }
  /** Reconciliation said STRICT denial or GRADUATED breach. */
  | { kind: 'reconciliation_mismatch'; result: ReconciliationResult };

export type VerifyIntentOutcome =
  | { kind: 'approved'; result: ReconciliationResult }
  | { kind: 'denied'; reason: VerifyIntentDenialReason };

// ────────────────────────────────────────────────────────────────────────
// The single line your handler needs
// ────────────────────────────────────────────────────────────────────────

/**
 * Verify a signed intent manifest AND reconcile observed actuals against
 * the declared intent. Returns a closed-enum VerifyIntentOutcome.
 *
 * **The "one line" relying parties write to integrate AEGIS Intent
 * Manifest** (Testament Book I §3). Everything upstream (issuing the
 * manifest, populating actuals, caching the JWKS) is per-RP plumbing;
 * the decision logic is this one call.
 *
 * Failure semantics:
 *   - bad signature  → `denied` with reason.kind === 'manifest_signature'
 *   - bad timing     → `denied` because reconcileIntent records a
 *                      manifest-expired / not-yet-valid mismatch and
 *                      mapDenialReason returns INTENT_MISMATCH under
 *                      strict mode
 *   - clean match    → `approved`
 *   - tolerated      → `approved` with result.mismatches populated
 *                      (advisory mode or graduated within tolerance)
 *
 * Never throws on bad input — every failure path returns a typed denial.
 * Throws ONLY if the caller hands in something structurally illegal
 * (e.g. a non-Uint8Array public key) — those are programmer errors,
 * not relying-party-runtime errors.
 */
export function verifyIntent(input: VerifyIntentInput): VerifyIntentOutcome {
  // Step 1 — signature integrity. Stateless; no expiry/principal check.
  const sig = verifyManifest(input.manifest, input.publicKeysByKid);
  if (!sig.valid) {
    return {
      kind: 'denied',
      reason: {
        kind: 'manifest_signature',
        cause: sig.reason,
        ...(sig.detail !== undefined ? { detail: sig.detail } : {}),
      },
    };
  }

  // Step 2 — semantic reconciliation. Closed-enum result; never throws.
  const result = reconcileIntent(input.manifest, input.actuals, {
    now: input.now ?? Date.now,
  });

  if (result.recommendedDenialReason !== null) {
    return {
      kind: 'denied',
      reason: { kind: 'reconciliation_mismatch', result },
    };
  }

  return { kind: 'approved', result };
}
