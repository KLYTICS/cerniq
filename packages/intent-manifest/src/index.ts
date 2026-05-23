// Public API surface for @aegis/intent-manifest. Re-exports a narrow,
// versioned set of symbols; downstream callers MUST import from the
// package name, never from src paths.

export { canonicalize, decodeBase64Url, encodeBase64Url, sortKeys } from './canonical.js';

export {
  DEFAULT_GRADUATED_TOLERANCE_PCT,
  INTENT_MANIFEST_SCHEMA_V1,
  type ActualCallObservation,
  type CommerceActionClaim,
  type HttpCallClaim,
  type IntentClaim,
  type IntentManifestBody,
  type IntentMismatch,
  type IntentMismatchKind,
  type ReconciliationPolicy,
  type ReconciliationResult,
  type ReconciliationStrictness,
  type SignedIntentManifest,
  type ToolInvocationClaim,
} from './types.js';

export {
  manifestPreimage,
  signManifest,
  verifyManifest,
  type VerifyFailure,
  type VerifyResult,
} from './manifest.js';

export {
  INTENT_MISMATCH_DENIAL_REASON,
  reconcileIntent,
  type ReconcileOptions,
} from './reconcile.js';
