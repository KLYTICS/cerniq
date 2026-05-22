"""Typed error hierarchy for the OKORO SDK.

Mirrors ``packages/sdk-ts/src/errors.ts``. Consumers can ``except OkoroError``
to catch every failure originating from the SDK.
"""

from __future__ import annotations

from typing import Any


class OkoroError(Exception):
    """Base class for every error raised by the SDK.

    Attributes:
        message: Human-readable description.
        status_code: HTTP status code (or ``0`` for transport errors).
        request_id: Server-supplied request id, if any. Useful for support.
        code: Machine-readable code (e.g. ``"AUTH_REQUIRED"``).
        details: Server-supplied details payload, if any.
    """

    code: str = "OKORO_ERROR"

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 0,
        request_id: str | None = None,
        code: str | None = None,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.request_id = request_id
        if code is not None:
            self.code = code
        self.details = details

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        rid = f" request_id={self.request_id!r}" if self.request_id else ""
        return f"{type(self).__name__}({self.message!r}, status={self.status_code}{rid})"


class ValidationError(OkoroError):
    """Server rejected the request (HTTP 400)."""

    code = "INVALID_REQUEST"


class AuthError(OkoroError):
    """Authentication or authorization failed (HTTP 401 / 403)."""

    code = "AUTH_REQUIRED"


class NotFoundError(OkoroError):
    """Resource not found (HTTP 404)."""

    code = "NOT_FOUND"


class ConflictError(OkoroError):
    """Conflict — typically duplicate resource or idempotency clash (HTTP 409)."""

    code = "CONFLICT"


class RateLimitedError(OkoroError):
    """Rate limit exceeded (HTTP 429)."""

    code = "RATE_LIMITED"


class ServerError(OkoroError):
    """Server-side failure (HTTP 5xx)."""

    code = "INTERNAL"


class NetworkError(OkoroError):
    """Connection / transport error (no HTTP response received)."""

    code = "NETWORK_ERROR"


def from_status(
    status_code: int,
    *,
    message: str,
    request_id: str | None,
    code: str | None,
    details: Any,
) -> OkoroError:
    """Map an HTTP status code to the right ``OkoroError`` subclass."""
    cls: type[OkoroError]
    if status_code == 400:
        cls = ValidationError
    elif status_code in (401, 403):
        cls = AuthError
    elif status_code == 404:
        cls = NotFoundError
    elif status_code == 409:
        cls = ConflictError
    elif status_code == 429:
        cls = RateLimitedError
    elif 500 <= status_code < 600:
        cls = ServerError
    else:
        cls = OkoroError
    return cls(
        message,
        status_code=status_code,
        request_id=request_id,
        code=code,
        details=details,
    )


__all__ = [
    "OkoroError",
    "AuthError",
    "ConflictError",
    "NetworkError",
    "NotFoundError",
    "RateLimitedError",
    "ServerError",
    "ValidationError",
    "from_status",
]
