"""Tests for ``AsyncVerifyGateway``. Mirrors
``packages/sdk-ts/src/verify-gateway.spec.ts``.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from aegis import (
    AsyncVerifyGateway,
    ServerError,
    VerifyGatewayHooks,
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
    """Build a minimal AsyncAegis stub with a mocked ``verify`` method."""

    class _Fake:
        def __init__(self) -> None:
            self.verify = verify_impl

    return _Fake()


# ── caching ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_caches_valid_results_within_ttl() -> None:
    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result(ttl=30)))
    gw = AsyncVerifyGateway(fake)
    a = await gw.verify("tok", amount=10)
    b = await gw.verify("tok", amount=10)
    assert a.valid and b.valid
    assert fake.verify.await_count == 1


@pytest.mark.asyncio
async def test_does_not_cache_denials_by_default() -> None:
    fake = _fake(
        AsyncMock(
            side_effect=lambda *a, **k: _result(valid=False, denialReason="POLICY_REVOKED")
        )
    )
    gw = AsyncVerifyGateway(fake)
    await gw.verify("tok")
    await gw.verify("tok")
    assert fake.verify.await_count == 2


@pytest.mark.asyncio
async def test_caches_denials_when_negative_ttl_set() -> None:
    now = [0]
    fake = _fake(
        AsyncMock(
            side_effect=lambda *a, **k: _result(valid=False, denialReason="POLICY_REVOKED")
        )
    )
    gw = AsyncVerifyGateway(
        fake, VerifyGatewayOptions(negative_ttl_ms=1_000, now=lambda: now[0])
    )
    await gw.verify("tok")
    now[0] = 500
    await gw.verify("tok")
    assert fake.verify.await_count == 1


@pytest.mark.asyncio
async def test_clamps_ttl_to_operator_ceiling() -> None:
    now = [0]
    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result(ttl=3600)))
    gw = AsyncVerifyGateway(
        fake, VerifyGatewayOptions(max_ttl_ms=1_000, now=lambda: now[0])
    )
    await gw.verify("tok")
    now[0] = 1_500
    await gw.verify("tok")
    assert fake.verify.await_count == 2


@pytest.mark.asyncio
async def test_different_context_different_cache_key() -> None:
    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result()))
    gw = AsyncVerifyGateway(fake)
    await gw.verify("tok", amount=10)
    await gw.verify("tok", amount=20)
    assert fake.verify.await_count == 2


# ── single-flight ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_single_flight_coalesces_concurrent_callers() -> None:
    gate = asyncio.Event()
    call_count = [0]

    async def slow_verify(*args: Any, **kwargs: Any) -> VerifyResult:
        call_count[0] += 1
        await gate.wait()
        return _result()

    fake = _fake(slow_verify)
    gw = AsyncVerifyGateway(fake)
    p1 = asyncio.create_task(gw.verify("tok"))
    p2 = asyncio.create_task(gw.verify("tok"))
    p3 = asyncio.create_task(gw.verify("tok"))
    # Yield so all three enter the gateway and coalesce.
    for _ in range(5):
        await asyncio.sleep(0)
    gate.set()
    await asyncio.gather(p1, p2, p3)
    assert call_count[0] == 1


@pytest.mark.asyncio
async def test_coalesce_hook_fires_with_waiter_count() -> None:
    gate = asyncio.Event()
    hits: list[int] = []

    async def slow_verify(*args: Any, **kwargs: Any) -> VerifyResult:
        await gate.wait()
        return _result()

    fake = _fake(slow_verify)
    gw = AsyncVerifyGateway(
        fake,
        VerifyGatewayOptions(
            hooks=VerifyGatewayHooks(on_coalesce=lambda key, n: hits.append(n))
        ),
    )
    p1 = asyncio.create_task(gw.verify("tok"))
    p2 = asyncio.create_task(gw.verify("tok"))
    for _ in range(5):
        await asyncio.sleep(0)
    gate.set()
    await asyncio.gather(p1, p2)
    assert 2 in hits


# ── circuit breaker ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_breaker_opens_after_consecutive_failures_and_fails_fast() -> None:
    async def always_fail(*args: Any, **kwargs: Any) -> VerifyResult:
        raise ServerError("boom", status_code=500, request_id=None)

    fake = _fake(always_fail)
    state_changes: list[tuple[str, str]] = []
    gw = AsyncVerifyGateway(
        fake,
        VerifyGatewayOptions(
            breaker_threshold=2,
            hooks=VerifyGatewayHooks(
                on_breaker_state_change=lambda f, t: state_changes.append((f, t))
            ),
        ),
    )
    with pytest.raises(ServerError):
        await gw.verify("a")
    with pytest.raises(ServerError):
        await gw.verify("b")
    # Breaker is now open — third call must fast-fail with 503 ServerError.
    with pytest.raises(ServerError) as exc:
        await gw.verify("c")
    assert "breaker is open" in str(exc.value)
    assert state_changes == [("closed", "open")]


@pytest.mark.asyncio
async def test_breaker_open_to_half_open_to_closed_on_probe_success() -> None:
    now = [0]
    mode = ["fail"]

    async def upstream(*args: Any, **kwargs: Any) -> VerifyResult:
        if mode[0] == "fail":
            raise ServerError("boom", status_code=500, request_id=None)
        return _result()

    fake = _fake(upstream)
    state_changes: list[tuple[str, str]] = []
    gw = AsyncVerifyGateway(
        fake,
        VerifyGatewayOptions(
            breaker_threshold=1,
            breaker_cooldown_ms=1_000,
            now=lambda: now[0],
            hooks=VerifyGatewayHooks(
                on_breaker_state_change=lambda f, t: state_changes.append((f, t))
            ),
        ),
    )
    with pytest.raises(ServerError):
        await gw.verify("a")
    assert gw.state == "open"
    # Within cooldown — still open.
    now[0] = 500
    with pytest.raises(ServerError):
        await gw.verify("b")
    # After cooldown, probe succeeds → closed.
    now[0] = 1_500
    mode[0] = "ok"
    res = await gw.verify("c")
    assert res.valid
    assert gw.state == "closed"
    assert state_changes == [
        ("closed", "open"),
        ("open", "half-open"),
        ("half-open", "closed"),
    ]


@pytest.mark.asyncio
async def test_half_open_serializes_to_one_probe() -> None:
    now = [0]
    probe_count = [0]
    probe_resolve = asyncio.Event()

    async def upstream(*args: Any, **kwargs: Any) -> VerifyResult:
        probe_count[0] += 1
        if probe_count[0] == 1:
            raise ServerError("boom", status_code=500, request_id=None)
        await probe_resolve.wait()
        return _result()

    fake = _fake(upstream)
    gw = AsyncVerifyGateway(
        fake,
        VerifyGatewayOptions(
            breaker_threshold=1,
            breaker_cooldown_ms=1_000,
            now=lambda: now[0],
        ),
    )
    with pytest.raises(ServerError):
        await gw.verify("a")
    assert gw.state == "open"
    # Advance past cooldown so next call transitions to half-open.
    now[0] = 1_500
    probe_task = asyncio.create_task(gw.verify("b"))
    # Yield so probe enters half-open + sets the in-flight flag.
    for _ in range(5):
        await asyncio.sleep(0)
    assert gw.state == "half-open"
    # Concurrent callers during the probe must fast-fail, not slam upstream.
    with pytest.raises(ServerError):
        await gw.verify("c")
    with pytest.raises(ServerError):
        await gw.verify("d")
    assert probe_count[0] == 2  # 1st failed pre-trip, 2nd is the probe.
    probe_resolve.set()
    await probe_task
    assert gw.state == "closed"


@pytest.mark.asyncio
async def test_serve_stale_returns_expired_cache_when_breaker_open() -> None:
    now = [0]
    mode = ["ok"]

    async def upstream(*args: Any, **kwargs: Any) -> VerifyResult:
        if mode[0] == "fail":
            raise ServerError("boom", status_code=500, request_id=None)
        return _result(ttl=1)

    fake = _fake(upstream)
    stale_keys: list[str] = []
    gw = AsyncVerifyGateway(
        fake,
        VerifyGatewayOptions(
            breaker_threshold=1,
            fallback_mode="serve-stale",
            now=lambda: now[0],
            hooks=VerifyGatewayHooks(on_stale=lambda k, r: stale_keys.append(k)),
        ),
    )
    # Prime cache.
    await gw.verify("tok")
    # Move past TTL and trip breaker on a different key.
    now[0] = 5_000
    mode[0] = "fail"
    with pytest.raises(ServerError):
        await gw.verify("other")
    assert gw.state == "open"
    # Original key — cache expired, but breaker is open → serve stale.
    stale = await gw.verify("tok")
    assert stale.valid
    assert len(stale_keys) == 1


# ── invalidation + metrics ────────────────────────────────────


@pytest.mark.asyncio
async def test_invalidate_drops_entry() -> None:
    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result(ttl=30)))
    gw = AsyncVerifyGateway(fake)
    await gw.verify("tok")
    await gw.invalidate("tok")
    await gw.verify("tok")
    assert fake.verify.await_count == 2


# ── reviewer-driven regressions ────────────────────────────────


@pytest.mark.asyncio
async def test_r005_failures_during_open_phase_do_not_accumulate() -> None:
    """If extra in-flight failures arrive after the breaker is already
    open, ``consecutive_failures`` must NOT keep climbing. Otherwise the
    next half-open probe re-trips immediately on a single failure."""
    now = [0]
    fail = [True]

    async def upstream(*args: Any, **kwargs: Any) -> VerifyResult:
        if fail[0]:
            raise ServerError("boom", status_code=500, request_id=None)
        return _result()

    fake = _fake(upstream)
    gw = AsyncVerifyGateway(
        fake,
        VerifyGatewayOptions(
            breaker_threshold=2,
            breaker_cooldown_ms=1_000,
            now=lambda: now[0],
        ),
    )
    # Trip the breaker.
    with pytest.raises(ServerError):
        await gw.verify("a")
    with pytest.raises(ServerError):
        await gw.verify("b")
    assert gw.state == "open"
    # Counter must not grow past threshold during open phase.
    snapshot = gw.metrics().consecutive_failures
    # In-flight failure attempts during open are fast-failed by gateway,
    # so the counter is locked.
    for _ in range(10):
        with pytest.raises(ServerError):
            await gw.verify("x" + str(_))
    assert gw.metrics().consecutive_failures == snapshot


@pytest.mark.asyncio
async def test_r006_cache_set_failure_does_not_lose_verify_result() -> None:
    """A successful upstream verify must return the result even if the
    cache backend (Redis, CF KV) fails to store it. Otherwise a Redis
    blip turns successful verifies into ServerErrors."""

    class BrokenSetCache:
        def get(self, key: str) -> Any:
            return None

        def peek(self, key: str) -> Any:
            return None

        def set(self, key: str, value: Any) -> None:
            raise RuntimeError("redis down")

        def delete(self, key: str) -> None: ...

        def size(self) -> int:
            return 0

    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result()))
    gw = AsyncVerifyGateway(fake, VerifyGatewayOptions(cache=BrokenSetCache()))
    res = await gw.verify("tok")
    assert res.valid is True


@pytest.mark.asyncio
async def test_r006_cache_get_failure_falls_through_to_upstream() -> None:
    """A backend error on ``get/peek`` must degrade to cache miss, not
    propagate to the verify caller."""

    class BrokenGetCache:
        def get(self, key: str) -> Any:
            raise RuntimeError("redis down")

        def peek(self, key: str) -> Any:
            raise RuntimeError("redis down")

        def set(self, key: str, value: Any) -> None: ...

        def delete(self, key: str) -> None: ...

        def size(self) -> int:
            return 0

    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result()))
    gw = AsyncVerifyGateway(fake, VerifyGatewayOptions(cache=BrokenGetCache()))
    res = await gw.verify("tok")
    assert res.valid is True
    assert fake.verify.await_count == 1


@pytest.mark.asyncio
async def test_r001_cancellation_propagates_without_breaker_pollution() -> None:
    """Cancellation must propagate cleanly. Breaker counters must not
    move because Cancelled is not an upstream failure signal."""
    enter = asyncio.Event()
    block = asyncio.Event()

    async def slow_verify(*args: Any, **kwargs: Any) -> VerifyResult:
        enter.set()
        await block.wait()
        return _result()

    fake = _fake(slow_verify)
    gw = AsyncVerifyGateway(fake, VerifyGatewayOptions(breaker_threshold=2))
    task = asyncio.create_task(gw.verify("tok"))
    await enter.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    # Breaker state untouched, no failure counted.
    m = gw.metrics()
    assert m.state == "closed"
    assert m.consecutive_failures == 0
    assert m.breaker_trips == 0


@pytest.mark.asyncio
async def test_metrics_snapshot() -> None:
    fake = _fake(AsyncMock(side_effect=lambda *a, **k: _result(ttl=30)))
    gw = AsyncVerifyGateway(fake)
    await gw.verify("tok")
    await gw.verify("tok")
    await gw.verify("other")
    m = gw.metrics()
    assert m.hits == 1
    assert m.misses == 2
    assert m.state == "closed"
    assert m.cache_size == 2
