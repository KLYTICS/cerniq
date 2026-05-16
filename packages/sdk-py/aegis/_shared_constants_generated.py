# @generated — do not edit; run `pnpm gen:shared-constants`
#
# Wire-level constants mirrored from packages/types/src/constants.ts.
# Header names, trust-band thresholds, TTL bounds, webhook event IDs —
# anything that, if it drifted between TS and Py, would silently produce
# a different request, cache key, or webhook subscription on the Python
# side. Companion to _denial_reason_generated.py.
#
# CI gate `pnpm check:shared-constants-gen` re-runs the generator and
# fails if this file diverges from the canonical source. Hand edits will
# be clobbered by the next `pnpm gen:shared-constants` invocation.

from __future__ import annotations

from typing import Final

# ── HTTP headers ─────────────────────────────────────────────
AEGIS_HEADER_API_KEY: Final[str] = "X-AEGIS-API-Key"
AEGIS_HEADER_VERIFY_KEY: Final[str] = "X-AEGIS-Verify-Key"
AEGIS_HEADER_REQUEST_ID: Final[str] = "X-Request-Id"
AEGIS_HEADER_TOKEN: Final[str] = "X-AEGIS-Token"
AEGIS_HEADER_SIGNATURE: Final[str] = "X-AEGIS-Signature"
AEGIS_HEADER_IDEMPOTENCY: Final[str] = "Idempotency-Key"

# ── Trust band thresholds (lower bound, inclusive) ───────────
TRUST_BAND_THRESHOLDS: Final[dict[str, int]] = {
    "PLATINUM": 750,
    "VERIFIED": 500,
    "WATCH": 250,
    "FLAGGED": 0,
}

# ── Token / policy TTL bounds ────────────────────────────────
TOKEN_TTL_MIN_SECONDS: Final[int] = 30
TOKEN_TTL_MAX_SECONDS: Final[int] = 60
POLICY_TTL_MAX_DAYS: Final[int] = 365

# ── Verify-response cache TTL ────────────────────────────────
VERIFY_RESULT_DEFAULT_TTL_SECONDS: Final[int] = 30

# ── Webhook event names ──────────────────────────────────────
WEBHOOK_EVENT: Final[dict[str, str]] = {
    "AGENT_TRUST_SCORE_CHANGED": "aegis.agent.trust_score_changed",
    "AGENT_ANOMALY_DETECTED": "aegis.agent.anomaly_detected",
    "AGENT_POLICY_EXPIRED": "aegis.agent.policy_expired",
    "AGENT_FLAGGED_BY_RELYING_PARTY": "aegis.agent.flagged_by_relying_party",
    "AGENT_REVOKED": "aegis.agent.revoked",
}
