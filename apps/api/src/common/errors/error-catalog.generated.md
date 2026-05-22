<!--
GENERATED FROM error-catalog.ts — do not hand-edit.
Regenerate via: pnpm --filter @okoro/api exec tsx scripts/regenerate-error-catalog-md.ts
(See scripts/audit-error-catalog.ts for the in-tree audit guard.)
-->

# OKORO Error Catalog

This table is the canonical, customer-facing surface for every error class
the OKORO API can return. Stable code identifiers are guaranteed for the
duration of an API major version. New entries are additive.

| Class | Code | HTTP | Retryable | Backoff | Category | Customer message |
| --- | --- | ---: | :---: | --- | --- | --- |
| `AuthenticationError` | `auth_required` | 401 | no | — | auth | Authentication required. Provide a valid OKORO API key. |
| `AuthorizationError` | `forbidden` | 403 | no | — | auth | You are not permitted to perform this action. |
| `NotFoundError` | `not_found` | 404 | no | — | validation | The requested resource was not found. |
| `ValidationError` | `invalid_request` | 400 | no | — | validation | The request payload failed validation. |
| `ConflictError` | `conflict` | 409 | no | — | validation | The request conflicts with the current state of the resource. |
| `AlreadyRotatedError` | `already_rotated` | 409 | no | — | auth | This API key has already been rotated. Rotate the active key instead. |
| `IdempotencyConflictError` | `idempotency_conflict` | 409 | no | — | validation | An idempotency key was reused with a different request body. |
| `RateLimitedError` | `rate_limited` | 429 | yes | `on_retry_after_header` | rate_limit | Rate limit exceeded. Honor the Retry-After header before retrying. |
| `InternalError` | `internal_error` | 500 | yes | `exponential` | internal | An internal error occurred. The request can be retried. |
| `ServiceUnavailableError` | `service_unavailable` | 503 | yes | `exponential` | transient | The service is temporarily unavailable. Retry shortly. |
| `CircuitOpenError` | `upstream_unavailable` | 503 | yes | `exponential` | transient | An upstream service is temporarily unavailable. Retry shortly. |
| `AgentNotFoundError` | `agent_not_found` | 404 | no | — | policy | Agent identity not found. |
| `AgentRevokedError` | `agent_revoked` | 403 | no | — | policy | Agent identity has been revoked. |
| `InvalidSignatureError` | `invalid_signature` | 401 | no | — | crypto | Request signature is invalid or expired. |
| `PolicyExpiredError` | `policy_expired` | 403 | no | — | policy | Agent policy has expired. Re-authorize the agent. |
| `PolicyRevokedError` | `policy_revoked` | 403 | no | — | policy | Agent policy was revoked. |
| `ScopeNotGrantedError` | `scope_not_granted` | 403 | no | — | policy | Action not in agent's allowed scopes. |
| `SpendLimitExceededError` | `spend_limit_exceeded` | 402 | no | — | billing | Agent spend limit exceeded for the current period. |
| `TrustScoreTooLowError` | `trust_score_too_low` | 403 | no | — | policy | Agent trust score is below the configured threshold. |
| `AnomalyFlaggedError` | `anomaly_flagged` | 403 | no | — | policy | Behavioral anomaly detected; agent has been quarantined. |
| `PlanLimitExceededError` | `plan_limit_exceeded` | 402 | no | — | billing | Plan monthly verify quota exceeded. Upgrade or wait for the next period. |

## Notes

- `code` is the stable client-matching identifier. SDKs key off this, never
  off the HTTP status code or the human-readable message.
- The denial-precedence codes (`agent_not_found` through `anomaly_flagged`)
  are returned in 200 verify responses on the hot path and are listed here
  so the catalog is the single source of truth across both transport
  paths.
- `CircuitOpenError` extends the platform `Error` rather than `OkoroError`
  on purpose — the resilience module is framework-agnostic. The HTTP
  filter consults this catalog by class name to render its envelope.
