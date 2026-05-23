"""Sync facade tests. Mirrors the existing ``test_async_sync_parity.py``
pattern: the sync surface MUST produce equivalent decisions to the
async surface, and cache/breaker state MUST persist across calls.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from aegis import (
    AsyncVerifyGateway,
    ServerError,
    VerifyGateway,
    VerifyGatewayOptions,
    VerifyResult,
)


def _result(**overrides: Any) -> VerifyResult:
    base = {
        "valid": True,
        "agentId": "agt_1",
        "principalId": "prn_1",
        "trustScore": 612,
        "trustBand": "VERIFIED",
        "scopesGranted": ["commerce"],
        "denialReason": None,
        "verifiedAt": datetime.fromtimestamp(0, tz=timezone.utc).isoformat(),
        "ttl": 30,
    }
    base.update(overrides)
    return VerifyResult.model_validate(base)


def _fake(verify_impl: Any) -> Any:
    class _Fake:
        def __init__(self) -> None:
            self.verify = verify_impl

    return _Fake()


def test_sync_verify_returns_result() -> None:
    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result()))
    gw = VerifyGateway(fake)
    res = gw.verify("tok")
    assert res.valid is True


def test_sync_cache_state_survives_across_calls() -> None:
    """The whole point of a stateful sync facade. ``asyncio.run`` creates
    a new loop per call, but the AsyncVerifyGateway instance (and its
    cache) persists — so the second call MUST hit cache."""
    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result(ttl=30)))
    gw = VerifyGateway(fake)
    gw.verify("tok")
    gw.verify("tok")
    assert fake.verify.await_count == 1


def test_sync_breaker_state_survives_across_calls() -> None:
    fake = _fake(
        AsyncMock(
            side_effect=lambda *a, **k: (_ for _ in ()).throw(
                ServerError("boom", status_code=500, request_id=None)
            )
        )
    )
    gw = VerifyGateway(fake, VerifyGatewayOptions(breaker_threshold=2))
    with pytest.raises(ServerError):
        gw.verify("a")
    with pytest.raises(ServerError):
        gw.verify("b")
    # Breaker now open — third call fast-fails without invoking upstream.
    assert gw.state == "open"
    with pytest.raises(ServerError):
        gw.verify("c")
    assert fake.verify.await_count == 2


def test_sync_metrics_snapshot() -> None:
    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result(ttl=30)))
    gw = VerifyGateway(fake)
    gw.verify("tok")
    gw.verify("tok")
    m = gw.metrics()
    assert m.hits == 1
    assert m.misses == 1


def test_sync_invalidate_drops_entry() -> None:
    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result(ttl=30)))
    gw = VerifyGateway(fake)
    gw.verify("tok")
    gw.invalidate("tok")
    gw.verify("tok")
    assert fake.verify.await_count == 2


# ── async/sync parity ──────────────────────────────────────────


def test_sync_and_async_produce_equivalent_decisions() -> None:
    """Same fake upstream + same options → equivalent VerifyResult on
    both surfaces. Single-flight is irrelevant for sync (serial calls),
    so we only assert decision equivalence, not call-count equivalence.
    """
    import asyncio as _asyncio

    fake_a = _fake(AsyncMock(side_effect=lambda *a, **k: _result(ttl=30)))
    sync_gw = VerifyGateway(fake_a)
    sync_res = sync_gw.verify("tok", amount=10, currency="USD")

    fake_b = _fake(AsyncMock(side_effect=lambda *a, **k: _result(ttl=30)))
    async_gw = AsyncVerifyGateway(fake_b)

    async def _go() -> VerifyResult:
        return await async_gw.verify("tok", amount=10, currency="USD")

    async_res = _asyncio.run(_go())

    assert sync_res.model_dump() == async_res.model_dump()
