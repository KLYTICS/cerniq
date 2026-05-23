// Error catalog — single source of truth for runtime metadata about every
// thrown error class in the CERNIQ API.
//
// Why this exists:
//   - Operators and SDK authors need a stable contract: "what does HTTP 402
//     mean here?" "is this safe to retry?" "what's the customer-facing
//     wording?" This file is that contract, machine-readable.
//   - The HTTP exception filter consults this to render the canonical
//     envelope without reaching into the thrown class.
//   - The audit script in scripts/audit-error-catalog.ts walks the source
//     tree for `throw new <X>Error(...)` calls and asserts that every
//     thrown class name has an entry below.
//
// Pattern: registry keyed by the JS class name (constructor.name). This
// avoids forcing every error class to extend CerniqError (CircuitOpenError
// in common/resilience does not — it's framework-agnostic on purpose) and
// it keeps ESLint happy without abstract statics or decorator metadata.
//
// Stability: keys here ARE the public stable codes (lower-snake-case). Do
// not rename a key without coordinating an SDK + docs bump. New entries
// are additive.

/** What the SDK / dashboard / RP integration code reads. */
export interface ErrorCatalogEntry {
  /** Stable lower-snake-case code for client SDK matching. */
  code: string;
  /** 4xx or 5xx integer. */
  httpStatus: number;
  /** Can the same request be retried as-is and possibly succeed? */
  retryable: boolean;
  /** Hint for SDK retry strategy. Omitted when retryable is false. */
  backoff?: 'none' | 'linear' | 'exponential' | 'on_retry_after_header';
  /** Customer-safe message. NEVER includes internals, key material, or stack data. */
  customerMessage: string;
  /** Coarse classification used by ops dashboards. */
  category:
    | 'auth'
    | 'validation'
    | 'policy'
    | 'rate_limit'
    | 'billing'
    | 'crypto'
    | 'transient'
    | 'internal';
}

/**
 * The catalog. Keyed by JS class name (`constructor.name`) so the runtime
 * lookup is `ERROR_CATALOG[err.constructor.name]`.
 *
 * Adding a new error class? Add the class, then add an entry here. The
 * audit script will fail CI until both halves are present.
 */
export const ERROR_CATALOG: Readonly<Record<string, ErrorCatalogEntry>> = Object.freeze({
  // --- existing CerniqError subclasses (apps/api/src/common/errors/cerniq-error.ts) ---

  AuthenticationError: {
    code: 'auth_required',
    httpStatus: 401,
    retryable: false,
    customerMessage: 'Authentication required. Provide a valid CERNIQ API key.',
    category: 'auth',
  },

  AuthorizationError: {
    code: 'forbidden',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'You are not permitted to perform this action.',
    category: 'auth',
  },

  NotFoundError: {
    code: 'not_found',
    httpStatus: 404,
    retryable: false,
    customerMessage: 'The requested resource was not found.',
    category: 'validation',
  },

  ValidationError: {
    code: 'invalid_request',
    httpStatus: 400,
    retryable: false,
    customerMessage: 'The request payload failed validation.',
    category: 'validation',
  },

  ConflictError: {
    code: 'conflict',
    httpStatus: 409,
    retryable: false,
    customerMessage: 'The request conflicts with the current state of the resource.',
    category: 'validation',
  },

  AlreadyRotatedError: {
    code: 'already_rotated',
    httpStatus: 409,
    retryable: false,
    customerMessage: 'This API key has already been rotated. Rotate the active key instead.',
    category: 'auth',
  },

  IdempotencyConflictError: {
    code: 'idempotency_conflict',
    httpStatus: 409,
    retryable: false,
    customerMessage: 'An idempotency key was reused with a different request body.',
    category: 'validation',
  },

  RateLimitedError: {
    code: 'rate_limited',
    httpStatus: 429,
    retryable: true,
    backoff: 'on_retry_after_header',
    customerMessage: 'Rate limit exceeded. Honor the Retry-After header before retrying.',
    category: 'rate_limit',
  },

  InternalError: {
    code: 'internal_error',
    httpStatus: 500,
    retryable: true,
    backoff: 'exponential',
    customerMessage: 'An internal error occurred. The request can be retried.',
    category: 'internal',
  },

  ServiceUnavailableError: {
    code: 'service_unavailable',
    httpStatus: 503,
    retryable: true,
    backoff: 'exponential',
    customerMessage: 'The service is temporarily unavailable. Retry shortly.',
    category: 'transient',
  },

  // --- non-CerniqError throwers we still want cataloged ---
  // CircuitOpenError lives in common/resilience and intentionally extends
  // the plain Error to keep the breaker framework-agnostic. The filter
  // still maps it to a customer-safe 503 via this entry.

  CircuitOpenError: {
    code: 'upstream_unavailable',
    httpStatus: 503,
    retryable: true,
    backoff: 'exponential',
    customerMessage: 'An upstream service is temporarily unavailable. Retry shortly.',
    category: 'transient',
  },

  // --- denial-precedence semantic codes (reserved for verify hot path) ---
  // These are not standalone Error classes today — the verify endpoint
  // returns 200 with a denial body — but cataloging them here keeps the
  // SDK contract honest (clients match on `code`, not on HTTP status).

  AgentNotFoundError: {
    code: 'agent_not_found',
    httpStatus: 404,
    retryable: false,
    customerMessage: 'Agent identity not found.',
    category: 'policy',
  },
  AgentRevokedError: {
    code: 'agent_revoked',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'Agent identity has been revoked.',
    category: 'policy',
  },
  InvalidSignatureError: {
    code: 'invalid_signature',
    httpStatus: 401,
    retryable: false,
    customerMessage: 'Request signature is invalid or expired.',
    category: 'crypto',
  },
  PolicyExpiredError: {
    code: 'policy_expired',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'Agent policy has expired. Re-authorize the agent.',
    category: 'policy',
  },
  PolicyRevokedError: {
    code: 'policy_revoked',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'Agent policy was revoked.',
    category: 'policy',
  },
  ScopeNotGrantedError: {
    code: 'scope_not_granted',
    httpStatus: 403,
    retryable: false,
    customerMessage: "Action not in agent's allowed scopes.",
    category: 'policy',
  },
  TrialExhaustedError: {
    code: 'trial_exhausted',
    httpStatus: 402,
    retryable: false,
    customerMessage: 'Free trial verify cap reached. Upgrade to a paid plan to continue.',
    category: 'billing',
  },
  SpendLimitExceededError: {
    code: 'spend_limit_exceeded',
    httpStatus: 402,
    retryable: false,
    customerMessage: 'Agent spend limit exceeded for the current period.',
    category: 'billing',
  },
  TrustScoreTooLowError: {
    code: 'trust_score_too_low',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'Agent trust score is below the configured threshold.',
    category: 'policy',
  },
  AnomalyFlaggedError: {
    code: 'anomaly_flagged',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'Behavioral anomaly detected; agent has been quarantined.',
    category: 'policy',
  },
  PlanLimitExceededError: {
    code: 'plan_limit_exceeded',
    httpStatus: 402,
    retryable: false,
    customerMessage: 'Plan monthly verify quota exceeded. Upgrade or wait for the next period.',
    category: 'billing',
  },
});

