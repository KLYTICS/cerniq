"""Tests for :mod:`aegis.webhook_replay` — replay defense.

Mirrors ``packages/sdk-ts/src/webhook-replay.spec.ts`` test-for-test
including the operator-added atomicity stampede coverage. The
cross-language behavioral parity gate in
``tests/cross-package/sdk-ts-py-webhook-replay-parity.spec.ts`` asserts
the two SDKs produce IDENTICAL verdict sequences for the same scenarios.
"""

from __future__ import annotations

import asyncio
from typing import Literal

import pytest

from aegis.webhook_replay import (
    DEFAULT_REPLAY_TTL_SECONDS,
    ReplayVerdict,
    WebhookReplayDetectedError,
    WebhookReplayStore,
    assert_not_replay,
    create_memory_replay_store,
)

# ──────────────────────────────────────────────────────────────────────
# Operator-pinned constants — locked across TS and Py
# ──────────────────────────────────────────────────────────────────────


def test_default_ttl_matches_ts_sdk() -> None:
    """Operator-pinned default — 86_400 (24h) across both SDKs."""
    assert DEFAULT_REPLAY_TTL_SECONDS == 86_400


# ──────────────────────────────────────────────────────────────────────
# create_memory_replay_store
# ──────────────────────────────────────────────────────────────────────


def test_first_sight_then_replay() -> None:
    store = create_memory_replay_store()
    assert store.record_or_replay("del_1", 60) == "first-sight"
    assert store.record_or_replay("del_1", 60) == "replay"


def test_different_delivery_ids_independent() -> None:
    store = create_memory_replay_store()
    assert store.record_or_replay("del_a", 60) == "first-sight"
    assert store.record_or_replay("del_b", 60) == "first-sight"
    assert store.record_or_replay("del_a", 60) == "replay"
    assert store.record_or_replay("del_b", 60) == "replay"


def test_ttl_expiry_frees_the_id() -> None:
    fake_now = [1_000_000.0]
    store = create_memory_replay_store(now=lambda: fake_now[0])
    assert store.record_or_replay("del_ttl", 60) == "first-sight"
    fake_now[0] += 59.999  # still inside the 60s window
    assert store.record_or_replay("del_ttl", 60) == "replay"
    fake_now[0] += 0.002  # past the 60s expiry
    assert store.record_or_replay("del_ttl", 60) == "first-sight"


def test_replay_does_not_refresh_lru_position() -> None:
    """Security: re-recording an existing key must not bump its eviction clock.

    Otherwise an attacker who keeps replaying could hold their id in the
    LRU indefinitely, evicting legitimate entries.

    Note: each ``record_or_replay`` is itself a write that can trigger
    eviction at the cap. We probe ONE id per assertion phase to avoid
    self-perturbing measurement (same fix as the TS spec).
    """
    store = create_memory_replay_store(max_entries=2)
    store.record_or_replay("a", 3600)
    store.record_or_replay("b", 3600)
    # Replay attempt on 'a' must not refresh its position.
    assert store.record_or_replay("a", 3600) == "replay"
    # Insert 'c' — should evict 'a' (oldest by ORIGINAL insertion), not 'b'.
    # If the replay HAD refreshed 'a', 'b' would be the oldest and get evicted.
    store.record_or_replay("c", 3600)
    # 'a' should be gone — the replay did NOT refresh its position.
    assert store.record_or_replay("a", 3600) == "first-sight"


def test_caps_at_max_entries_oldest_first_eviction() -> None:
    store = create_memory_replay_store(max_entries=3)
    store.record_or_replay("1", 3600)
    store.record_or_replay("2", 3600)
    store.record_or_replay("3", 3600)
    assert store.size() == 3
    store.record_or_replay("4", 3600)
    assert store.size() == 3
    # '1' was the oldest — should have been evicted.
    # (Only probe ONE id; each probe is itself a write.)
    assert store.record_or_replay("1", 3600) == "first-sight"


def test_size_observability() -> None:
    store = create_memory_replay_store()
    assert store.size() == 0
    store.record_or_replay("a", 60)
    store.record_or_replay("b", 60)
    assert store.size() == 2


# ──────────────────────────────────────────────────────────────────────
# assert_not_replay
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_assert_not_replay_returns_none_on_first_sight() -> None:
    store = create_memory_replay_store()
    result = await assert_not_replay(store=store, delivery_id="del_1", ttl_seconds=60)
    assert result is None


@pytest.mark.asyncio
async def test_assert_not_replay_raises_on_second_sight_with_delivery_id() -> None:
    store = create_memory_replay_store()
    await assert_not_replay(store=store, delivery_id="del_dup", ttl_seconds=60)
    with pytest.raises(WebhookReplayDetectedError) as excinfo:
        await assert_not_replay(store=store, delivery_id="del_dup", ttl_seconds=60)
    err = excinfo.value
    assert err.code == "WEBHOOK_REPLAY_DETECTED"
    assert err.status_code == 409
    assert err.delivery_id == "del_dup"
    assert "del_dup" in err.message


