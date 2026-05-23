// verifyIntent — the relying-party adoption wedge for AEGIS Intent
// Manifest (ADR-0016 + ADR-0017). One call replaces the boilerplate
// every ACP merchant / treasury platform / broker-dealer would otherwise
// have to write themselves:
//
//   import { verifyIntent } from '@aegis/verifier-rp';
//
//   const result = verifyIntent({
//     manifest,                  // SignedIntentManifest from POST /v1/intent
//     actuals,                   // ActualCallObservation[] built from your handler input
//     publicKeysByKid,           // your JWKS-cached AEGIS audit signing keys
//     expectedVerifyTokenJti,    // jti from the verify token you're about to honor
//   });
//   if (result.kind === 'denied') return res.status(403).json({ reason: result.reason.kind });
//
// This is THREE operations stitched into one:
//   1. verifyManifest()                — Ed25519 signature integrity over the body
//   2. verify-token binding check      — manifest.body.verifyTokenJti === expected
//   3. reconcileIntent()               — semantic reconciliation of actual vs declared
//
// Steps 1 + 3 come from @aegis/intent-manifest (the framework-free kernel);
// step 2 is enforced here. Per the Intent Manifest threat model
// (docs/THREAT_MODEL_INTENT_MANIFEST.md IM-T2), the verify-token binding
// closes the cross-RP replay attack: an attacker who intercepts a manifest
// issued for verify-token T against relying party RP-A cannot present that
// same manifest to RP-B (whose verify token has a different jti). The
// binding USED to be caller-responsibility (a docstring note); making it
// a REQUIRED input here promotes it to a compile-error for forgetful
// integrators.
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
  /**
   * The `jti` claim of the verify token this RP is about to honor.
   * REQUIRED to prevent cross-RP manifest replay (threat IM-T2):
   * an attacker who intercepts a manifest issued for verify-token T
   * against RP-A cannot present it to RP-B (different jti).
   *
   * Extract this from the verify token your existing AegisVerifier
   * already decoded — the JWT's `jti` claim.
   */
  expectedVerifyTokenJti: string;
  /**
   * Optional SHA-256 base64url of the verify token bytes. When provided,
   * defends additionally against a (rare) jti collision where the same
   * jti was issued for two different verify-token bodies. Most RPs can
   * omit this; treasury / broker-dealer verticals with high-value bindings
   * should compute and pass it for belt-and-braces.
   */
  expectedVerifyTokenSha256B64Url?: string;
  /** Override the system clock for tests. */
  now?: () => number;
}

export type VerifyIntentDenialReason =
  /** Manifest signature did not verify (one of the kernel VerifyFailure kinds). */
  | { kind: 'manifest_signature'; cause: KernelVerifyFailure; detail?: string }
  /**
   * Manifest signature was valid, but the manifest's `verifyTokenJti`
   * (or `verifyTokenSha256B64Url`, when checked) does not match the
   * verify token this RP is about to honor. Indicates cross-RP replay
   * (threat IM-T2) or a stale manifest paired with the wrong token.
   */
  | {
      kind: 'verify_token_binding_mismatch';
      field: 'jti' | 'sha256';
      expected: string;
      actual: string;
    }
  /** Reconciliation said STRICT denial or GRADUATED breach. */
  | { kind: 'reconciliation_mismatch'; result: ReconciliationResult };

export type VerifyIntentOutcome =
  | { kind: 'approved'; result: ReconciliationResult }
  | { kind: 'denied'; reason: VerifyIntentDenialReason };

// ────────────────────────────────────────────────────────────────────────
// The single line your handler needs
// ────────────────────────────────────────────────────────────────────────

/**
 * Verify a signed intent manifest, check the verify-token binding, AND
 * reconcile observed actuals against the declared intent. Returns a
 * closed-enum VerifyIntentOutcome.
 *
 * **The wedge** (Testament Book I §3) — three lines on the RP side:
 *
 *   const result = verifyIntent({ manifest, actuals, publicKeysByKid, expectedVerifyTokenJti });
 *   if (result.kind === 'denied') return res.status(403).json({ reason: result.reason.kind });
 *   // ...proceed with the action, then async-emit actuals to AEGIS...
 *
 * Failure ordering (each step assumes prior steps passed):
 *   1. signature                → `denied` `manifest_signature` (kernel cause)
 *   2. verify-token binding     → `denied` `verify_token_binding_mismatch`
 *   3. reconciliation           → `denied` `reconciliation_mismatch` OR `approved`
 *
 * Never throws on user-recoverable failure — every path returns a typed
 * denial. Throws ONLY on structurally illegal inputs (non-Uint8Array
 * public keys, missing required fields the type system prevents) —
 * those are programmer errors, not relying-party-runtime errors.
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

  // Step 2 — verify-token binding. Closes IM-T2 (cross-RP replay).
  // Compared AFTER signature passes so a forged manifest doesn't waste
  // the binding-check error code on the caller's audit log.
  const bodyJti = input.manifest.body.verifyTokenJti;
  if (bodyJti !== input.expectedVerifyTokenJti) {
    return {
      kind: 'denied',
      reason: {
        kind: 'verify_token_binding_mismatch',
        field: 'jti',
        expected: input.expectedVerifyTokenJti,
        actual: bodyJti,
      },
    };
  }
  if (input.expectedVerifyTokenSha256B64Url !== undefined) {
    const bodySha = input.manifest.body.verifyTokenSha256B64Url;
    if (bodySha !== input.expectedVerifyTokenSha256B64Url) {
      return {
        kind: 'denied',
        reason: {
          kind: 'verify_token_binding_mismatch',
          field: 'sha256',
          expected: input.expectedVerifyTokenSha256B64Url,
          actual: bodySha,
        },
      };
    }
  }

  // Step 3 — semantic reconciliation. Closed-enum result; never throws.
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
