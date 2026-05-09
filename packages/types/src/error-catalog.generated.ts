// @generated — do not edit; run pnpm gen:error-catalog
//
// Mirror of apps/api/src/common/errors/error-catalog.ts. The SDK consults
// this for retry decisions, customer messages, and category routing.
// Keys are stable lower-snake-case `code` values; values include the
// JS class name they originated from.

export type Backoff = 'none' | 'linear' | 'exponential' | 'on_retry_after_header';
export type Category =
  | 'auth'
  | 'validation'
  | 'policy'
  | 'rate_limit'
  | 'billing'
  | 'crypto'
  | 'transient'
  | 'internal';

export interface ErrorCatalogEntry {
  /** JS class name from the API source. */
  className: string;
  /** Stable lower-snake-case identifier — match on this. */
  code: string;
  httpStatus: number;
  retryable: boolean;
  backoff?: Backoff;
  customerMessage: string;
  category: Category;
}

/** Catalog keyed by stable `code` (lower-snake-case). */
export const GENERATED_ERROR_CATALOG: Readonly<Record<string, ErrorCatalogEntry>> = Object.freeze({
  ["agent_not_found"]: Object.freeze({
    className: "AgentNotFoundError",
    code: "agent_not_found",
    httpStatus: 404,
    retryable: false,
    customerMessage: "Agent identity not found.",
    category: "policy",
  }),
  ["agent_revoked"]: Object.freeze({
    className: "AgentRevokedError",
    code: "agent_revoked",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Agent identity has been revoked.",
    category: "policy",
  }),
  ["already_rotated"]: Object.freeze({
    className: "AlreadyRotatedError",
    code: "already_rotated",
    httpStatus: 409,
    retryable: false,
    customerMessage: "This API key has already been rotated. Rotate the active key instead.",
    category: "auth",
  }),
  ["anomaly_flagged"]: Object.freeze({
    className: "AnomalyFlaggedError",
    code: "anomaly_flagged",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Behavioral anomaly detected; agent has been quarantined.",
    category: "policy",
  }),
  ["auth_required"]: Object.freeze({
    className: "AuthenticationError",
    code: "auth_required",
    httpStatus: 401,
    retryable: false,
    customerMessage: "Authentication required. Provide a valid AEGIS API key.",
    category: "auth",
  }),
  ["forbidden"]: Object.freeze({
    className: "AuthorizationError",
    code: "forbidden",
    httpStatus: 403,
    retryable: false,
    customerMessage: "You are not permitted to perform this action.",
    category: "auth",
  }),
  ["upstream_unavailable"]: Object.freeze({
    className: "CircuitOpenError",
    code: "upstream_unavailable",
    httpStatus: 503,
    retryable: true, backoff: "exponential",
    customerMessage: "An upstream service is temporarily unavailable. Retry shortly.",
    category: "transient",
  }),
  ["conflict"]: Object.freeze({
    className: "ConflictError",
    code: "conflict",
    httpStatus: 409,
    retryable: false,
    customerMessage: "The request conflicts with the current state of the resource.",
    category: "validation",
  }),
  ["idempotency_conflict"]: Object.freeze({
    className: "IdempotencyConflictError",
    code: "idempotency_conflict",
    httpStatus: 409,
    retryable: false,
    customerMessage: "An idempotency key was reused with a different request body.",
    category: "validation",
  }),
  ["internal_error"]: Object.freeze({
    className: "InternalError",
    code: "internal_error",
    httpStatus: 500,
    retryable: true, backoff: "exponential",
    customerMessage: "An internal error occurred. The request can be retried.",
    category: "internal",
  }),
  ["invalid_signature"]: Object.freeze({
    className: "InvalidSignatureError",
    code: "invalid_signature",
    httpStatus: 401,
    retryable: false,
    customerMessage: "Request signature is invalid or expired.",
    category: "crypto",
  }),
  ["not_found"]: Object.freeze({
    className: "NotFoundError",
    code: "not_found",
    httpStatus: 404,
    retryable: false,
    customerMessage: "The requested resource was not found.",
    category: "validation",
  }),
  ["plan_limit_exceeded"]: Object.freeze({
    className: "PlanLimitExceededError",
    code: "plan_limit_exceeded",
    httpStatus: 402,
    retryable: false,
    customerMessage: "Plan monthly verify quota exceeded. Upgrade or wait for the next period.",
    category: "billing",
  }),
  ["policy_expired"]: Object.freeze({
    className: "PolicyExpiredError",
    code: "policy_expired",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Agent policy has expired. Re-authorize the agent.",
    category: "policy",
  }),
  ["policy_revoked"]: Object.freeze({
    className: "PolicyRevokedError",
    code: "policy_revoked",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Agent policy was revoked.",
    category: "policy",
  }),
  ["rate_limited"]: Object.freeze({
    className: "RateLimitedError",
    code: "rate_limited",
    httpStatus: 429,
    retryable: true, backoff: "on_retry_after_header",
    customerMessage: "Rate limit exceeded. Honor the Retry-After header before retrying.",
    category: "rate_limit",
  }),
  ["scope_not_granted"]: Object.freeze({
    className: "ScopeNotGrantedError",
    code: "scope_not_granted",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Action not in agent’s allowed scopes.",
    category: "policy",
  }),
  ["service_unavailable"]: Object.freeze({
    className: "ServiceUnavailableError",
    code: "service_unavailable",
    httpStatus: 503,
    retryable: true, backoff: "exponential",
    customerMessage: "The service is temporarily unavailable. Retry shortly.",
    category: "transient",
  }),
  ["spend_limit_exceeded"]: Object.freeze({
    className: "SpendLimitExceededError",
    code: "spend_limit_exceeded",
    httpStatus: 402,
    retryable: false,
    customerMessage: "Agent spend limit exceeded for the current period.",
    category: "billing",
  }),
  ["trial_exhausted"]: Object.freeze({
    className: "TrialExhaustedError",
    code: "trial_exhausted",
    httpStatus: 402,
    retryable: false,
    customerMessage: "Free trial verify cap reached. Upgrade to a paid plan to continue.",
    category: "billing",
  }),
  ["trust_score_too_low"]: Object.freeze({
    className: "TrustScoreTooLowError",
    code: "trust_score_too_low",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Agent trust score is below the configured threshold.",
    category: "policy",
  }),
  ["invalid_request"]: Object.freeze({
    className: "ValidationError",
    code: "invalid_request",
    httpStatus: 400,
    retryable: false,
    customerMessage: "The request payload failed validation.",
    category: "validation",
  }),
});
