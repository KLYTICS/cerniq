"""Verify-result cache primitives for the relying-party hot path.

Mirrors ``packages/sdk-ts/src/cache.ts`` so the two SDKs collapse the same
verify-traffic shape (the same token + ctx hitting AEGIS many times within
the server-declared TTL window).

Safety contract — kept in lockstep with the TS SDK:

* Only positive (``valid=True``) results are cached by default. Denials are
  short-lived state (revocation, spend bumps, anomaly flags); caching them
  risks contradicting the API after a state change. A bounded
  ``negative_ttl_ms`` opt-in exists for operators who explicitly accept
  that trade-off.
* TTL is always ``min(server.ttl, operator-configured ceiling)``. The
  server is authoritative; the client never extends past what the server
  said was safe.
* Cache key spans the full verify context. Same token + different amount =
  different decision and must miss.
"""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional, Protocol, Union, runtime_checkable

from .models import VerifyResult


@dataclass(slots=True)
class VerifyCacheContext:
    """Inputs that affect a verify decision and therefore the cache key."""

    action: str | None = None
    amount: float | None = None
    currency: str | None = None
    merchant_id: str | None = None
    merchant_domain: str | None = None


@dataclass(slots=True)
class CachedVerify:
    result: VerifyResult
    expires_at_ms: int


# Methods may be sync or async — backends like Redis/CF KV are naturally
# async, while the in-memory default is sync. The gateway awaits results
# uniformly via ``_resolve(...)`` so both work.
_MaybeAwaitable = Union[Optional[CachedVerify], Awaitable[Optional[CachedVerify]]]
_MaybeAwaitableNone = Union[None, Awaitable[None]]


@runtime_checkable
class VerifyCache(Protocol):
    """Pluggable cache backend.

    Only ``get`` / ``set`` / ``delete`` are required — they form the
    minimum surface for the gateway. ``peek`` and ``size`` are optional
    capabilities (matching the TS ``VerifyCache`` interface where they
    are marked ``peek?`` / ``size?``); the gateway probes via
    ``hasattr()`` at call sites and degrades gracefully when absent:

    * Missing ``peek``  → ``serve-stale`` fallback degrades to
      ``fail-fast`` (the gateway falls back to ``get``, which is
      allowed to purge stale).
    * Missing ``size``  → ``metrics().cache_size`` reports ``0``.

    Audit-driven (peer 8e446976 finding #1): the Protocol now reflects
    the actual contract rather than over-promising, so third-party
    backend implementers (Redis, CF KV, D1) get accurate types.
    """

    def get(self, key: str) -> _MaybeAwaitable: ...
    def set(self, key: str, value: CachedVerify) -> _MaybeAwaitableNone: ...
    def delete(self, key: str) -> _MaybeAwaitableNone: ...


class MemoryVerifyCache:
    """Insertion-order LRU. ``OrderedDict.move_to_end`` is the canonical
    zero-dependency LRU touch in CPython.
    """

    __slots__ = ("_store", "_max_entries", "_now")

    def __init__(
        self,
        *,
        max_entries: int = 10_000,
        now: Callable[[], int] | None = None,
    ) -> None:
        # type-rationale: ``now`` returns epoch milliseconds (matches the
        # TS SDK and the cache entry semantics). Default uses time.time_ns
        # divided by 1_000_000 so tests can inject a deterministic clock.
        from time import time_ns

        self._store: OrderedDict[str, CachedVerify] = OrderedDict()
        self._max_entries = max(1, max_entries)
        self._now = now or (lambda: time_ns() // 1_000_000)

    def get(self, key: str) -> CachedVerify | None:
        hit = self._store.get(key)
        if hit is None:
            return None
        if hit.expires_at_ms <= self._now():
            del self._store[key]
            return None
        # LRU touch: move to most-recent end of insertion order.
        self._store.move_to_end(key)
        return hit

    def peek(self, key: str) -> CachedVerify | None:
        """Returns the entry regardless of expiry. Does not LRU-touch."""
        return self._store.get(key)

    def set(self, key: str, value: CachedVerify) -> None:
        if key in self._store:
            del self._store[key]
        self._store[key] = value
        while len(self._store) > self._max_entries:
            # Evict oldest. OrderedDict iterates insertion order.
            oldest_key = next(iter(self._store))
            del self._store[oldest_key]

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def size(self) -> int:
        return len(self._store)


def build_cache_key(token: str, ctx: VerifyCacheContext | None = None) -> str:
    """Stable cache key. Hashing the token (rather than embedding it) means
    a cache dump from logs/metrics never leaks bearer credentials. Context
    fields are joined with NUL — illegal in HTTP header values, agent IDs,
    and every context field per the API schema — so ``("a","b")`` and
    ``("a|b","")`` cannot collide.
    """
    c = ctx or VerifyCacheContext()
    parts = [
        token,
        c.action or "",
        "" if c.amount is None else format_amount(c.amount),
        c.currency or "",
        c.merchant_id or "",
        c.merchant_domain or "",
    ]
    canonical = "\x00".join(parts).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def format_amount(amount: float) -> str:
    """Match the TS ``String(amount)`` representation for parity. Python's
    ``str(10.0)`` is ``'10.0'`` while JS ``String(10.0)`` is ``'10'`` — we
    align so the same (token, ctx) hits the same cache key in both SDKs.
    """
    if amount == int(amount):
        return str(int(amount))
    return repr(amount)


def clamp_ttl_ms(server_ttl_seconds: float, max_ttl_ms: int) -> int:
    """TTL clamp: server is authoritative, operator can tighten but never
    loosen. Server ``ttl`` is in seconds (per VerifyResult contract).
    """
    if server_ttl_seconds is None:
        return 0
    try:
        s = float(server_ttl_seconds)
    except (TypeError, ValueError):
        return 0
    if s <= 0 or not _is_finite(s):
        return 0
    server_ms = int(s * 1000)
    return max(0, min(server_ms, max_ttl_ms))


def _is_finite(x: float) -> bool:
    import math

    return math.isfinite(x)
