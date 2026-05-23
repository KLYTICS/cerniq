"""Configuration tests — base_url, timeout, headers, user-agent."""

from __future__ import annotations

from typing import Any

import respx

from cerniq import AsyncCerniq


async def test_base_url_override(api_key: str) -> None:
    custom = "https://sandbox.cerniqapp.com/v1"
    async with (
        respx.mock(base_url=custom, assert_all_called=False) as router,
        AsyncCerniq(api_key=api_key, base_url=custom) as a,
    ):
        router.get("/agents/agt_x/status").respond(
            200,
            json={
                "agentId": "agt_x",
                "status": "active",
                "trustScore": 500,
                "trustBand": "VERIFIED",
            },
        )
        status = await a.agents.status("agt_x")
        assert status.agent_id == "agt_x"


async def test_user_agent_default(
    api_key: str,
    base_url: str,
    sample_agent_record: dict[str, Any],
) -> None:
    async with (
        respx.mock(base_url=base_url, assert_all_called=False) as router,
        AsyncCerniq(api_key=api_key, base_url=base_url) as a,
    ):
        route = router.get("/agents/agt_x").respond(200, json=sample_agent_record)
        await a.agents.get("agt_x")
        ua = route.calls.last.request.headers["User-Agent"]
        assert ua.startswith("cerniq-python/")


async def test_user_agent_override(
    api_key: str, base_url: str, sample_agent_record: dict[str, Any]
) -> None:
    async with (
        respx.mock(base_url=base_url, assert_all_called=False) as router,
        AsyncCerniq(api_key=api_key, base_url=base_url, user_agent="my-app/1.2.3") as a,
    ):
        route = router.get("/agents/agt_x").respond(200, json=sample_agent_record)
        await a.agents.get("agt_x")
        assert route.calls.last.request.headers["User-Agent"] == "my-app/1.2.3"


async def test_request_id_header_is_per_request(
    api_key: str, base_url: str, sample_agent_record: dict[str, Any]
) -> None:
    async with (
        respx.mock(base_url=base_url, assert_all_called=False) as router,
        AsyncCerniq(api_key=api_key, base_url=base_url) as a,
    ):
        route = router.get("/agents/agt_x").respond(200, json=sample_agent_record)
        await a.agents.get("agt_x")
        await a.agents.get("agt_x")
        ids = {call.request.headers["X-Request-Id"] for call in route.calls}
        assert len(ids) == 2  # different per request
        for rid in ids:
            assert len(rid) == 32  # uuid4 hex


async def test_base_url_trailing_slash_normalized(
    api_key: str, sample_agent_record: dict[str, Any]
) -> None:
    base_with_slash = "https://api.cerniqapp.com/v1/"
    base_clean = base_with_slash.rstrip("/")
    async with (
        respx.mock(base_url=base_clean, assert_all_called=False) as router,
        AsyncCerniq(api_key=api_key, base_url=base_with_slash) as a,
    ):
        router.get("/agents/agt_x").respond(200, json=sample_agent_record)
        agent = await a.agents.get("agt_x")
        assert agent.agent_id == sample_agent_record["agentId"]
