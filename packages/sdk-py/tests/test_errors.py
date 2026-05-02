"""Status-code → typed-exception mapping tests."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from aegis import (
    AegisError,
    AsyncAegis,
    AuthError,
    ConflictError,
    NetworkError,
    NotFoundError,
    RateLimitedError,
    ServerError,
    ValidationError,
)
from aegis.errors import from_status


def _envelope(status: int, code: str = "INTERNAL", message: str = "boom") -> dict[str, Any]:
    return {
        "error": code,
        "message": message,
        "statusCode": status,
        "requestId": "req_test_01",
    }


@pytest.mark.parametrize(
    ("status", "exc_type"),
    [
        (400, ValidationError),
        (401, AuthError),
        (403, AuthError),
        (404, NotFoundError),
        (409, ConflictError),
        (429, RateLimitedError),
        (500, ServerError),
        (502, ServerError),
        (503, ServerError),
        (599, ServerError),
    ],
)
def test_from_status_maps_correctly(status: int, exc_type: type[AegisError]) -> None:
    err = from_status(
        status,
        message="m",
        request_id="rid",
        code="C",
        details={"x": 1},
    )
    assert isinstance(err, exc_type)
    assert err.status_code == status
    assert err.request_id == "rid"
    assert err.code == "C"
    assert err.details == {"x": 1}


@pytest.mark.parametrize(
    ("status", "exc_type"),
    [
        (400, ValidationError),
        (401, AuthError),
        (404, NotFoundError),
        (409, ConflictError),
        (429, RateLimitedError),
        (500, ServerError),
        (503, ServerError),
    ],
)
async def test_http_errors_propagate_typed(
    aegis: AsyncAegis,
    respx_mock: Any,
    status: int,
    exc_type: type[AegisError],
) -> None:
    respx_mock.get("/agents/agt_x").respond(status, json=_envelope(status, message=f"e{status}"))
    with pytest.raises(exc_type) as ei:
        await aegis.agents.get("agt_x")
    assert ei.value.status_code == status
    assert ei.value.message == f"e{status}"
    assert ei.value.request_id == "req_test_01"


async def test_network_error_on_connect_failure(
    api_key: str, base_url: str
) -> None:
    """A connect error after retries are exhausted surfaces as NetworkError."""
    import respx as _respx

    async with AsyncAegis(
        api_key=api_key, base_url=base_url, max_retries=0, timeout_ms=500
    ) as a:
        with _respx.mock(base_url=base_url, assert_all_called=False) as router:
            router.get("/agents/agt_x").mock(
                side_effect=httpx.ConnectError("conn refused")
            )
            with pytest.raises(NetworkError):
                await a.agents.get("agt_x")


async def test_5xx_is_retried_until_success(
    api_key: str, base_url: str, sample_agent_record: dict[str, Any]
) -> None:
    import respx as _respx

    async with AsyncAegis(
        api_key=api_key,
        base_url=base_url,
        max_retries=2,
        timeout_ms=2_000,
    ) as a:
        with _respx.mock(base_url=base_url, assert_all_called=False) as router:
            route = router.get("/agents/agt_x")
            route.side_effect = [
                httpx.Response(503, json=_envelope(503)),
                httpx.Response(503, json=_envelope(503)),
                httpx.Response(200, json=sample_agent_record),
            ]
            agent = await a.agents.get("agt_x")
            assert agent.agent_id == sample_agent_record["agentId"]
            assert route.call_count == 3


async def test_4xx_is_not_retried(api_key: str, base_url: str) -> None:
    import respx as _respx

    async with AsyncAegis(
        api_key=api_key, base_url=base_url, max_retries=3, timeout_ms=2_000
    ) as a:
        with _respx.mock(base_url=base_url, assert_all_called=False) as router:
            route = router.get("/agents/agt_x").respond(
                404, json=_envelope(404, message="missing")
            )
            with pytest.raises(NotFoundError):
                await a.agents.get("agt_x")
            # No retries on a 404 — should be exactly one call.
            assert route.call_count == 1


def test_aegis_error_has_helpful_repr() -> None:
    err = ValidationError("bad", status_code=400, request_id="rid", code="X", details={"f": 1})
    s = repr(err)
    assert "ValidationError" in s
    assert "400" in s
    assert "rid" in s


async def test_missing_keys_raises_aegis_error_eagerly() -> None:
    """SDK should refuse to construct without any key configured."""
    with pytest.raises(AegisError):
        AsyncAegis()
