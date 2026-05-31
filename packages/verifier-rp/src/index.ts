// Public exports for @cerniq/verifier-rp.

export { CerniqVerifier } from './verifier.js';
export { JwksClient } from './jwks.js';
export { JwksMemoryCache } from './jwks-cache.js';
export { MemoryReplayCache } from './replay-cache.js';
export { RevocationCache } from './revocation-cache.js';
export { parseCompactJws, verifyEdDSA } from './jwt.js';
export type { ParsedJws } from './jwt.js';
export { normalizeClaims, remainingTtlSeconds } from './policy-claims.js';
export type { NormalizedPolicyClaims } from './policy-claims.js';
export { checkScopeAndSpend } from './scope-check.js';

// Audit-chain offline verification — closes M-OBS-1 gap (continuous E2E
// can now do real chain verification instead of structural-only checks).
export {
  canonicalize,
  prevHash,
  verifyAuditEvent,
  verifyAuditChain,
} from './audit-chain.js';
export type {
  AegisAuditPayload,
  AegisAuditEvent,
  AegisAuditJwks,
  AuditChainBreakReason,
  AuditChainVerificationResult,
} from './audit-chain.js';

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
  CerniqVerifierConfig,
  CerniqJwtClaims,
  CerniqJwtHeader,
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