/** Sentinel entry used when an arbitrary `Error` reaches the global filter. */
const INTERNAL_FALLBACK: ErrorCatalogEntry = {
  code: 'internal_error',
  httpStatus: 500,
  retryable: true,
  backoff: 'exponential',
  customerMessage: 'An internal error occurred. The request can be retried.',
  category: 'internal',
};

/**
 * Look up the catalog entry for a thrown error.
 *
 * Returns null when the error's class name is not in the catalog. Callers
 * (notably the global filter) treat null as "uncataloged → redact and
 * map to internal_error", which is the safe default.
 */
export function getCatalogEntry(error: unknown): ErrorCatalogEntry | null {
  if (!(error instanceof Error)) return null;
  // Prefer the static `catalogKey` discriminator on CerniqError subclasses —
  // it survives bundler name-mangling (tsup minify) which would otherwise
  // collapse `error.constructor.name` to "a"/"b"/... and silently route
  // every error through INTERNAL_FALLBACK. See peer review F-06.
  // Fall back to constructor.name for non-CerniqError throwers like the
  // resilience module's CircuitOpenError.
  const ctor = error.constructor as { catalogKey?: string; name: string };
  const key =
    typeof ctor.catalogKey === 'string' && ctor.catalogKey !== '' ? ctor.catalogKey : ctor.name;
  return ERROR_CATALOG[key] ?? null;
}

/** Convenience: is this error safe to retry? Defaults to false for unknown errors. */
export function isRetryable(error: unknown): boolean {
  const entry = getCatalogEntry(error);
  return entry?.retryable ?? false;
}

/** What the global exception filter serializes for CerniqError responses. */
export interface ClientErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  /** Seconds. Present only for rate-limit-style responses. */
  retryAfter?: number;
}

/**
 * Shape the client-facing payload for a thrown error. Always returns
 * customer-safe text — if the error is uncataloged we fall back to a
 * generic internal_error envelope rather than leaking the raw message.
 */
export function toClientPayload(error: unknown, retryAfterSeconds?: number): ClientErrorPayload {
  const entry = getCatalogEntry(error) ?? INTERNAL_FALLBACK;
  const payload: ClientErrorPayload = {
    code: entry.code,
    message: entry.customerMessage,
    retryable: entry.retryable,
  };
  if (
    retryAfterSeconds !== undefined &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds >= 0
  ) {
    payload.retryAfter = Math.floor(retryAfterSeconds);
  }
  return payload;
}

/** Exposed for the filter so it can map to a known status without re-throwing. */
export function getInternalFallback(): ErrorCatalogEntry {
  return INTERNAL_FALLBACK;
}
