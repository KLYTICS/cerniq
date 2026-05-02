"""Tests for the relying-party verify() endpoint."""

from __future__ import annotations

import json
from typing import Any

import pytest

from aegis import (
    AsyncAegis,
    DenialReason,
    TrustBand,
    VerifyResult,
)


async def test_verify_happy_path(
    aegis: AsyncAegis,
    respx_mock: Any,
    sample_verify_response: dict[str, Any],
    verify_key: str,
) -> None:
    route = respx_mock.post("/verify").respond(200, json=sample_verify_response)
    res = await aegis.verify(
        "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.example.signature",
        action="commerce.purchase",
        amount=347.0,
        currency="USD",
        merchant_domain="delta.com",
    )
    assert isinstance(res, VerifyResult)
    assert res.valid is True
    assert res.trust_band == TrustBand.VERIFIED
    assert res.denial_reason is None
    assert res.spend_remaining is not None
    assert res.spend_remaining.this_month == 49_653.0

    req = route.calls.last.request
    assert req.headers["X-AEGIS-Verify-Key"] == verify_key
    assert "X-AEGIS-API-Key" not in req.headers
    body = json.loads(req.content.decode())
    assert body["token"].startswith("eyJ")
    assert body["action"] == "commerce.purchase"
    assert body["merchantDomain"] == "delta.com"


@pytest.mark.parametrize(
    "denial_reason",
    [
        DenialReason.AGENT_NOT_FOUND,
        DenialReason.AGENT_REVOKED,
        DenialReason.INVALID_SIGNATURE,
        DenialReason.POLICY_REVOKED,
        DenialReason.POLICY_EXPIRED,
        DenialReason.SCOPE_NOT_GRANTED,
        DenialReason.SPEND_LIMIT_EXCEEDED,
        DenialReason.TRUST_SCORE_TOO_LOW,
        DenialReason.ANOMALY_FLAGGED,
    ],
)
async def test_verify_returns_each_denial_reason(
    aegis: AsyncAegis, respx_mock: Any, denial_reason: DenialReason
) -> None:
    body = {
        "valid": False,
        "agentId": None,
        "principalId": None,
        "trustScore": 0,
        "trustBand": None,
        "scopesGranted": [],
        "spendRemaining": None,
        "denialReason": denial_reason.value,
        "verifiedAt": "2026-05-01T12:00:00+00:00",
        "ttl": 0,
        "auditEventId": None,
    }
    respx_mock.post("/verify").respond(200, json=body)
    res = await aegis.verify("eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.x.y")
    assert res.valid is False
    assert res.denial_reason == denial_reason
    assert res.trust_band is None
    assert res.scopes_granted == []


async def test_verify_requires_verify_key(api_key: str, base_url: str) -> None:
    """If only api_key is set, verify() must complain — not silently send the management key."""
    from aegis import AegisError

    async with AsyncAegis(api_key=api_key, base_url=base_url) as a:
        with pytest.raises(AegisError):
            await a.verify("eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.x.y")
