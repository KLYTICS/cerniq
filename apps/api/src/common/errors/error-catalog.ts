// Error catalog — single source of truth for runtime metadata about every
// thrown error class in the AEGIS API.
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
// avoids forcing every error class to extend AegisError (CircuitOpenError
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
  category: 'auth' | 'validation' | 'policy' | 'rate_limit' | 'billing' | 'crypto' | 'transient' | 'internal';
  /**
   * One-line actionable next step for the developer hitting this error.
   * Round 25 — required for every entry. Read by:
   *   - SDK `AegisError.next` (TS + Python)
   *   - CLI `aegis doctor` red-row remediation column
   *   - Dashboard error toasts
   * Style guide: imperative, ≤ 100 chars, names the env var / method / URL
   * the developer should touch. Never end with a period (chained with the
   * customer message in UI surfaces).
   */
  next: string;
  /**
   * Stable docs URL for this error. Pattern: `https://docs.aegislabs.io/errors/<code>`.
   * Surfaced by SDKs as `AegisError.docsUrl` so developer tools can deep-link.
   */
  docsUrl: string;
}

/**
 * The catalog. Keyed by JS class name (`constructor.name`) so the runtime
 * lookup is `ERROR_CATALOG[err.constructor.name]`.
 *
 * Adding a new error class? Add the class, then add an entry here. The
 * audit script will fail CI until both halves are present.
 */
