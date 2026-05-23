"""Tests for AgentsClient (register / get / revoke / status / audit / report)."""

from __future__ import annotations

import json
from typing import Any

import httpx

from cerniq import AgentRecord, AsyncCerniq, AuditLogResponse


async def test_register_sends_camel_case_body_and_returns_typed_record(
    cerniq: AsyncCerniq,
    respx_mock: Any,
    sample_agent_record: dict[str, Any],
) -> None:
    route = respx_mock.post("/agents/register").respond(201, json=sample_agent_record)
    agent = await cerniq.agents.register(
        public_key="MCowBQYDK2VwAyEA-example-public-key-base64url-value",
        runtime="anthropic",
        principal_id="principal_acme",
        model="claude-sonnet-4-5",
        label="checkout-bot",
    )

    assert isinstance(agent, AgentRecord)
    assert agent.agent_id == sample_agent_record["agentId"]
    assert agent.trust_score == sample_agent_record["trustScore"]

    sent = route.calls.last.request
    body = json.loads(sent.content.decode())
    assert body["publicKey"].startswith("MCowBQYDK2VwAyEA")
    assert body["principalId"] == "principal_acme"
    assert body["runtime"] == "anthropic"
    assert body["model"] == "claude-sonnet-4-5"
    assert body["label"] == "checkout-bot"


async def test_register_omits_optional_fields(
    cerniq: AsyncCerniq,
    respx_mock: Any,
    sample_agent_record: dict[str, Any],
) -> None:
    route = respx_mock.post("/agents/register").respond(201, json=sample_agent_record)
    await cerniq.agents.register(
        public_key="MCowBQYDK2VwAyEA-example-public-key-base64url-value",
        runtime="custom",
        principal_id="principal_acme",
    )
    body = json.loads(route.calls.last.request.content.decode())
    assert "model" not in body
    assert "label" not in body


async def test_get_agent(
    cerniq: AsyncCerniq,
    respx_mock: Any,
    sample_agent_record: dict[str, Any],
) -> None:
    respx_mock.get("/agents/agt_01HZ9YZXM4QT3B7P8WKJD6R5V").respond(
        200, json=sample_agent_record
    )
    agent = await cerniq.agents.get("agt_01HZ9YZXM4QT3B7P8WKJD6R5V")
    assert agent.agent_id == sample_agent_record["agentId"]


async def test_revoke_agent_returns_none(cerniq: AsyncCerniq, respx_mock: Any) -> None:
    route = respx_mock.delete("/agents/agt_x").respond(204)
    res = await cerniq.agents.revoke("agt_x")
    assert res is None
    assert route.called


async def test_status(
    cerniq: AsyncCerniq,
    respx_mock: Any,
) -> None:
    respx_mock.get("/agents/agt_x/status").respond(
        200,
        json={
            "agentId": "agt_x",
            "status": "active",
            "trustScore": 612,
            "trustBand": "VERIFIED",
            "lastSeenAt": "2026-05-01T12:00:00+00:00",
        },
    )
    status = await cerniq.agents.status("agt_x")
    assert status.agent_id == "agt_x"
    assert status.trust_band == "VERIFIED"


async def test_audit_passes_query_params(cerniq: AsyncCerniq, respx_mock: Any) -> None:
    body = {"events": [], "nextCursor": None, "total": 0}
    route = respx_mock.get("/agents/agt_x/audit").respond(200, json=body)
    res = await cerniq.agents.audit(
        "agt_x", from_="2026-04-01T00:00:00Z", to="2026-05-01T00:00:00Z", limit=50
    )
    assert isinstance(res, AuditLogResponse)
    sent = route.calls.last.request
    assert sent.url.params["from"] == "2026-04-01T00:00:00Z"
    assert sent.url.params["to"] == "2026-05-01T00:00:00Z"
    assert sent.url.params["limit"] == "50"
    assert "cursor" not in sent.url.params  # None-valued params dropped


async def test_report(cerniq: AsyncCerniq, respx_mock: Any) -> None:
    route = respx_mock.post("/agents/agt_x/report").respond(202, json={"accepted": True})
    res = await cerniq.agents.report(
        "agt_x",
        event_type="anomaly",
        severity="high",
        description="example anomaly",
        transaction_id="txn_example_01",
        evidence={"ip": "203.0.113.7"},
    )
    assert res.accepted is True
    body = json.loads(route.calls.last.request.content.decode())
    assert body["eventType"] == "anomaly"
    assert body["severity"] == "high"
    assert body["transactionId"] == "txn_example_01"
    assert body["evidence"] == {"ip": "203.0.113.7"}


async def test_request_sets_required_headers(
    cerniq: AsyncCerniq,
    respx_mock: Any,
    sample_agent_record: dict[str, Any],
    api_key: str,
) -> None:
    route = respx_mock.get("/agents/agt_x").respond(200, json=sample_agent_record)
    await cerniq.agents.get("agt_x")

    req: httpx.Request = route.calls.last.request
    assert req.headers["X-CERNIQ-API-Key"] == api_key
    assert req.headers["User-Agent"].startswith("cerniq-python/")
    assert req.headers["X-Request-Id"]
    assert "X-CERNIQ-Verify-Key" not in req.headers