@pytest.mark.asyncio
async def test_assert_not_replay_defaults_ttl_to_86_400() -> None:
    calls: list[tuple[str, int]] = []

    class _CaptureStore:
        def record_or_replay(
            self, delivery_id: str, ttl_seconds: int
        ) -> ReplayVerdict:
            calls.append((delivery_id, ttl_seconds))
            return "first-sight"

    await assert_not_replay(store=_CaptureStore(), delivery_id="del_default")
    assert calls == [("del_default", 86_400)]


@pytest.mark.asyncio
async def test_assert_not_replay_accepts_async_store() -> None:
    """Simulates a Redis-backed store: returns a coroutine."""
    seen: set[str] = set()

    class _AsyncStore:
        async def record_or_replay(
            self, delivery_id: str, ttl_seconds: int
        ) -> ReplayVerdict:
            if delivery_id in seen:
                return "replay"
            seen.add(delivery_id)
            return "first-sight"

    await assert_not_replay(store=_AsyncStore(), delivery_id="r_1", ttl_seconds=60)
    with pytest.raises(WebhookReplayDetectedError):
        await assert_not_replay(store=_AsyncStore(), delivery_id="r_1", ttl_seconds=60)
    # Wait — that ^ uses a NEW _AsyncStore each call. Re-test with shared
    # instance to be sure async store actually rejects the replay.
    shared = _AsyncStore()
    await assert_not_replay(store=shared, delivery_id="r_2", ttl_seconds=60)
    with pytest.raises(WebhookReplayDetectedError):
        await assert_not_replay(store=shared, delivery_id="r_2", ttl_seconds=60)


# ──────────────────────────────────────────────────────────────────────
# Atomicity contract — mirrors operator-added TS stampede coverage
# ──────────────────────────────────────────────────────────────────────
#
# The Protocol JSDoc-equivalent promises:
#   "between the lookup and the write, no other caller may observe a
#    different verdict for the same id"
#
# In single-threaded Python, two awaited calls to the same async method
# serialize: the second can't resume until the first settles. We
# exercise this contract by firing parallel calls and asserting the
# verdicts are mutually exclusive. If the implementation ever broke
# atomicity (e.g. by inserting an ``await`` between the get and the
# set, allowing event-loop interleaving), this test would catch the
# resulting both-first-sight failure mode.
#
# CRITICAL CAVEAT: this property holds only within ONE process. Two
# processes calling create_memory_replay_store() each have separate
# dicts and can both return 'first-sight' for the same id.


@pytest.mark.asyncio
async def test_two_concurrent_calls_yield_exactly_one_first_sight() -> None:
    store = create_memory_replay_store()

    async def call() -> ReplayVerdict:
        # ``record_or_replay`` is sync; wrap in a coroutine to schedule
        # concurrently.
        return store.record_or_replay("del_race", 60)

    results = await asyncio.gather(call(), call())
    verdicts = sorted(results)
    assert verdicts == ["first-sight", "replay"]


@pytest.mark.asyncio
async def test_100_concurrent_calls_yield_one_first_sight_and_99_replays() -> None:
    store = create_memory_replay_store()

    async def call() -> ReplayVerdict:
        return store.record_or_replay("del_stampede", 60)

    results = await asyncio.gather(*[call() for _ in range(100)])
    first_sights = sum(1 for r in results if r == "first-sight")
    replays = sum(1 for r in results if r == "replay")
    assert first_sights == 1
    assert replays == 99


@pytest.mark.asyncio
async def test_concurrent_different_ids_all_return_first_sight() -> None:
    store = create_memory_replay_store()
    ids = [f"del_{i}" for i in range(50)]

    async def call(i: str) -> ReplayVerdict:
        return store.record_or_replay(i, 60)

    results = await asyncio.gather(*[call(i) for i in ids])
    assert all(r == "first-sight" for r in results)
    assert store.size() == 50


@pytest.mark.asyncio
async def test_assert_not_replay_stampede_produces_exactly_one_success() -> None:
    store = create_memory_replay_store()

    async def call() -> Literal["ok", "replay"]:
        try:
            await assert_not_replay(
                store=store, delivery_id="stampede_id", ttl_seconds=60
            )
            return "ok"
        except WebhookReplayDetectedError:
            return "replay"

    results = await asyncio.gather(*[call() for _ in range(20)])
    assert sum(1 for r in results if r == "ok") == 1
    assert sum(1 for r in results if r == "replay") == 19


# ──────────────────────────────────────────────────────────────────────
# Protocol conformance
# ──────────────────────────────────────────────────────────────────────


def test_memory_store_satisfies_webhookreplaystore_protocol() -> None:
    """Runtime-checkable protocol — customers should be able to ``isinstance``
    check their store against the protocol for early type-error feedback.
    """
    store = create_memory_replay_store()
    assert isinstance(store, WebhookReplayStore)


# ──────────────────────────────────────────────────────────────────────
# Error class shape
# ──────────────────────────────────────────────────────────────────────


def test_webhook_replay_detected_error_carries_canonical_shape() -> None:
    err = WebhookReplayDetectedError("already processed", delivery_id="del_42")
    assert err.code == "WEBHOOK_REPLAY_DETECTED"
    assert err.status_code == 409
    assert err.delivery_id == "del_42"
    assert "already processed" in err.message
