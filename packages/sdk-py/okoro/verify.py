"""Relying-party ``verify()`` implementation. Single-call wrapper around
``POST /v1/verify`` that produces a typed :class:`VerifyResult`.
"""

from __future__ import annotations

from typing import Any

from ._http import HttpClient
from .models import Currency, VerifyRequest, VerifyResult


class VerifyClient:
    """Async surface for the relying-party ``/verify`` endpoint."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    async def __call__(
        self,
        token: str,
        *,
        action: str | None = None,
        amount: float | None = None,
        currency: Currency | str | None = None,
        merchant_id: str | None = None,
        merchant_domain: str | None = None,
        min_trust_score: int | None = None,
        context: dict[str, Any] | None = None,
    ) -> VerifyResult:
        """Verify a token presented by an agent.

        Returns ``valid=False`` with a populated ``denial_reason`` for known
        bad tokens (revoked agent, expired policy, etc.). Network errors and
        bad configurations raise.

        Use the verify-only API key (``verify_key=``) — the management key
        has too much power for a relying-party deployment.
        """
        req = VerifyRequest.model_validate(
            {
                "token": token,
                "action": action,
                "amount": amount,
                "currency": currency,
                "merchantId": merchant_id,
                "merchantDomain": merchant_domain,
                "minTrustScore": min_trust_score,
                "context": context,
            }
        )
        body = req.model_dump(by_alias=True, exclude_none=True, mode="json")
        data = await self._http.request("POST", "/verify", body=body, verify_only=True)
        return VerifyResult.model_validate(data)
