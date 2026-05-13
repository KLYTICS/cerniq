# @generated — do not edit; run pnpm gen:error-catalog
#
# Mirror of apps/api/src/common/errors/error-catalog.ts. Keyed by
# stable lower-snake-case `code`. The Python SDK consults this for
# retry decisions, customer messages, and category routing.

from __future__ import annotations

from typing import Final, TypedDict


class ErrorCatalogEntry(TypedDict, total=False):
    className: str
    code: str
    httpStatus: int
    retryable: bool
    backoff: str  # one of: none, linear, exponential, on_retry_after_header
    customerMessage: str
    category: str  # auth|validation|policy|rate_limit|billing|crypto|transient|internal


GENERATED_ERROR_CATALOG: Final[dict[str, ErrorCatalogEntry]] = {
    "agent_not_found": {
        "className": "AgentNotFoundError",
        "code": "agent_not_found",
        "httpStatus": 404,
        "retryable": False,
        "customerMessage": "Agent identity not found.",
        "category": "policy",
    },
    "agent_revoked": {
        "className": "AgentRevokedError",
        "code": "agent_revoked",
        "httpStatus": 403,
        "retryable": False,
        "customerMessage": "Agent identity has been revoked.",
        "category": "policy",
    },
    "already_rotated": {
        "className": "AlreadyRotatedError",
        "code": "already_rotated",
        "httpStatus": 409,
        "retryable": False,
        "customerMessage": "This API key has already been rotated. Rotate the active key instead.",
        "category": "auth",
    },
    "anomaly_flagged": {
        "className": "AnomalyFlaggedError",
        "code": "anomaly_flagged",
        "httpStatus": 403,
        "retryable": False,
        "customerMessage": "Behavioral anomaly detected; agent has been quarantined.",
        "category": "policy",
    },
    "auth_required": {
        "className": "AuthenticationError",
        "code": "auth_required",
        "httpStatus": 401,
        "retryable": False,
        "customerMessage": "Authentication required. Provide a valid AEGIS API key.",
        "category": "auth",
    },
    "forbidden": {
        "className": "AuthorizationError",
        "code": "forbidden",
        "httpStatus": 403,
        "retryable": False,
        "customerMessage": "You are not permitted to perform this action.",
        "category": "auth",
    },
    "upstream_unavailable": {
        "className": "CircuitOpenError",
        "code": "upstream_unavailable",
        "httpStatus": 503,
        "retryable": True,
        "backoff": "exponential",
        "customerMessage": "An upstream service is temporarily unavailable. Retry shortly.",
        "category": "transient",
    },
    "conflict": {
        "className": "ConflictError",
        "code": "conflict",
        "httpStatus": 409,
        "retryable": False,
        "customerMessage": "The request conflicts with the current state of the resource.",
        "category": "validation",
    },
    "idempotency_conflict": {
        "className": "IdempotencyConflictError",
        "code": "idempotency_conflict",
        "httpStatus": 409,
        "retryable": False,
        "customerMessage": "An idempotency key was reused with a different request body.",
        "category": "validation",
    },
    "internal_error": {
        "className": "InternalError",
        "code": "internal_error",
        "httpStatus": 500,
        "retryable": True,
        "backoff": "exponential",
        "customerMessage": "An internal error occurred. The request can be retried.",
        "category": "internal",
    },
    "invalid_signature": {
        "className": "InvalidSignatureError",
        "code": "invalid_signature",
        "httpStatus": 401,
        "retryable": False,
        "customerMessage": "Request signature is invalid or expired.",
        "category": "crypto",
    },
    "not_found": {
        "className": "NotFoundError",
        "code": "not_found",
        "httpStatus": 404,
        "retryable": False,
        "customerMessage": "The requested resource was not found.",
        "category": "validation",
    },
    "plan_limit_exceeded": {
        "className": "PlanLimitExceededError",
        "code": "plan_limit_exceeded",
        "httpStatus": 402,
        "retryable": False,
        "customerMessage": "Plan monthly verify quota exceeded. Upgrade or wait for the next period.",
        "category": "billing",
    },
    "policy_expired": {
        "className": "PolicyExpiredError",
        "code": "policy_expired",
        "httpStatus": 403,
        "retryable": False,
        "customerMessage": "Agent policy has expired. Re-authorize the agent.",
        "category": "policy",
    },
    "policy_revoked": {
        "className": "PolicyRevokedError",
        "code": "policy_revoked",
        "httpStatus": 403,
        "retryable": False,
        "customerMessage": "Agent policy was revoked.",
        "category": "policy",
    },
    "rate_limited": {
        "className": "RateLimitedError",
        "code": "rate_limited",
        "httpStatus": 429,
        "retryable": True,
        "backoff": "on_retry_after_header",
        "customerMessage": "Rate limit exceeded. Honor the Retry-After header before retrying.",
        "category": "rate_limit",
    },
    "scope_not_granted": {
        "className": "ScopeNotGrantedError",
        "code": "scope_not_granted",
        "httpStatus": 403,
        "retryable": False,
        "customerMessage": "Action not in agent's allowed scopes.",
        "category": "policy",
    },
    "service_unavailable": {
        "className": "ServiceUnavailableError",
        "code": "service_unavailable",
        "httpStatus": 503,
        "retryable": True,
        "backoff": "exponential",
        "customerMessage": "The service is temporarily unavailable. Retry shortly.",
        "category": "transient",
    },
    "spend_limit_exceeded": {
        "className": "SpendLimitExceededError",
        "code": "spend_limit_exceeded",
        "httpStatus": 402,
        "retryable": False,
        "customerMessage": "Agent spend limit exceeded for the current period.",
        "category": "billing",
    },
    "trial_exhausted": {
        "className": "TrialExhaustedError",
        "code": "trial_exhausted",
        "httpStatus": 402,
        "retryable": False,
        "customerMessage": "Free trial verify cap reached. Upgrade to a paid plan to continue.",
        "category": "billing",
    },
    "trust_score_too_low": {
        "className": "TrustScoreTooLowError",
        "code": "trust_score_too_low",
        "httpStatus": 403,
        "retryable": False,
        "customerMessage": "Agent trust score is below the configured threshold.",
        "category": "policy",
    },
    "invalid_request": {
        "className": "ValidationError",
        "code": "invalid_request",
        "httpStatus": 400,
        "retryable": False,
        "customerMessage": "The request payload failed validation.",
        "category": "validation",
    },
    "webhook_payload_drift": {
        "className": "WebhookPayloadValidationError",
        "code": "webhook_payload_drift",
        "httpStatus": 500,
        "retryable": False,
        "customerMessage": "Internal webhook contract violation.",
        "category": "internal",
    },
}
