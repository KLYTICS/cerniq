"""OKORO Python SDK — neutral identity & verification layer for AI agents.

Public surface:

- :class:`AsyncOkoro` — primary async client
- :class:`Okoro` — sync wrapper (uses ``asyncio.run`` per call)
- :func:`generate_keypair` / :func:`sign_agent_token` / :func:`decode_unsafe`
  / :func:`verify_agent_token` — local crypto helpers
- :class:`OkoroError` and the typed subtree (:class:`ValidationError`,
  :class:`AuthError`, :class:`NotFoundError`, :class:`RateLimitedError`,
  :class:`ServerError`, :class:`NetworkError`, :class:`ConflictError`)
- All wire models (:class:`AgentRecord`, :class:`PolicyRecord`,
  :class:`VerifyResult`, …) and enums (:class:`TrustBand`,
  :class:`DenialReason`, …)
"""

from __future__ import annotations

from ._version import __version__
from .client import Okoro, AsyncOkoro
from .crypto import (
    Keypair,
    SignContext,
    b64u_decode,
    b64u_encode,
    decode_unsafe,
    generate_keypair,
    sign_agent_token,
    verify_agent_token,
)
from .errors import (
    OkoroError,
    AuthError,
    ConflictError,
    NetworkError,
    NotFoundError,
    RateLimitedError,
    ServerError,
    ValidationError,
)
from .models import (
    AgentPolicy,
    AgentRecord,
    AgentRegistrationRequest,
    AgentRegistrationResponse,
    AgentRuntime,
    AgentStatus,
    AgentStatusResponse,
    AuditDecision,
    AuditEvent,
    AuditLogResponse,
    Currency,
    DenialReason,
    PolicyCategory,
    PolicyCreateRequest,
    PolicyRecord,
    PolicyScope,
    PolicyStatus,
    ReportAccepted,
    ReportEventType,
    ReportRequest,
    SignalSeverity,
    SpendLimit,
    TrustBand,
    VerifyRequest,
    VerifyResult,
    VerifySpendRemaining,
)

__all__ = [
    "Okoro",
    "OkoroError",
    "AgentPolicy",
    "AgentRecord",
    "AgentRegistrationRequest",
    "AgentRegistrationResponse",
    "AgentRuntime",
    "AgentStatus",
    "AgentStatusResponse",
    "AsyncOkoro",
    "AuditDecision",
    "AuditEvent",
    "AuditLogResponse",
    "AuthError",
    "ConflictError",
    "Currency",
    "DenialReason",
    "Keypair",
    "NetworkError",
    "NotFoundError",
    "PolicyCategory",
    "PolicyCreateRequest",
    "PolicyRecord",
    "PolicyScope",
    "PolicyStatus",
    "RateLimitedError",
    "ReportAccepted",
    "ReportEventType",
    "ReportRequest",
    "ServerError",
    "SignContext",
    "SignalSeverity",
    "SpendLimit",
    "TrustBand",
    "ValidationError",
    "VerifyRequest",
    "VerifyResult",
    "VerifySpendRemaining",
    "__version__",
    "b64u_decode",
    "b64u_encode",
    "decode_unsafe",
    "generate_keypair",
    "sign_agent_token",
    "verify_agent_token",
]