export const ERROR_CATALOG: Readonly<Record<string, ErrorCatalogEntry>> = Object.freeze({
  // --- existing AegisError subclasses (apps/api/src/common/errors/aegis-error.ts) ---

  AuthenticationError: {
    code: 'auth_required',
    httpStatus: 401,
    retryable: false,
    customerMessage: 'Authentication required. Provide a valid AEGIS API key.',
    category: 'auth',
    next: 'Set AEGIS_API_KEY in your environment, or pass apiKey to the SDK constructor',
    docsUrl: 'https://docs.aegislabs.io/errors/auth_required',
  },

  AuthorizationError: {
    code: 'forbidden',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'You are not permitted to perform this action.',
    category: 'auth',
    next: 'Use an API key with the required scope, or contact your principal owner',
    docsUrl: 'https://docs.aegislabs.io/errors/forbidden',
  },

  NotFoundError: {
    code: 'not_found',
    httpStatus: 404,
    retryable: false,
    customerMessage: 'The requested resource was not found.',
    category: 'validation',
    next: 'Verify the resource id exists for your principal — list with the corresponding *.list() method',
    docsUrl: 'https://docs.aegislabs.io/errors/not_found',
  },

  ValidationError: {
    code: 'invalid_request',
    httpStatus: 400,
    retryable: false,
    customerMessage: 'The request payload failed validation.',
    category: 'validation',
    next: 'Check the request body against the OpenAPI schema or the SDK types',
    docsUrl: 'https://docs.aegislabs.io/errors/invalid_request',
  },

  ConflictError: {
    code: 'conflict',
    httpStatus: 409,
    retryable: false,
    customerMessage: 'The request conflicts with the current state of the resource.',
    category: 'validation',
    next: 'Re-read the resource, reconcile your local state, and retry',
    docsUrl: 'https://docs.aegislabs.io/errors/conflict',
  },

  AlreadyRotatedError: {
    code: 'already_rotated',
    httpStatus: 409,
    retryable: false,
    customerMessage: 'This API key has already been rotated. Rotate the active key instead.',
    category: 'auth',
    next: 'Use the rotated key returned by the previous rotation call',
    docsUrl: 'https://docs.aegislabs.io/errors/already_rotated',
  },

  IdempotencyConflictError: {
    code: 'idempotency_conflict',
    httpStatus: 409,
    retryable: false,
    customerMessage: 'An idempotency key was reused with a different request body.',
    category: 'validation',
    next: 'Reuse a unique Idempotency-Key per distinct request body',
    docsUrl: 'https://docs.aegislabs.io/errors/idempotency_conflict',
  },

  RateLimitedError: {
    code: 'rate_limited',
    httpStatus: 429,
    retryable: true,
    backoff: 'on_retry_after_header',
    customerMessage: 'Rate limit exceeded. Honor the Retry-After header before retrying.',
    category: 'rate_limit',
    next: 'Wait the Retry-After seconds before retrying; consider request batching',
    docsUrl: 'https://docs.aegislabs.io/errors/rate_limited',
  },

  InternalError: {
    code: 'internal_error',
    httpStatus: 500,
    retryable: true,
    backoff: 'exponential',
    customerMessage: 'An internal error occurred. The request can be retried.',
    category: 'internal',
    next: 'Retry with exponential backoff; if persistent, check https://status.aegislabs.io',
    docsUrl: 'https://docs.aegislabs.io/errors/internal_error',
  },

  ServiceUnavailableError: {
    code: 'service_unavailable',
    httpStatus: 503,
    retryable: true,
    backoff: 'exponential',
    customerMessage: 'The service is temporarily unavailable. Retry shortly.',
    category: 'transient',
    next: 'Retry with exponential backoff; check https://status.aegislabs.io',
    docsUrl: 'https://docs.aegislabs.io/errors/service_unavailable',
  },

  // --- non-AegisError throwers we still want cataloged ---
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
    next: 'Upstream circuit is open; retry with backoff. The breaker auto-closes after a probe succeeds',
    docsUrl: 'https://docs.aegislabs.io/errors/upstream_unavailable',
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
    next: 'Register the agent via aegis.agents.register(...) or verify the agentId is correct',
    docsUrl: 'https://docs.aegislabs.io/errors/agent_not_found',
  },
  AgentRevokedError: {
    code: 'agent_revoked',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'Agent identity has been revoked.',
    category: 'policy',
    next: 'Register a fresh agent — revocation is permanent and intentional',
    docsUrl: 'https://docs.aegislabs.io/errors/agent_revoked',
  },
  InvalidSignatureError: {
    code: 'invalid_signature',
    httpStatus: 401,
    retryable: false,
    customerMessage: 'Request signature is invalid or expired.',
    category: 'crypto',
    next: 'Check clock skew (NTP), key match (agentId ↔ privateKey), and token TTL (default 60s)',
    docsUrl: 'https://docs.aegislabs.io/errors/invalid_signature',
  },
  PolicyExpiredError: {
    code: 'policy_expired',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'Agent policy has expired. Re-authorize the agent.',
    category: 'policy',
    next: 'Mint a new policy via aegis.policies.create(agentId, ...) with a future expiresAt',
    docsUrl: 'https://docs.aegislabs.io/errors/policy_expired',
  },
  PolicyRevokedError: {
    code: 'policy_revoked',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'Agent policy was revoked.',
    category: 'policy',
    next: 'Mint a new policy — revocation is permanent; revoked policies cannot be reactivated',
    docsUrl: 'https://docs.aegislabs.io/errors/policy_revoked',
  },
  ScopeNotGrantedError: {
    code: 'scope_not_granted',
    httpStatus: 403,
    retryable: false,
    customerMessage: "Action not in agent's allowed scopes.",
    category: 'policy',
    next: "Add the action's scope to the agent's policy, or use a policy that already grants it",
    docsUrl: 'https://docs.aegislabs.io/errors/scope_not_granted',
  },
  TrialExhaustedError: {
    code: 'trial_exhausted',
    httpStatus: 402,
    retryable: false,
    customerMessage: 'Free trial verify cap reached. Upgrade to a paid plan to continue.',
    category: 'billing',
    next: 'Upgrade at https://aegislabs.io/billing — lifetime trial cap is intentional',
    docsUrl: 'https://docs.aegislabs.io/errors/trial_exhausted',
  },
  SpendLimitExceededError: {
    code: 'spend_limit_exceeded',
    httpStatus: 402,
    retryable: false,
    customerMessage: 'Agent spend limit exceeded for the current period.',
    category: 'billing',
    next: "Wait for the period reset or update the policy's spendLimit via aegis.policies.create(...)",
    docsUrl: 'https://docs.aegislabs.io/errors/spend_limit_exceeded',
  },
  TrustScoreTooLowError: {
    code: 'trust_score_too_low',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'Agent trust score is below the configured threshold.',
    category: 'policy',
    next: "Build agent reputation over time, or lower the relying party's minTrustBand requirement",
    docsUrl: 'https://docs.aegislabs.io/errors/trust_score_too_low',
  },
  AnomalyFlaggedError: {
    code: 'anomaly_flagged',
    httpStatus: 403,
    retryable: false,
    customerMessage: 'Behavioral anomaly detected; agent has been quarantined.',
    category: 'policy',
    next: 'Review the audit log for the flagged event; contact support@aegislabs.io if false-positive',
    docsUrl: 'https://docs.aegislabs.io/errors/anomaly_flagged',
  },
  PlanLimitExceededError: {
    code: 'plan_limit_exceeded',
    httpStatus: 402,
    retryable: false,
    customerMessage: 'Plan monthly verify quota exceeded. Upgrade or wait for the next period.',
    category: 'billing',
    next: 'Upgrade at https://aegislabs.io/billing, or wait for the monthly period reset',
    docsUrl: 'https://docs.aegislabs.io/errors/plan_limit_exceeded',
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
  next: 'Retry with exponential backoff; if persistent, check https://status.aegislabs.io',
  docsUrl: 'https://docs.aegislabs.io/errors/internal_error',
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
  // Prefer the static `catalogKey` discriminator on AegisError subclasses —
  // it survives bundler name-mangling (tsup minify) which would otherwise
  // collapse `error.constructor.name` to "a"/"b"/... and silently route
  // every error through INTERNAL_FALLBACK. See peer review F-06.
  // Fall back to constructor.name for non-AegisError throwers like the
  // resilience module's CircuitOpenError.
  const ctor = error.constructor as { catalogKey?: string; name: string };
  const key = typeof ctor.catalogKey === 'string' && ctor.catalogKey !== '' ? ctor.catalogKey : ctor.name;
  return ERROR_CATALOG[key] ?? null;
}

/** Convenience: is this error safe to retry? Defaults to false for unknown errors. */
export function isRetryable(error: unknown): boolean {
  const entry = getCatalogEntry(error);
  return entry?.retryable ?? false;
}

/** What the global exception filter serializes for AegisError responses. */
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
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    payload.retryAfter = Math.floor(retryAfterSeconds);
  }
  return payload;
}

/** Exposed for the filter so it can map to a known status without re-throwing. */
export function getInternalFallback(): ErrorCatalogEntry {
  return INTERNAL_FALLBACK;
}
