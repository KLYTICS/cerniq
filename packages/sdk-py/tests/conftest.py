"""Shared pytest fixtures for the OKORO Python SDK."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
import respx

from okoro import AsyncOkoro, Keypair, generate_keypair

BASE_URL = "https://api.okorolabs.io/v1"


@pytest.fixture
def keypair() -> Keypair:
    """Fresh Ed25519 keypair (base64url)."""
    return generate_keypair()


@pytest.fixture
def api_key() -> str:
    return "okoro_sk_test_0123456789abcdef"


@pytest.fixture
def verify_key() -> str:
    return "okoro_vk_test_0123456789abcdef"


@pytest.fixture
def base_url() -> str:
    return BASE_URL


@pytest_asyncio.fixture
async def okoro(api_key: str, verify_key: str, base_url: str) -> AsyncIterator[AsyncOkoro]:
    """An AsyncOkoro client wired against the mocked base URL."""
    async with AsyncOkoro(
        api_key=api_key,
        verify_key=verify_key,
        base_url=base_url,
        timeout_ms=2_000,
        max_retries=0,  # default for most tests; override per-test for retry suites
    ) as client:
        yield client


@pytest.fixture
def respx_mock() -> Any:
    """Yields a respx router. Use as `respx_mock.post(...).respond(...)`."""
    with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
        yield router


@pytest.fixture
def sample_agent_record() -> dict[str, Any]:
    """Server-shaped (camelCase) agent record fixture."""
    return {
        "agentId": "agt_01HZ9YZXM4QT3B7P8WKJD6R5V",
        "publicKey": "MCowBQYDK2VwAyEA-example-public-key-base64url-value",
        "principalId": "principal_acme",
        "runtime": "anthropic",
        "model": "claude-sonnet-4-5",
        "label": "checkout-bot",
        "status": "active",
        "trustScore": 612,
        "trustBand": "VERIFIED",
        "registeredAt": "2026-05-01T12:00:00+00:00",
        "lastSeenAt": None,
    }


@pytest.fixture
def sample_policy_record() -> dict[str, Any]:
    return {
        "policyId": "pol_01HZ9YZXM4QT3B7P8WKJD6R5V",
        "signedToken": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.example.signature",
        "expiresAt": "2026-06-01T00:00:00+00:00",
    }


@pytest.fixture
def sample_verify_response() -> dict[str, Any]:
    return {
        "valid": True,
        "agentId": "agt_01HZ9YZXM4QT3B7P8WKJD6R5V",
        "principalId": "principal_acme",
        "trustScore": 612,
        "trustBand": "VERIFIED",
        "scopesGranted": ["commerce", "commerce.purchase"],
        "spendRemaining": {"today": 9_653.0, "thisMonth": 49_653.0},
        "denialReason": None,
        "verifiedAt": "2026-05-01T12:00:00+00:00",
        "ttl": 30,
        "auditEventId": "evt_01HZ9YZXM4QT3B7P8WKJD6R5V",
    }
