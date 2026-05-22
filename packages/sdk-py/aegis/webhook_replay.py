"""Webhook replay defense — Python mirror of ``packages/sdk-ts/src/webhook-replay.ts``.

PROBLEM SHAPE
-------------
:func:`aegis.verify_webhook_signature` (M-WEBHOOK-1-py) verifies HMAC plus
a timestamp window. Inside that window (default 300s, operator-pinned), a
captured signature is still cryptographically valid. An attacker who reads
the wire OR a well-meaning load balancer that re-fires a request can
deliver the same payload twice — and the customer's handler will execute
twice unless they dedupe on ``X-AEGIS-Delivery-Id``.

The API stamps that header at
``apps/api/src/modules/webhooks/webhook.delivery.ts:355`` with the
``WebhookDelivery`` row id (server-minted, CUID-formatted, unique per
attempt). Every retry of the same logical delivery reuses the same id, so
dedupe is correct under at-least-once semantics.

WHY AN ADAPTER, NOT A BUILT-IN
------------------------------
Replay defense needs storage. In-process memory works for a single
container but fails the moment a customer horizontally scales their
receiver — process A admits delivery X, process B admits the same X.
Customers running > 1 receiver pod need Redis / Memcached / DynamoDB /
Cloud KV. This module ships:

1. A pluggable :class:`WebhookReplayStore` Protocol — the dedupe backend.
2. :func:`create_memory_replay_store` — bounded LRU + per-entry TTL for
   quickstarts, tests, and single-process receivers.
3. :func:`assert_not_replay` — the helper customers actually call from
   inside their webhook handler.

ASYNC TOLERANCE — adapted from TS pattern
------------------------------------------
The TS interface uses ``Promise<T> | T`` — JS awaits plain values
transparently. Python doesn't (``await 'first-sight'`` raises TypeError),
so we adapt:

- :meth:`WebhookReplayStore.record_or_replay` may return EITHER the
  literal directly (sync stores like the in-memory default) OR an
  Awaitable (async stores like aioredis).
- :func:`assert_not_replay` is async; it checks
  :func:`inspect.isawaitable` and awaits as needed.
- Customers running sync code call
  ``asyncio.run(assert_not_replay(...))`` — same dual-mode pattern as
  the Py SDK's :class:`Aegis` vs :class:`AsyncAegis`.

CANONICAL REDIS IMPLEMENTATION (paste into customer code, ~5 lines)::

    class RedisReplayStore:
        def __init__(self, redis_client):
            self._r = redis_client
        async def record_or_replay(self, delivery_id, ttl_seconds):
            ok = await self._r.set(f'whrp:{delivery_id}', '1', nx=True, ex=ttl_seconds)
            return 'first-sight' if ok else 'replay'

COMPOSES WITH M-WEBHOOK-1-py (verify) AND M-WEBHOOK-3-py (when shipped)
----------------------------------------------------------------------
The customer-facing recipe is verify → dedupe → narrow::

    sig = request.headers["X-AEGIS-Signature"]
    delivery_id = request.headers["X-AEGIS-Delivery-Id"]
    verify_webhook_signature(payload=body, signature=sig, secret=secret)
    await assert_not_replay(store=store, delivery_id=delivery_id, ttl_seconds=86_400)
    # ...process the verified, deduped event...
"""

from __future__ import annotations

import inspect
import time
from collections.abc import Awaitable, Callable
from typing import Final, Literal, Protocol, runtime_checkable

from .errors import AegisError

# Type alias for the discriminated verdict — mirrors the TS union exactly.
ReplayVerdict = Literal["first-sight", "replay"]


class WebhookReplayDetectedError(AegisError):
    """Raised when a delivery id has already been processed.

    The handler should respond 200 to the API (the delivery is genuinely
    already-handled — NOT an error from the API's perspective) and skip
    its business logic. The 200 prevents the API's BullMQ retry worker
    from re-firing the same delivery, which would just trigger the same
    replay error in a loop.

    Receivers concerned about distinguishing "we already saw this" from
    "we successfully processed this" should log the ``delivery_id`` on
    the replay-detected path before returning 200.

    Attributes:
        delivery_id: The id that was already in the store.
    """

    code = "WEBHOOK_REPLAY_DETECTED"

    def __init__(self, message: str, *, delivery_id: str) -> None:
        super().__init__(message, status_code=409)
        self.delivery_id = delivery_id


@runtime_checkable
class WebhookReplayStore(Protocol):
    """Pluggable dedupe backend.

    Operator-chosen interface shape (2026-05-22, locked across both
    SDKs): atomic single-call ``record_or_replay`` returning a
    discriminated ``'first-sight' | 'replay'``. Atomic by construction
    — no TOCTOU on concurrent deliveries. Maps to Redis ``SET NX EX``
    in one round trip.

    Rejected alternatives (same as TS): separate ``has`` + ``add``
    (TOCTOU race in distributed receivers); boolean ``set_if_absent``
    (less self-documenting at call sites).
    """

    def record_or_replay(
        self, delivery_id: str, ttl_seconds: int
    ) -> ReplayVerdict | Awaitable[ReplayVerdict]:
        """Atomically: if ``delivery_id`` is unseen, record it with the
        supplied TTL and return ``'first-sight'``. If already present
        (and unexpired), return ``'replay'``.

        The decision MUST be atomic — between the lookup and the write,
        no other caller may observe a different verdict for the same id.
        Sync stores may return the literal directly; async stores
        (Redis, Memcached, KV) may return an Awaitable; the helper
        :func:`assert_not_replay` accepts both.
        """
        ...


