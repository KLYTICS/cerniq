"""``AsyncVerifyGateway`` — relying-party scaling wrapper around
``AsyncAegis.verify``.

Three primitives, composed in order on every call:

1. Cache lookup       — collapses repeat verifies of the same
   ``(token, ctx)`` within the server TTL window.
2. Single-flight      — multiple concurrent misses for the same key
   coalesce onto one in-flight network call (``asyncio.Task``).
3. Circuit breaker    — consecutive upstream failures fast-fail or
   serve cached-stale (operator-configurable) so a degraded API does
   not melt the caller.

Mirrors ``packages/sdk-ts/src/verify-gateway.ts`` line-for-line in
behavior. Additive only — the existing ``AsyncAegis`` is unchanged.
"""

from __future__ import annotations

import asyncio
import inspect
import secrets
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Literal

from .errors import AegisError, ServerError
from .models import VerifyResult
from .verify_cache import (
    CachedVerify,
    MemoryVerifyCache,
    VerifyCache,
    VerifyCacheContext,
    build_cache_key,
    clamp_ttl_ms,
)

if TYPE_CHECKING:
    from .client import AsyncAegis


BreakerState = Literal["closed", "open", "half-open"]
FallbackMode = Literal["fail-fast", "serve-stale"]


@dataclass(slots=True)
class VerifyGatewayHooks:
    """Fire-and-forget observability hooks. Must not raise."""

    on_hit: Callable[[str, VerifyResult], None] | None = None
    on_miss: Callable[[str], None] | None = None
    on_coalesce: Callable[[str, int], None] | None = None
    on_breaker_state_change: Callable[[BreakerState, BreakerState], None] | None = None
    on_stale: Callable[[str, VerifyResult], None] | None = None
    on_error: Callable[[AegisError], None] | None = None


@dataclass(slots=True)
class VerifyGatewayMetrics:
    state: BreakerState
    hits: int
    misses: int
    coalesced: int
    stale_served: int
    breaker_trips: int
    consecutive_failures: int
    cache_size: int


@dataclass(slots=True)
class VerifyGatewayOptions:
    cache: VerifyCache | None = None
    max_ttl_ms: int = 60_000
    negative_ttl_ms: int = 0
    breaker_threshold: int = 5
    breaker_cooldown_ms: int = 5_000
    fallback_mode: FallbackMode = "fail-fast"
    hooks: VerifyGatewayHooks = field(default_factory=VerifyGatewayHooks)
    now: Callable[[], int] | None = None


