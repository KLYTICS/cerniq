"""Pydantic models — typed wire-format mirrors of ``packages/types/src/schemas.ts``.

Wire format is camelCase (matches the OpenAPI spec); Python attributes are
snake_case. ``ConfigDict(populate_by_name=True, alias_generator=to_camel)``
makes both work transparently — you can pass either flavor to a constructor,
and ``.model_dump()`` defaults to camelCase for the wire.
"""

from __future__ import annotations

import sys
from datetime import datetime
from typing import Any

if sys.version_info >= (3, 11):
    from enum import StrEnum
else:
    from enum import Enum

    class StrEnum(str, Enum):  # type: ignore[no-redef]
        """Backport of StrEnum for Python <3.11."""

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# ── Enums ────────────────────────────────────────────────────


class AgentRuntime(StrEnum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    HUGGINGFACE = "huggingface"
    CUSTOM = "custom"


class AgentStatus(StrEnum):
    PENDING_VERIFICATION = "pending_verification"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REVOKED = "revoked"


class TrustBand(StrEnum):
    PLATINUM = "PLATINUM"
    VERIFIED = "VERIFIED"
    WATCH = "WATCH"
    FLAGGED = "FLAGGED"


class PolicyStatus(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"


class PolicyCategory(StrEnum):
    COMMERCE = "commerce"
    DATA_READ = "data-read"
    DATA_WRITE = "data-write"
    COMMUNICATION = "communication"
    SCHEDULING = "scheduling"


class Currency(StrEnum):
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"


class DenialReason(StrEnum):
    # Billing pre-gate — fires BEFORE the 9-step algorithm chain.
    # Relying parties receiving this should direct users to upgrade their plan.
    PLAN_LIMIT_EXCEEDED = "PLAN_LIMIT_EXCEEDED"
    # 9-step algorithm chain (in precedence order):
    AGENT_NOT_FOUND = "AGENT_NOT_FOUND"
    AGENT_REVOKED = "AGENT_REVOKED"
    INVALID_SIGNATURE = "INVALID_SIGNATURE"
    POLICY_REVOKED = "POLICY_REVOKED"
    POLICY_EXPIRED = "POLICY_EXPIRED"
    SCOPE_NOT_GRANTED = "SCOPE_NOT_GRANTED"
    SPEND_LIMIT_EXCEEDED = "SPEND_LIMIT_EXCEEDED"
    TRUST_SCORE_TOO_LOW = "TRUST_SCORE_TOO_LOW"
    ANOMALY_FLAGGED = "ANOMALY_FLAGGED"


class SignalSeverity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ReportEventType(StrEnum):
    FRAUD_CONFIRMED = "fraud_confirmed"
    ANOMALY = "anomaly"
    POLICY_VIOLATION = "policy_violation"
    SUSPICIOUS_BEHAVIOR = "suspicious_behavior"
    FALSE_POSITIVE = "false_positive"


class AuditDecision(StrEnum):
    APPROVED = "approved"
    DENIED = "denied"
    FLAGGED = "flagged"


# ── Base config ──────────────────────────────────────────────


class _CerniqModel(BaseModel):
    """Base for all SDK models. Default to camelCase on the wire."""

    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=False,
        extra="ignore",
        str_strip_whitespace=False,
    )


# ── Policy scope ─────────────────────────────────────────────


class SpendLimit(_CerniqModel):
    """Spend cap on a policy scope. At least one ``max_*`` field must be set."""

    currency: Currency
    max_per_transaction: float | None = None
    max_per_day: float | None = None
    max_per_month: float | None = None


class PolicyScope(_CerniqModel):
    """A single grant inside a policy. Multiple scopes can stack."""

    category: PolicyCategory
    spend_limit: SpendLimit | None = None
    merchant_categories: list[str] | None = None
    allowed_domains: list[str] | None = None
    data_scopes: list[str] | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None


# ── Identity ─────────────────────────────────────────────────


class AgentRegistrationRequest(_CerniqModel):
    public_key: str
    runtime: AgentRuntime
    principal_id: str
    model: str | None = None
    label: str | None = None


class AgentRegistrationResponse(_CerniqModel):
    agent_id: str
    verification_token: str
    trust_score: int
    registered_at: datetime


class AgentRecord(_CerniqModel):
    """Full agent identity record. Returned by ``agents.get`` / ``agents.register``."""

    agent_id: str
    public_key: str
    principal_id: str
    runtime: AgentRuntime
    model: str | None = None
    label: str | None = None
    status: AgentStatus
    trust_score: int
    trust_band: TrustBand
    registered_at: datetime
    last_seen_at: datetime | None = None


class AgentStatusResponse(_CerniqModel):
    agent_id: str
    status: AgentStatus
    trust_score: int
    trust_band: TrustBand
    last_seen_at: datetime | None = None


# ── Policy ───────────────────────────────────────────────────


class PolicyCreateRequest(_CerniqModel):
    scopes: list[PolicyScope] = Field(min_length=1, max_length=10)
    expires_at: datetime
    label: str | None = None


class PolicyRecord(_CerniqModel):
    """Policy as returned from ``policies.create``."""

    policy_id: str
    signed_token: str
    expires_at: datetime


class AgentPolicy(_CerniqModel):
    """Listed policy entry (no signed token — that's only returned at create-time)."""

    policy_id: str
    agent_id: str
    scopes: list[PolicyScope]
    status: PolicyStatus
    created_at: datetime
    expires_at: datetime
    label: str | None = None


# ── Verify ───────────────────────────────────────────────────


class VerifyRequest(_CerniqModel):
    token: str
    action: str | None = None
    amount: float | None = None
    currency: Currency | None = None
    merchant_id: str | None = None
    merchant_domain: str | None = None
    min_trust_score: int | None = None
    context: dict[str, Any] | None = None


class VerifySpendRemaining(_CerniqModel):
    today: float | None = None
    this_month: float | None = None


class VerifyResult(_CerniqModel):
    """Result of ``cerniq.verify(...)``. ``valid=False`` paired with ``denial_reason``."""

    valid: bool
    agent_id: str | None
    principal_id: str | None
    trust_score: int
    trust_band: TrustBand | None
    scopes_granted: list[str]
    spend_remaining: VerifySpendRemaining | None = None
    denial_reason: DenialReason | None
    verified_at: datetime
    ttl: int
    audit_event_id: str | None = None


# ── Audit ────────────────────────────────────────────────────


class AuditEvent(_CerniqModel):
    event_id: str
    agent_id: str
    principal_id: str
    timestamp: datetime
    action: str
    relying_party: str | None = None
    decision: AuditDecision
    decision_reason: str | None = None
    trust_score_at_event: int
    signature: str


class AuditLogResponse(_CerniqModel):
    events: list[AuditEvent]
    next_cursor: str | None = None
    total: int


# ── Reporting ────────────────────────────────────────────────


class ReportRequest(_CerniqModel):
    event_type: ReportEventType
    severity: SignalSeverity = SignalSeverity.MEDIUM
    description: str | None = None
    transaction_id: str | None = None
    evidence: dict[str, Any] | None = None


class ReportAccepted(_CerniqModel):
    accepted: bool = True


__all__ = [
    "AgentPolicy",
    "AgentRecord",
    "AgentRegistrationRequest",
    "AgentRegistrationResponse",
    "AgentRuntime",
    "AgentStatus",
    "AgentStatusResponse",
    "AuditDecision",
    "AuditEvent",
    "AuditLogResponse",
    "Currency",
    "DenialReason",
    "PolicyCategory",
    "PolicyCreateRequest",
    "PolicyRecord",
    "PolicyScope",
    "PolicyStatus",
    "ReportAccepted",
    "ReportEventType",
    "ReportRequest",
    "SignalSeverity",
    "SpendLimit",
    "TrustBand",
    "VerifyRequest",
    "VerifyResult",
    "VerifySpendRemaining",
]
