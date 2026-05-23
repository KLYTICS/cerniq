// Public exports for @aegis/verifier-rp.

export { AegisVerifier } from './verifier.js';
export { JwksClient } from './jwks.js';
export { JwksMemoryCache } from './jwks-cache.js';
export { MemoryReplayCache } from './replay-cache.js';
export { RevocationCache } from './revocation-cache.js';
export { parseCompactJws, verifyEdDSA } from './jwt.js';
export type { ParsedJws } from './jwt.js';
export { normalizeClaims, remainingTtlSeconds } from './policy-claims.js';
export type { NormalizedPolicyClaims } from './policy-claims.js';
export { checkScopeAndSpend } from './scope-check.js';

export {
  VerifyError,
  ConfigError,
  JwksFetchError,
  JwksParseError,
  AgentKeyLookupError,
  RevocationFetchError,
} from './errors.js';
export type { VerifyErrorCode } from './errors.js';

export { b64uEncode, b64uDecode } from './_internal/b64u.js';

export type {
  AegisVerifierConfig,
  AegisJwtClaims,
  AegisJwtHeader,
  AgentStatusSnapshot,
  AgentStatusValue,
  DenialReason,
  GetAgentPublicKey,
  JwksDocument,
  JwksKey,
  Logger,
  ReplayCache,
  RevocationWebhookHandler,
  TrustBand,
  VerifyContext,
  VerifyOptions,
  VerifyOutcome,
  VerifyOutcomeFailure,
  VerifyOutcomeSuccess,
} from './types.js';

// ── Intent Manifest adoption surface (ADR-0016 + ADR-0017) ────────────
// Single-call wedge for relying parties — combines kernel signature
// verification + verify-token binding (IM-T2 defense) + semantic
// reconciliation. See docs/THREAT_MODEL_INTENT_MANIFEST.md for the
// threat model this surface implements.
export { verifyIntent } from './intent.js';
export type {
  VerifyIntentInput,
  VerifyIntentOutcome,
  VerifyIntentDenialReason,
} from './intent.js';
