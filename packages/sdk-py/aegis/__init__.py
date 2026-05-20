"""AEGIS Python SDK — neutral identity & verification layer for AI agents.

Public surface:

- :class:`AsyncAegis` — primary async client
- :class:`Aegis` — sync wrapper (uses ``asyncio.run`` per call)
- :func:`generate_keypair` / :func:`sign_agent_token` / :func:`decode_unsafe`
  / :func:`verify_agent_token` — local crypto helpers
- :class:`AegisError` and the typed subtree (:class:`ValidationError`,
  :class:`AuthError`, :class:`NotFoundError`, :class:`RateLimitedError`,
  :class:`ServerError`, :class:`NetworkError`, :class:`ConflictError`)
- All wire models (:class:`AgentRecord`, :class:`PolicyRecord`,
  :class:`VerifyResult`, …) and enums (:class:`TrustBand`,
  :class:`DenialReason`, …)
"""

from __future__ import annotations

from ._version import __version__
from .client import Aegis, AsyncAegis
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
    AegisError,
    AuthError,
    ConflictError,
    NetworkError,
    NotFoundError,
    RateLimitedError,
    ServerError,
    ValidationError,
)
from .key_storage import (
    KeyStorage,
    KmsKeyStorage,
    StoredKey,
    default_key_storage,
    file_system_key_storage,
    memory_key_storage,
)
from .quickstart import QuickstartBundle, quickstart
from .runtime import (
    PythonRuntime,
    RuntimeCapabilities,
    capabilities,
    detect_runtime,
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
    "Aegis",
    "AegisError",
    "AgentPolicy",
    "AgentRecord",
    "AgentRegistrationRequest",
    "AgentRegistrationResponse",
    "AgentRuntime",
    "AgentStatus",
    "AgentStatusResponse",
    "AsyncAegis",
    "AuditDecision",
    "AuditEvent",
    "AuditLogResponse",
    "AuthError",
    "ConflictError",
    "Currency",
    "DenialReason",
    "KeyStorage",
    "Keypair",
    "KmsKeyStorage",
    "NetworkError",
    "NotFoundError",
    "PolicyCategory",
    "PolicyCreateRequest",
    "PolicyRecord",
    "PolicyScope",
    "PolicyStatus",
    "PythonRuntime",
    "QuickstartBundle",
    "RateLimitedError",
    "RuntimeCapabilities",
    "ReportAccepted",
    "ReportEventType",
    "ReportRequest",
    "ServerError",
    "SignContext",
    "SignalSeverity",
    "SpendLimit",
    "StoredKey",
    "TrustBand",
    "ValidationError",
    "VerifyRequest",
    "VerifyResult",
    "VerifySpendRemaining",
    "__version__",
    "b64u_decode",
    "b64u_encode",
    "capabilities",
    "decode_unsafe",
    "default_key_storage",
    "detect_runtime",
    "file_system_key_storage",
    "generate_keypair",
    "memory_key_storage",
    "quickstart",
    "sign_agent_token",
    "verify_agent_token",
]
