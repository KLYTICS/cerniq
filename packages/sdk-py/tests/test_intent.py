"""Tests for IntentClient (issue / reconcile / get).

Mirrors the TS suite in ``packages/sdk-ts/tests/intent.test.ts`` and the
ADR-0017 ``/v1/intent`` surface. The Python SDK accepts plain dicts in
v1; once ``IntentClaim`` / ``ActualCallObservation`` ship as pydantic
models, these tests should be augmented (not replaced) with typed shapes.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from aegis import AsyncAegis, IntentClient


@pytest.fixture
def sample_intent_issue_response() -> dict[str, Any]:
    """Server-shaped (camelCase) issue response fixture."""
    return {
        "manifestId": "imf_01HZ9YZXM4QT3B7P8WKJD6R5V",
        "signedManifest": {
            "manifest": {
                "manifestId": "imf_01HZ9YZXM4QT3B7P8WKJD6R5V",
                "agentId": "agt_01HZ9YZXM4QT3B7P8WKJD6R5V",
                "verifyTokenJti": "01HZ9YZXM4QT3B7P8WKJD6R5V",
                "verifyTokenSha256B64Url": "abc-example-sha256",
                "intent": {
                    "kind": "commerce-action",
                    "action": "stripe.charge",
                    "maxCalls": 1,
                    "merchantId": "merch_acme",
                    "amountCap": {"amount": "25.00", "currency": "USD"},
                },
                "reconciliation": {"strictness": "strict"},
                "issuedAt": 1_715_000_000,
                "expiresAt": 1_715_000_060,
            },
            "signature": "example-ed25519-signature-base64url",
            "kid": "aegis-2026-05",
        },
        "expiresAt": 1_715_000_060,
    }


@pytest.fixture
def sample_reconcile_response() -> dict[str, Any]:
    return {
        "manifestId": "imf_01HZ9YZXM4QT3B7P8WKJD6R5V",
        "outcome": "matched",
        "matches": [
            {
                "actualIndex": 0,
                "expectedCallIndex": 0,
                "deltas": {"amount": "-1.00"},
            }
        ],
        "violations": [],
        "recommendedDenialReason": None,
        "reconciledAt": 1_715_000_030,
    }


@pytest.fixture
def sample_get_response(
    sample_intent_issue_response: dict[str, Any],
    sample_reconcile_response: dict[str, Any],
) -> dict[str, Any]:
    return {
        "manifest": sample_intent_issue_response["signedManifest"],
        "actuals": [
            {
                "observedAt": 1_715_000_020,
                "kind": "commerce-action",
                "payload": {
                    "action": "stripe.charge",
                    "merchantId": "merch_acme",
                    "amount": "24.00",
                },
            }
        ],
        "reconciliation": sample_reconcile_response,
        "status": "RECONCILED",
    }


# ── issue ───────────────────────────────────────────────────────────


async def test_issue_posts_to_intent_endpoint_with_camel_case_body(
    aegis: AsyncAegis,
    respx_mock: Any,
    sample_intent_issue_response: dict[str, Any],
) -> None:
    route = respx_mock.post("/intent").respond(201, json=sample_intent_issue_response)

    issued = await aegis.intent.issue(
        agent_id="agt_01HZ9YZXM4QT3B7P8WKJD6R5V",
        verify_token_jti="01HZ9YZXM4QT3B7P8WKJD6R5V",
        verify_token_sha256_b64url="abc-example-sha256",
        intent={
            "kind": "commerce-action",
            "action": "stripe.charge",
            "maxCalls": 1,
            "merchantId": "merch_acme",
            "amountCap": {"amount": "25.00", "currency": "USD"},
        },
        reconciliation={"strictness": "strict"},
        ttl_seconds=45,
    )

    assert issued["manifestId"] == sample_intent_issue_response["manifestId"]
    assert issued["expiresAt"] == sample_intent_issue_response["expiresAt"]
    assert issued["signedManifest"]["kid"] == "aegis-2026-05"

    sent = route.calls.last.request
    body = json.loads(sent.content.decode())
    assert body["agentId"] == "agt_01HZ9YZXM4QT3B7P8WKJD6R5V"
    assert body["verifyTokenJti"] == "01HZ9YZXM4QT3B7P8WKJD6R5V"
    assert body["verifyTokenSha256B64Url"] == "abc-example-sha256"
    assert body["intent"]["kind"] == "commerce-action"
    assert body["intent"]["merchantId"] == "merch_acme"
    assert body["reconciliation"] == {"strictness": "strict"}
    assert body["ttlSeconds"] == 45


async def test_issue_omits_optional_fields_when_unset(
    aegis: AsyncAegis,
    respx_mock: Any,
    sample_intent_issue_response: dict[str, Any],
) -> None:
    route = respx_mock.post("/intent").respond(201, json=sample_intent_issue_response)
    await aegis.intent.issue(
        agent_id="agt_x",
        verify_token_jti="jti_x",
        verify_token_sha256_b64url="sha_x",
        intent={"kind": "http-call", "method": "POST", "urlPattern": "https://api.x/v1/*"},
    )
    body = json.loads(route.calls.last.request.content.decode())
    assert "reconciliation" not in body
    assert "ttlSeconds" not in body


async def test_issue_accepts_all_three_intent_kinds(
    aegis: AsyncAegis,
    respx_mock: Any,
    sample_intent_issue_response: dict[str, Any],
) -> None:
    """Smoke test: each discriminated-union variant round-trips into the body."""
    route = respx_mock.post("/intent").respond(201, json=sample_intent_issue_response)

    for intent in [
        {"kind": "http-call", "method": "GET", "urlPattern": "https://api.example/users/*"},
        {
            "kind": "commerce-action",
            "action": "stripe.charge",
            "maxCalls": 1,
            "merchantId": "m_x",
            "amountCap": {"amount": "5.00", "currency": "USD"},
        },
        {"kind": "tool-invocation", "tool": "send_email", "maxCalls": 1},
    ]:
        await aegis.intent.issue(
            agent_id="agt_x",
            verify_token_jti="jti_x",
            verify_token_sha256_b64url="sha_x",
            intent=intent,
        )
        body = json.loads(route.calls.last.request.content.decode())
        assert body["intent"]["kind"] == intent["kind"]


# ── reconcile ───────────────────────────────────────────────────────


async def test_reconcile_constructs_actuals_url_with_manifest_id_and_idempotency_header(
    aegis: AsyncAegis,
    respx_mock: Any,
    sample_reconcile_response: dict[str, Any],
) -> None:
    manifest_id = "imf_01HZ9YZXM4QT3B7P8WKJD6R5V"
    route = respx_mock.post(f"/intent/{manifest_id}/actuals").respond(
        200, json=sample_reconcile_response
    )

    result = await aegis.intent.reconcile(
        manifest_id,
        idempotency_key="recon-imf_x-001",
        actuals=[
            {
                "observedAt": 1_715_000_020,
                "kind": "commerce-action",
                "payload": {
                    "action": "stripe.charge",
                    "merchantId": "merch_acme",
                    "amount": "24.00",
                },
            }
        ],
    )

    assert result["outcome"] == "matched"
    assert result["recommendedDenialReason"] is None

    sent: httpx.Request = route.calls.last.request
    assert sent.headers["Idempotency-Key"] == "recon-imf_x-001"
    body = json.loads(sent.content.decode())
    # Reconcile body is just { actuals } — mirrors the TS SDK shape.
    assert list(body.keys()) == ["actuals"]
    assert body["actuals"][0]["kind"] == "commerce-action"
    assert body["actuals"][0]["payload"]["amount"] == "24.00"


async def test_reconcile_url_encodes_manifest_id(
    aegis: AsyncAegis,
    respx_mock: Any,
    sample_reconcile_response: dict[str, Any],
) -> None:
    """A weird id with reserved chars must be percent-encoded.

    Mirrors encodeURIComponent in the TS SDK. Defends against a future
    id-format change that introduces ``/``, ``?``, or ``#``.
    """
    weird_id = "imf/with?reserved#chars"
    encoded = "imf%2Fwith%3Freserved%23chars"
    route = respx_mock.post(f"/intent/{encoded}/actuals").respond(
        200, json=sample_reconcile_response
    )

    await aegis.intent.reconcile(
        weird_id,
        idempotency_key="k1",
        actuals=[],
    )
    assert route.called


async def test_reconcile_caller_cannot_override_reserved_headers(
    aegis: AsyncAegis,
    respx_mock: Any,
    api_key: str,
    sample_reconcile_response: dict[str, Any],
) -> None:
    """The reserved-headers guard in _http.py protects auth + content negotiation.

    IntentClient only sends ``Idempotency-Key`` via ``extra_headers``,
    so this test exercises the guard directly to prove it works for any
    future caller that tries to slip a reserved header through.
    """
    manifest_id = "imf_x"
    route = respx_mock.post(f"/intent/{manifest_id}/actuals").respond(
        200, json=sample_reconcile_response
    )

    # Call the underlying _http directly with an attempt to override
    # X-AEGIS-API-Key, Content-Type, and X-Request-Id. The guard must
    # drop all three.
    await aegis._http.request(
        "POST",
        f"/intent/{manifest_id}/actuals",
        body={"actuals": []},
        extra_headers={
            "Idempotency-Key": "k1",
            "X-AEGIS-API-Key": "aegis_sk_ATTACKER_OVERRIDE",
            "Content-Type": "text/plain",
            "X-Request-Id": "attacker-controlled-id",
        },
    )

    sent: httpx.Request = route.calls.last.request
    # Reserved headers preserved at HttpClient values.
    assert sent.headers["X-AEGIS-API-Key"] == api_key
    assert sent.headers["Content-Type"] == "application/json"
    assert sent.headers["X-Request-Id"] != "attacker-controlled-id"
    # Non-reserved header (Idempotency-Key) passed through.
    assert sent.headers["Idempotency-Key"] == "k1"


# ── get ─────────────────────────────────────────────────────────────


async def test_get_constructs_url_and_returns_manifest_snapshot(
    aegis: AsyncAegis,
    respx_mock: Any,
    sample_get_response: dict[str, Any],
) -> None:
    manifest_id = "imf_01HZ9YZXM4QT3B7P8WKJD6R5V"
    respx_mock.get(f"/intent/{manifest_id}").respond(200, json=sample_get_response)

    snapshot = await aegis.intent.get(manifest_id)
    assert snapshot is not None
    assert snapshot["status"] == "RECONCILED"
    assert len(snapshot["actuals"]) == 1
    assert snapshot["reconciliation"]["outcome"] == "matched"


async def test_get_returns_none_on_404(
    aegis: AsyncAegis,
    respx_mock: Any,
) -> None:
    manifest_id = "imf_unknown"
    respx_mock.get(f"/intent/{manifest_id}").respond(
        404,
        json={
            "error": "NOT_FOUND",
            "message": "Intent manifest not found.",
            "statusCode": 404,
        },
    )

    snapshot = await aegis.intent.get(manifest_id)
    assert snapshot is None


async def test_get_url_encodes_manifest_id(
    aegis: AsyncAegis,
    respx_mock: Any,
    sample_get_response: dict[str, Any],
) -> None:
    weird_id = "imf/with?reserved#chars"
    encoded = "imf%2Fwith%3Freserved%23chars"
    respx_mock.get(f"/intent/{encoded}").respond(200, json=sample_get_response)
    snapshot = await aegis.intent.get(weird_id)
    assert snapshot is not None


# ── composition / surface ───────────────────────────────────────────


async def test_intent_client_attached_to_aegis(aegis: AsyncAegis) -> None:
    """The composition root exposes ``aegis.intent`` (mirrors aegis.agents)."""
    assert isinstance(aegis.intent, IntentClient)
