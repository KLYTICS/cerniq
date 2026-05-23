// RFC 6749 §5.2 — OAuth 2.0 canonical error envelope mapping.
//
// AEGIS denial reasons (the source of truth) are AEGIS-specific. Buyers
// running standard OAuth tooling expect RFC 6749 §5.2's canonical error
// values: `invalid_request`, `invalid_client`, `invalid_grant`,
// `unauthorized_client`, `unsupported_grant_type`, `invalid_scope`,
// `access_denied`, `server_error`, `temporarily_unavailable`.
//
// This module is the published mapping table. Every AEGIS denial reason
// MUST map to a canonical OAuth error — including future ones added to
// the DenialReason union. The mapping is exhaustively typed; adding a
// reason without mapping it fails the typecheck.
//
// Authority: docs/spec/05_FAPI_2_0_PROFILE.md §2 — RFC-6749 binding.

import type { DenialReason } from './verify.dto';

/**
 * RFC 6749 §5.2 canonical error values. The union here is the closed
 * set AEGIS publishes; if a future binding (RFC 9101 JAR, RFC 9396 RAR)
 * adds error values, extend the union here AND the mapping table below.
 */
export type OAuthCanonicalError =
  | 'invalid_request' // §5.2 — malformed shape
  | 'invalid_client' // §5.2 — caller identity rejected
  | 'invalid_grant' // §5.2 — grant rejected (policy)
  | 'invalid_token' // RFC 6750 §3.1 — bearer/JWT token rejected
  | 'invalid_scope' // §5.2 — requested scope not granted
  | 'unauthorized_client' // §5.2 — client not authorized
  | 'access_denied' // §5.2 — out of quota / trust / spend
  | 'server_error' // §5.2 — server bug
  | 'temporarily_unavailable'; // §5.2 — transient downstream

/**
 * Map an AEGIS denial reason to an RFC 6749 §5.2 canonical error value.
 *
 * Each row is a deliberate choice, not a mechanical translation:
 *  - signature-failure → `invalid_token` (RFC 6750 §3.1; closer fit than `invalid_client`)
 *  - quota / trial / spend / trust / anomaly → `access_denied`
 *    (RFC 6749 §5.2 explicitly authorizes `access_denied` for "the
 *     resource owner or authorization server denied the request")
 *  - policy revoked / expired / intent mismatch → `invalid_grant`
 *    (the grant exists but no longer authorizes this action)
 *  - agent missing / revoked → `invalid_client` (the client identity is rejected)
 *  - scope mismatch → `invalid_scope` (canonical RFC 6749 value)
 *
 * The mapping is published in the wellknown discovery doc (see
 * `aegis-configuration#oauth_error_mapping`) so buyers can verify the
 * mapping against their RFC 6749 review playbook.
 */
export const OAUTH_ERROR_MAPPING: { readonly [K in DenialReason]: OAuthCanonicalError } = Object.freeze({
  PLAN_LIMIT_EXCEEDED: 'access_denied',
  AGENT_NOT_FOUND: 'invalid_client',
  AGENT_REVOKED: 'invalid_client',
  INVALID_SIGNATURE: 'invalid_token',
  POLICY_REVOKED: 'invalid_grant',
  POLICY_EXPIRED: 'invalid_grant',
  SCOPE_NOT_GRANTED: 'invalid_scope',
  TRIAL_EXHAUSTED: 'access_denied',
  SPEND_LIMIT_EXCEEDED: 'access_denied',
  TRUST_SCORE_TOO_LOW: 'access_denied',
  ANOMALY_FLAGGED: 'access_denied',
  INTENT_MISMATCH: 'invalid_grant',
});

/**
 * Human-readable description for each AEGIS denial reason. Suitable
 * for the `error_description` field of the RFC 6749 §5.2 error envelope.
 * Wording is sales-facing — concise, no internal jargon, no secrets.
 */
export const OAUTH_ERROR_DESCRIPTION: { readonly [K in DenialReason]: string } = Object.freeze({
  PLAN_LIMIT_EXCEEDED: 'Plan quota exhausted for this billing period.',
  AGENT_NOT_FOUND: 'Agent identity unknown.',
  AGENT_REVOKED: 'Agent identity has been revoked.',
  INVALID_SIGNATURE: 'Agent signature failed verification.',
  POLICY_REVOKED: 'Authorization policy has been revoked.',
  POLICY_EXPIRED: 'Authorization policy expired.',
  SCOPE_NOT_GRANTED: 'Requested scope not granted by the active policy.',
  TRIAL_EXHAUSTED: 'Free-trial lifetime cap reached.',
  SPEND_LIMIT_EXCEEDED: 'Spend limit exceeded under the active policy.',
  TRUST_SCORE_TOO_LOW: 'Agent trust score below the relying-party threshold.',
  ANOMALY_FLAGGED: 'Behavioral anomaly detected.',
  INTENT_MISMATCH: 'Action diverged from the agent\'s signed intent.',
});

/** Resolve the canonical OAuth error + description for a denial reason. */
export function oauthErrorFor(reason: DenialReason): {
  error: OAuthCanonicalError;
  error_description: string;
} {
  return {
    error: OAUTH_ERROR_MAPPING[reason],
    error_description: OAUTH_ERROR_DESCRIPTION[reason],
  };
}