class AsyncVerifyGateway:
    """Drop-in replacement for ``aegis.verify(...)`` with cache + single-
    flight + circuit breaker. Identical kwargs to ``AsyncAegis.verify``.
    """

    __slots__ = (
        "_aegis",
        "_cache",
        "_max_ttl_ms",
        "_negative_ttl_ms",
        "_breaker_threshold",
        "_breaker_cooldown_ms",
        "_fallback_mode",
        "_hooks",
        "_now",
        "_inflight",
        "_inflight_waiters",
        "_breaker",
        "_consecutive_failures",
        "_opened_at",
        "_half_open_probe_in_flight",
        "_hits",
        "_misses",
        "_coalesced",
        "_stale_served",
        "_breaker_trips",
    )

    def __init__(
        self,
        aegis: "AsyncAegis",
        options: VerifyGatewayOptions | None = None,
    ) -> None:
        opts = options or VerifyGatewayOptions()
        self._aegis = aegis
        from time import time_ns

        self._now: Callable[[], int] = opts.now or (lambda: time_ns() // 1_000_000)
        self._cache: VerifyCache = opts.cache or MemoryVerifyCache(now=self._now)
        self._max_ttl_ms = opts.max_ttl_ms
        self._negative_ttl_ms = max(0, opts.negative_ttl_ms)
        self._breaker_threshold = max(1, opts.breaker_threshold)
        self._breaker_cooldown_ms = max(0, opts.breaker_cooldown_ms)
        self._fallback_mode: FallbackMode = opts.fallback_mode
        self._hooks = opts.hooks

        self._inflight: dict[str, asyncio.Task[VerifyResult]] = {}
        self._inflight_waiters: dict[str, int] = {}

        self._breaker: BreakerState = "closed"
        self._consecutive_failures = 0
        self._opened_at = 0
        self._half_open_probe_in_flight = False

        self._hits = 0
        self._misses = 0
        self._coalesced = 0
        self._stale_served = 0
        self._breaker_trips = 0

    @property
    def state(self) -> BreakerState:
        return self._breaker

    async def verify(
        self,
        token: str,
        *,
        action: str | None = None,
        amount: float | None = None,
        currency: str | None = None,
        merchant_id: str | None = None,
        merchant_domain: str | None = None,
    ) -> VerifyResult:
        ctx = VerifyCacheContext(
            action=action,
            amount=amount,
            currency=currency,
            merchant_id=merchant_id,
            merchant_domain=merchant_domain,
        )
        key = build_cache_key(token, ctx)

        # 1. Cache lookup. Prefer ``peek`` so a stale entry survives for
        # the serve-stale breaker fallback below; gateway validates expiry.
        # P1 (R-006): never let a backend failure (Redis timeout, CF KV
        # unavailability, etc.) take down the verify path. Treat as miss.
        cached: CachedVerify | None
        try:
            if hasattr(self._cache, "peek"):
                cached = await _resolve(self._cache.peek(key))
            else:
                cached = await _resolve(self._cache.get(key))
        except Exception as err:  # noqa: BLE001
            cached = None
            if isinstance(err, AegisError):
                self._safe_hook("on_error", err)
        if cached is not None and cached.expires_at_ms > self._now():
            self._hits += 1
            self._safe_hook("on_hit", key, cached.result)
            return cached.result

        # 2. Breaker check before any network attempt.
        self._maybe_transition_breaker()
        if self._breaker == "open":
            return await self._handle_breaker_open(key, cached, state="open")
        # Half-open: serialize to a single probe. Secondary callers fall
        # through the same fallback path but get a state-accurate message.
        if self._breaker == "half-open" and self._half_open_probe_in_flight:
            return await self._handle_breaker_open(key, cached, state="half-open")
        i_am_probing = False
        if self._breaker == "half-open":
            self._half_open_probe_in_flight = True
            i_am_probing = True

        # 3. Single-flight coalesce.
        existing = self._inflight.get(key)
        if existing is not None:
            n = self._inflight_waiters.get(key, 1) + 1
            self._inflight_waiters[key] = n
            self._coalesced += 1
            self._safe_hook("on_coalesce", key, n)
            return await existing

        self._misses += 1
        self._safe_hook("on_miss", key)
        task = asyncio.ensure_future(self._execute_and_store(key, token, ctx))
        self._inflight[key] = task
        self._inflight_waiters[key] = 1
        try:
            return await task
        finally:
            self._inflight.pop(key, None)
            self._inflight_waiters.pop(key, None)
            # P1 (R-003): if WE set the half-open probe flag and the
            # task ended without record_success/record_failure
            # (cancellation, KeyboardInterrupt), clear so the breaker
            # doesn't deadlock in half-open. Idempotent.
            if i_am_probing and self._breaker == "half-open":
                self._half_open_probe_in_flight = False

    async def invalidate(
        self,
        token: str,
        *,
        action: str | None = None,
        amount: float | None = None,
        currency: str | None = None,
        merchant_id: str | None = None,
        merchant_domain: str | None = None,
    ) -> None:
        ctx = VerifyCacheContext(
            action=action,
            amount=amount,
            currency=currency,
            merchant_id=merchant_id,
            merchant_domain=merchant_domain,
        )
        await _resolve(self._cache.delete(build_cache_key(token, ctx)))

    def metrics(self) -> VerifyGatewayMetrics:
        return VerifyGatewayMetrics(
            state=self._breaker,
            hits=self._hits,
            misses=self._misses,
            coalesced=self._coalesced,
            stale_served=self._stale_served,
            breaker_trips=self._breaker_trips,
            consecutive_failures=self._consecutive_failures,
            cache_size=self._cache.size() if hasattr(self._cache, "size") else 0,
        )

    # ── internals ────────────────────────────────────────────

    async def _execute_and_store(
        self, key: str, token: str, ctx: VerifyCacheContext
    ) -> VerifyResult:
        try:
            result = await self._aegis.verify(
                token,
                action=ctx.action,
                amount=ctx.amount,
                currency=ctx.currency,
                merchant_id=ctx.merchant_id,
                merchant_domain=ctx.merchant_domain,
            )
        except asyncio.CancelledError:
            # P0 (R-001): cancellation must propagate cleanly without
            # breaker accounting or hook side-effects. Anything else
            # would corrupt structured-concurrency invariants in the
            # caller's task tree.
            raise
        except Exception as err:  # narrow from BaseException — see above.
            self._record_failure(err)
            raise

        self._record_success()
        ttl_ms = self._compute_ttl_ms(result)
        if ttl_ms > 0:
            # Negative-only jitter. Respects server TTL ceiling.
            jittered = int(ttl_ms * (1 - self._random_jitter_factor()))
            try:
                await _resolve(
                    self._cache.set(
                        key,
                        CachedVerify(
                            result=result,
                            expires_at_ms=self._now() + jittered,
                        ),
                    )
                )
            except Exception as err:  # noqa: BLE001
                # P1 (R-006): cache-backend errors must NOT lose a
                # successful verify. Surface via on_error and proceed.
                if isinstance(err, AegisError):
                    self._safe_hook("on_error", err)
        return result

    def _compute_ttl_ms(self, result: VerifyResult) -> int:
        if result.valid:
            return clamp_ttl_ms(result.ttl, self._max_ttl_ms)
        if self._negative_ttl_ms <= 0:
            return 0
        clamped = clamp_ttl_ms(result.ttl, self._max_ttl_ms)
        return min(self._negative_ttl_ms, clamped or self._negative_ttl_ms)

    def _record_success(self) -> None:
        self._consecutive_failures = 0
        self._half_open_probe_in_flight = False
        if self._breaker != "closed":
            self._transition_breaker("closed")

    def _record_failure(self, err: BaseException) -> None:
        if not isinstance(err, AegisError):
            return
        self._safe_hook("on_error", err)
        # P1 (R-005): structured by breaker state to prevent unbounded
        # accumulation of consecutive_failures while open, which would
        # cause re-trip cascades after recovery probes.
        if self._breaker == "half-open":
            # Probe failed: re-open with full cooldown, reset count.
            self._opened_at = self._now()
            self._half_open_probe_in_flight = False
            self._consecutive_failures = 0
            self._breaker_trips += 1
            self._transition_breaker("open")
            return
        if self._breaker == "open":
            # In-flight failures during open phase: don't accumulate.
            return
        # closed
        self._consecutive_failures += 1
        if self._consecutive_failures >= self._breaker_threshold:
            self._opened_at = self._now()
            self._breaker_trips += 1
            self._transition_breaker("open")

    def _maybe_transition_breaker(self) -> None:
        if self._breaker != "open":
            return
        if self._now() - self._opened_at >= self._breaker_cooldown_ms:
            self._transition_breaker("half-open")

    def _transition_breaker(self, to: BreakerState) -> None:
        if self._breaker == to:
            return
        previous = self._breaker
        self._breaker = to
        self._safe_hook("on_breaker_state_change", previous, to)

    async def _handle_breaker_open(
        self,
        key: str,
        cached: CachedVerify | None,
        *,
        state: BreakerState = "open",
    ) -> VerifyResult:
        if self._fallback_mode == "serve-stale" and cached is not None:
            self._stale_served += 1
            self._safe_hook("on_stale", key, cached.result)
            return cached.result
        if state == "half-open":
            message = (
                "AEGIS verify gateway breaker is half-open — a probe is "
                "already in flight; secondary callers are short-circuited "
                "until the probe resolves."
            )
        else:
            message = "AEGIS verify gateway breaker is open — upstream is failing."
        raise ServerError(message, status_code=503, request_id=None)

    def _random_jitter_factor(self) -> float:
        # secrets.randbits is the Python equivalent of Web Crypto
        # ``getRandomValues`` — cryptographic RNG. CLAUDE.md quality bar
        # forbids ``random.random()`` in identity/audit-adjacent paths.
        byte = secrets.randbits(8)
        return (byte / 255) * 0.1  # [0, 0.1]

    def _safe_hook(self, name: str, *args: Any) -> None:
        hook = getattr(self._hooks, name, None)
        if hook is None:
            return
        try:
            hook(*args)
        except Exception:  # noqa: BLE001 — hooks must never break the verify path
            pass


async def _resolve(value: Any) -> Any:
    """Await ``value`` if it is awaitable; return it directly otherwise.

    Lets ``VerifyCache`` implementations be sync (in-memory) or async
    (Redis, CF KV) without the gateway caring.
    """
    if inspect.isawaitable(value):
        return await value
    return value


class VerifyGateway:
    """Sync facade over :class:`AsyncVerifyGateway`.

    Mirrors the existing :class:`aegis.Aegis` / :class:`aegis.AsyncAegis`
    pattern. The KEY invariant this facade preserves: **cache and
    breaker state survives across calls**. The underlying
    :class:`AsyncVerifyGateway` is constructed once and reused; only
    the event loop is per-call (via ``asyncio.run``).

    Use this when you do not already have an event loop. For server
    code (FastAPI, ASGI), prefer :class:`AsyncVerifyGateway` directly —
    spinning up a fresh loop per call wastes cycles you don't need to.

    Note: single-flight coalescing has no effect under this facade
    because sync calls are serial by definition. Cache + breaker still
    deliver their full ROI.
    """

    __slots__ = ("_async_gateway",)

    def __init__(
        self,
        aegis: "AsyncAegis",
        options: VerifyGatewayOptions | None = None,
    ) -> None:
        self._async_gateway = AsyncVerifyGateway(aegis, options)

    @property
    def state(self) -> BreakerState:
        return self._async_gateway.state

    def verify(
        self,
        token: str,
        *,
        action: str | None = None,
        amount: float | None = None,
        currency: str | None = None,
        merchant_id: str | None = None,
        merchant_domain: str | None = None,
    ) -> VerifyResult:
        return asyncio.run(
            self._async_gateway.verify(
                token,
                action=action,
                amount=amount,
                currency=currency,
                merchant_id=merchant_id,
                merchant_domain=merchant_domain,
            )
        )

    def invalidate(
        self,
        token: str,
        *,
        action: str | None = None,
        amount: float | None = None,
        currency: str | None = None,
        merchant_id: str | None = None,
        merchant_domain: str | None = None,
    ) -> None:
        asyncio.run(
            self._async_gateway.invalidate(
                token,
                action=action,
                amount=amount,
                currency=currency,
                merchant_id=merchant_id,
                merchant_domain=merchant_domain,
            )
        )

    def metrics(self) -> VerifyGatewayMetrics:
        return self._async_gateway.metrics()
