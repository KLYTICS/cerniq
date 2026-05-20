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
  /** One-line actionable next step the developer should take. */
  next: string;
  /** Stable docs URL for this error. */
  docsUrl: string;
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
    next: "Register the agent via aegis.agents.register(...) or verify the agentId is correct",
    docsUrl: "https://docs.aegislabs.io/errors/agent_not_found",
  }),
  ["agent_revoked"]: Object.freeze({
    className: "AgentRevokedError",
    code: "agent_revoked",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Agent identity has been revoked.",
    category: "policy",
    next: "Register a fresh agent — revocation is permanent and intentional",
    docsUrl: "https://docs.aegislabs.io/errors/agent_revoked",
  }),
  ["already_rotated"]: Object.freeze({
    className: "AlreadyRotatedError",
    code: "already_rotated",
    httpStatus: 409,
    retryable: false,
    customerMessage: "This API key has already been rotated. Rotate the active key instead.",
    category: "auth",
    next: "Use the rotated key returned by the previous rotation call",
    docsUrl: "https://docs.aegislabs.io/errors/already_rotated",
  }),
  ["anomaly_flagged"]: Object.freeze({
    className: "AnomalyFlaggedError",
    code: "anomaly_flagged",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Behavioral anomaly detected; agent has been quarantined.",
    category: "policy",
    next: "Review the audit log for the flagged event; contact support@aegislabs.io if false-positive",
    docsUrl: "https://docs.aegislabs.io/errors/anomaly_flagged",
  }),
  ["auth_required"]: Object.freeze({
    className: "AuthenticationError",
    code: "auth_required",
    httpStatus: 401,
    retryable: false,
    customerMessage: "Authentication required. Provide a valid AEGIS API key.",
    category: "auth",
    next: "Set AEGIS_API_KEY in your environment, or pass apiKey to the SDK constructor",
    docsUrl: "https://docs.aegislabs.io/errors/auth_required",
  }),
  ["forbidden"]: Object.freeze({
    className: "AuthorizationError",
    code: "forbidden",
    httpStatus: 403,
    retryable: false,
    customerMessage: "You are not permitted to perform this action.",
    category: "auth",
    next: "Use an API key with the required scope, or contact your principal owner",
    docsUrl: "https://docs.aegislabs.io/errors/forbidden",
  }),
  ["upstream_unavailable"]: Object.freeze({
    className: "CircuitOpenError",
    code: "upstream_unavailable",
    httpStatus: 503,
    retryable: true, backoff: "exponential",
    customerMessage: "An upstream service is temporarily unavailable. Retry shortly.",
    category: "transient",
    next: "Upstream circuit is open; retry with backoff. The breaker auto-closes after a probe succeeds",
    docsUrl: "https://docs.aegislabs.io/errors/upstream_unavailable",
  }),
  ["conflict"]: Object.freeze({
    className: "ConflictError",
    code: "conflict",
    httpStatus: 409,
    retryable: false,
    customerMessage: "The request conflicts with the current state of the resource.",
    category: "validation",
    next: "Re-read the resource, reconcile your local state, and retry",
    docsUrl: "https://docs.aegislabs.io/errors/conflict",
  }),
  ["idempotency_conflict"]: Object.freeze({
    className: "IdempotencyConflictError",
    code: "idempotency_conflict",
    httpStatus: 409,
    retryable: false,
    customerMessage: "An idempotency key was reused with a different request body.",
    category: "validation",
    next: "Reuse a unique Idempotency-Key per distinct request body",
    docsUrl: "https://docs.aegislabs.io/errors/idempotency_conflict",
  }),
  ["internal_error"]: Object.freeze({
    className: "InternalError",
    code: "internal_error",
    httpStatus: 500,
    retryable: true, backoff: "exponential",
    customerMessage: "An internal error occurred. The request can be retried.",
    category: "internal",
    next: "Retry with exponential backoff; if persistent, check https://status.aegislabs.io",
    docsUrl: "https://docs.aegislabs.io/errors/internal_error",
  }),
  ["invalid_signature"]: Object.freeze({
    className: "InvalidSignatureError",
    code: "invalid_signature",
    httpStatus: 401,
    retryable: false,
    customerMessage: "Request signature is invalid or expired.",
    category: "crypto",
    next: "Check clock skew (NTP), key match (agentId ↔ privateKey), and token TTL (default 60s)",
    docsUrl: "https://docs.aegislabs.io/errors/invalid_signature",
  }),
  ["not_found"]: Object.freeze({
    className: "NotFoundError",
    code: "not_found",
    httpStatus: 404,
    retryable: false,
    customerMessage: "The requested resource was not found.",
    category: "validation",
    next: "Verify the resource id exists for your principal — list with the corresponding *.list() method",
    docsUrl: "https://docs.aegislabs.io/errors/not_found",
  }),
  ["plan_limit_exceeded"]: Object.freeze({
    className: "PlanLimitExceededError",
    code: "plan_limit_exceeded",
    httpStatus: 402,
    retryable: false,
    customerMessage: "Plan monthly verify quota exceeded. Upgrade or wait for the next period.",
    category: "billing",
    next: "Upgrade at https://aegislabs.io/billing, or wait for the monthly period reset",
    docsUrl: "https://docs.aegislabs.io/errors/plan_limit_exceeded",
  }),
  ["policy_expired"]: Object.freeze({
    className: "PolicyExpiredError",
    code: "policy_expired",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Agent policy has expired. Re-authorize the agent.",
    category: "policy",
    next: "Mint a new policy via aegis.policies.create(agentId, ...) with a future expiresAt",
    docsUrl: "https://docs.aegislabs.io/errors/policy_expired",
  }),
  ["policy_revoked"]: Object.freeze({
    className: "PolicyRevokedError",
    code: "policy_revoked",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Agent policy was revoked.",
    category: "policy",
    next: "Mint a new policy — revocation is permanent; revoked policies cannot be reactivated",
    docsUrl: "https://docs.aegislabs.io/errors/policy_revoked",
  }),
  ["rate_limited"]: Object.freeze({
    className: "RateLimitedError",
    code: "rate_limited",
    httpStatus: 429,
    retryable: true, backoff: "on_retry_after_header",
    customerMessage: "Rate limit exceeded. Honor the Retry-After header before retrying.",
    category: "rate_limit",
    next: "Wait the Retry-After seconds before retrying; consider request batching",
    docsUrl: "https://docs.aegislabs.io/errors/rate_limited",
  }),
  ["scope_not_granted"]: Object.freeze({
    className: "ScopeNotGrantedError",
    code: "scope_not_granted",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Action not in agent's allowed scopes.",
    category: "policy",
    next: "Add the action's scope to the agent's policy, or use a policy that already grants it",
    docsUrl: "https://docs.aegislabs.io/errors/scope_not_granted",
  }),
  ["service_unavailable"]: Object.freeze({
    className: "ServiceUnavailableError",
    code: "service_unavailable",
    httpStatus: 503,
    retryable: true, backoff: "exponential",
    customerMessage: "The service is temporarily unavailable. Retry shortly.",
    category: "transient",
    next: "Retry with exponential backoff; check https://status.aegislabs.io",
    docsUrl: "https://docs.aegislabs.io/errors/service_unavailable",
  }),
  ["spend_limit_exceeded"]: Object.freeze({
    className: "SpendLimitExceededError",
    code: "spend_limit_exceeded",
    httpStatus: 402,
    retryable: false,
    customerMessage: "Agent spend limit exceeded for the current period.",
    category: "billing",
    next: "Wait for the period reset or update the policy's spendLimit via aegis.policies.create(...)",
    docsUrl: "https://docs.aegislabs.io/errors/spend_limit_exceeded",
  }),
  ["trial_exhausted"]: Object.freeze({
    className: "TrialExhaustedError",
    code: "trial_exhausted",
    httpStatus: 402,
    retryable: false,
    customerMessage: "Free trial verify cap reached. Upgrade to a paid plan to continue.",
    category: "billing",
    next: "Upgrade at https://aegislabs.io/billing — lifetime trial cap is intentional",
    docsUrl: "https://docs.aegislabs.io/errors/trial_exhausted",
  }),
  ["trust_score_too_low"]: Object.freeze({
    className: "TrustScoreTooLowError",
    code: "trust_score_too_low",
    httpStatus: 403,
    retryable: false,
    customerMessage: "Agent trust score is below the configured threshold.",
    category: "policy",
    next: "Build agent reputation over time, or lower the relying party's minTrustBand requirement",
    docsUrl: "https://docs.aegislabs.io/errors/trust_score_too_low",
  }),
  ["invalid_request"]: Object.freeze({
    className: "ValidationError",
    code: "invalid_request",
    httpStatus: 400,
    retryable: false,
    customerMessage: "The request payload failed validation.",
    category: "validation",
    next: "Check the request body against the OpenAPI schema or the SDK types",
    docsUrl: "https://docs.aegislabs.io/errors/invalid_request",
  }),
});
