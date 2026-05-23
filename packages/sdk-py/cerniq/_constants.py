"""Shared constants — mirrors ``packages/types/src/constants.ts``.

Importing the same constant from a Python client vs. the API guarantees they
agree on enum names, header names, and TTL boundaries.
"""

from __future__ import annotations

from typing import Final

# ── HTTP headers ─────────────────────────────────────────────
CERNIQ_HEADER_API_KEY: Final[str] = "X-CERNIQ-API-Key"
CERNIQ_HEADER_VERIFY_KEY: Final[str] = "X-CERNIQ-Verify-Key"
CERNIQ_HEADER_REQUEST_ID: Final[str] = "X-Request-Id"
CERNIQ_HEADER_TOKEN: Final[str] = "X-CERNIQ-Token"
CERNIQ_HEADER_SIGNATURE: Final[str] = "X-CERNIQ-Signature"
CERNIQ_HEADER_IDEMPOTENCY: Final[str] = "Idempotency-Key"

# ── Trust band thresholds (lower bound, inclusive) ───────────
TRUST_BAND_THRESHOLDS: Final[dict[str, int]] = {
    "PLATINUM": 750,
    "VERIFIED": 500,
    "WATCH": 250,
    "FLAGGED": 0,
}

# ── Token TTL ────────────────────────────────────────────────
TOKEN_TTL_MIN_SECONDS: Final[int] = 30
TOKEN_TTL_MAX_SECONDS: Final[int] = 60
TOKEN_TTL_DEFAULT_SECONDS: Final[int] = 60
POLICY_TTL_MAX_DAYS: Final[int] = 365

# ── Verify-response cache TTL ────────────────────────────────
VERIFY_RESULT_DEFAULT_TTL_SECONDS: Final[int] = 30

# ── Denial reason precedence (top wins) ──────────────────────
DENIAL_REASON_PRECEDENCE: Final[tuple[str, ...]] = (
    "AGENT_NOT_FOUND",
    "AGENT_REVOKED",
    "INVALID_SIGNATURE",
    "POLICY_REVOKED",
    "POLICY_EXPIRED",
    "SCOPE_NOT_GRANTED",
    "SPEND_LIMIT_EXCEEDED",
    "TRUST_SCORE_TOO_LOW",
    "ANOMALY_FLAGGED",
)

# ── Webhook event names ──────────────────────────────────────
WEBHOOK_EVENT: Final[dict[str, str]] = {
    "AGENT_TRUST_SCORE_CHANGED": "cerniq.agent.trust_score_changed",
    "AGENT_ANOMALY_DETECTED": "cerniq.agent.anomaly_detected",
    "AGENT_POLICY_EXPIRED": "cerniq.agent.policy_expired",
    "AGENT_FLAGGED_BY_RELYING_PARTY": "cerniq.agent.flagged_by_relying_party",
    "AGENT_REVOKED": "cerniq.agent.revoked",
}

# ── Defaults ─────────────────────────────────────────────────
DEFAULT_BASE_URL: Final[str] = "https://api.cerniqapp.com/v1"
DEFAULT_TIMEOUT_MS: Final[int] = 5_000
DEFAULT_MAX_RETRIES: Final[int] = 3
RETRY_BACKOFF_MS: Final[tuple[int, ...]] = (250, 500, 1_000)
