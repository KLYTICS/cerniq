"""Sanity check: sync facade returns equivalent results to the async surface."""

from __future__ import annotations

from typing import Any

import respx

from aegis import Aegis, AsyncAegis


def test_sync_agents_get_matches_async(
    api_key: str, base_url: str, sample_agent_record: dict[str, Any]
) -> None:
    with respx.mock(base_url=base_url, assert_all_called=False) as router:
        router.get("/agents/agt_x").respond(200, json=sample_agent_record)
        with Aegis(api_key=api_key, base_url=base_url) as sync_client:
            sync_agent = sync_client.agents.get("agt_x")

    assert sync_agent.agent_id == sample_agent_record["agentId"]
    assert sync_agent.trust_band == sample_agent_record["trustBand"]


def test_sync_and_async_produce_same_dump(
    api_key: str, base_url: str, sample_agent_record: dict[str, Any]
) -> None:
    """Compare model_dump of sync vs. async surfaces side-by-side.

    We must NOT use ``async def`` here — pytest-asyncio would put us inside
    a running loop, and the sync facade calls ``asyncio.run()``. Driving the
    async path from a sync test through ``asyncio.new_event_loop`` keeps both
    surfaces in their natural shape.
    """
    import asyncio as _asyncio

    sync_dump: dict[str, Any]
    async_dump: dict[str, Any]

    with respx.mock(base_url=base_url, assert_all_called=False) as router:
        router.get("/agents/agt_x").respond(200, json=sample_agent_record)
        with Aegis(api_key=api_key, base_url=base_url) as sync_client:
            sync_dump = sync_client.agents.get("agt_x").model_dump(by_alias=True, mode="json")

    async def _async_path() -> dict[str, Any]:
        async with respx.mock(base_url=base_url, assert_all_called=False) as router:
            router.get("/agents/agt_x").respond(200, json=sample_agent_record)
            async with AsyncAegis(api_key=api_key, base_url=base_url) as async_client:
                rec = await async_client.agents.get("agt_x")
                return rec.model_dump(by_alias=True, mode="json")

    async_dump = _asyncio.new_event_loop().run_until_complete(_async_path())
    assert sync_dump == async_dump


def test_sync_verify(api_key: str, verify_key: str, base_url: str) -> None:
    body = {
        "valid": True,
        "agentId": "agt_x",
        "principalId": "principal_acme",
        "trustScore": 612,
        "trustBand": "VERIFIED",
        "scopesGranted": ["commerce"],
        "spendRemaining": None,
        "denialReason": None,
        "verifiedAt": "2026-05-01T12:00:00+00:00",
        "ttl": 30,
        "auditEventId": None,
    }
    with respx.mock(base_url=base_url, assert_all_called=False) as router:
        router.post("/verify").respond(200, json=body)
        with Aegis(
            api_key=api_key, verify_key=verify_key, base_url=base_url
        ) as client:
            res = client.verify("eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.x.y", action="commerce.purchase")
    assert res.valid is True
    assert res.trust_band == "VERIFIED"