class _MemoryReplayStore:
    """In-process bounded LRU with per-entry TTL.

    Use for quickstarts, tests, and single-process receivers. **Not
    safe across horizontally scaled receivers** — two processes will
    admit the same delivery once each. Operators running > 1 receiver
    pod must supply a shared-store implementation (Redis ``SET NX EX``
    is the canonical mapping).

    Security property — re-recording an existing key does NOT refresh
    its LRU position. Otherwise an attacker who keeps replaying could
    hold their id in the LRU indefinitely, evicting legitimate entries.

    Insertion-order eviction: Python's ``dict`` preserves insertion
    order (CPython 3.7+, language guarantee 3.7+). Iterating
    ``self._entries`` yields oldest-first, matching the JS Map
    iteration order this mirrors.
    """

    def __init__(self, *, max_entries: int, now: Callable[[], float]) -> None:
        self._entries: dict[str, float] = {}  # delivery_id -> expires_at_seconds
        self._max_entries = max_entries
        self._now = now

    def record_or_replay(self, delivery_id: str, ttl_seconds: int) -> ReplayVerdict:
        current = self._now()

        # Purge expired entries (oldest-first; stop at first non-expired).
        for k in list(self._entries):
            if self._entries[k] <= current:
                del self._entries[k]
            else:
                break

        existing = self._entries.get(delivery_id)
        if existing is not None and existing > current:
            return "replay"

        # Either no entry, or it was expired (already purged above, but
        # belt-and-braces against a future refactor of the purge loop).
        if delivery_id in self._entries:
            del self._entries[delivery_id]

        if len(self._entries) >= self._max_entries:
            # Evict the oldest entry (insertion order).
            oldest = next(iter(self._entries))
            del self._entries[oldest]

        self._entries[delivery_id] = current + ttl_seconds
        return "first-sight"

    def size(self) -> int:
        """Approximate entry count — metrics only, NOT used for correctness."""
        return len(self._entries)


def create_memory_replay_store(
    *,
    max_entries: int = 10_000,
    now: Callable[[], float] | None = None,
) -> WebhookReplayStore:
    """Create an in-memory :class:`WebhookReplayStore`.

    Args:
        max_entries: Max retained entries. When the bound is hit, the
            oldest entry is evicted before a new one is added. Default
            10_000 — covers ~3 hours of webhook traffic at 1 RPS
            without any TTL-driven eviction.
        now: Override the clock — tests inject ``lambda: fake_now`` for
            deterministic TTL behaviour. Defaults to :func:`time.time`.

    Returns:
        A store implementing :class:`WebhookReplayStore`. Returned as
        the protocol type so customers swapping to Redis later don't
        need to import the concrete class.
    """
    return _MemoryReplayStore(max_entries=max_entries, now=now or time.time)


# Operator-pinned default TTL for assert_not_replay. Matches the TS
# DEFAULT (86_400 = 24h). Should be ≥ the webhook subscription's max
# retry duration so every retry of the same delivery hits dedupe.
DEFAULT_REPLAY_TTL_SECONDS: Final[int] = 86_400


async def assert_not_replay(
    *,
    store: WebhookReplayStore,
    delivery_id: str,
    ttl_seconds: int = DEFAULT_REPLAY_TTL_SECONDS,
) -> None:
    """Throw :class:`WebhookReplayDetectedError` if ``delivery_id`` has
    been seen inside the TTL window. Otherwise record the id and return.

    Idempotent with respect to repeated calls for the same id
    (subsequent calls throw). Place this **after**
    :func:`verify_webhook_signature` — there is no point deduping an
    unverified id (an attacker would just pick a fresh one).

    Async because the underlying store may be async (Redis, KV). For
    sync-only stores like :func:`create_memory_replay_store`, the
    function still works — :func:`inspect.isawaitable` distinguishes
    the two paths.

    Customers in sync code call ``asyncio.run(assert_not_replay(...))``.

    Args:
        store: Backing store implementing :class:`WebhookReplayStore`.
        delivery_id: Value of the ``X-AEGIS-Delivery-Id`` header.
        ttl_seconds: Retention TTL. Default 86_400 (24h) — generous;
            tighten if your store is expensive.

    Raises:
        WebhookReplayDetectedError: If ``delivery_id`` is already in the store.
    """
    result: ReplayVerdict | Awaitable[ReplayVerdict] = store.record_or_replay(
        delivery_id, ttl_seconds
    )
    verdict: ReplayVerdict
    if inspect.isawaitable(result):
        verdict = await result
    else:
        # ``isawaitable`` is the discriminator; the else branch is a
        # ReplayVerdict literal (mypy narrows the type automatically).
        verdict = result

    if verdict == "replay":
        raise WebhookReplayDetectedError(
            f"webhook delivery already processed: {delivery_id}",
            delivery_id=delivery_id,
        )


__all__ = [
    "DEFAULT_REPLAY_TTL_SECONDS",
    "ReplayVerdict",
    "WebhookReplayDetectedError",
    "WebhookReplayStore",
    "assert_not_replay",
    "create_memory_replay_store",
]
