"""Tests for the verify-result cache primitives. Mirrors
``packages/sdk-ts/src/cache.spec.ts``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

from aegis import (
    CachedVerify,
    MemoryVerifyCache,
    VerifyCacheContext,
    VerifyResult,
    build_cache_key,
    clamp_ttl_ms,
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


class TestBuildCacheKey:
    def test_stable_hex_digest(self) -> None:
        ctx = VerifyCacheContext(action="pay", amount=10, currency="USD")
        k = build_cache_key("tok", ctx)
        assert len(k) == 64
        assert all(c in "0123456789abcdef" for c in k)
        assert build_cache_key("tok", ctx) == k

    def test_differs_by_context(self) -> None:
        a = build_cache_key("tok", VerifyCacheContext(amount=10))
        b = build_cache_key("tok", VerifyCacheContext(amount=11))
        assert a != b

    def test_no_separator_injection_collision(self) -> None:
        # If we joined with `|`, these would collide. NUL separator prevents it.
        a = build_cache_key("tok", VerifyCacheContext(action="a", merchant_id="b"))
        b = build_cache_key(
            "tok", VerifyCacheContext(action="a|b", merchant_id="")
        )
        assert a != b

    def test_amount_format_parity_with_ts_in_currency_range(self) -> None:
        """Auditor peer 8e446976 finding #2: ``repr(1e20)`` diverges from
        JS ``String(1e20)`` at scientific-notation magnitudes. Lock the
        contract for realistic currency amounts (≤ 1e9 USD covers any
        plausible transaction). Cross-language cache keys agree in this
        domain even though they could diverge at astronomical magnitudes.
        """
        from aegis.verify_cache import format_amount

        # Whole numbers: same as JS String(n) ("10" not "10.0").
        assert format_amount(10) == "10"
        assert format_amount(10.0) == "10"
        assert format_amount(0) == "0"
        # Sub-cent precision: matches JS String() output for these values.
        assert format_amount(10.5) == "10.5"
        assert format_amount(0.01) == "0.01"
        # Bound the parity guarantee: under 1e9 (one billion units of
        # any currency), the formats agree — well above any realistic
        # transaction amount. Above that, divergence is acceptable and
        # caller is on notice via this test.
        assert format_amount(999_999_999) == "999999999"


class TestClampTtlMs:
    def test_below_ceiling(self) -> None:
        assert clamp_ttl_ms(10, 60_000) == 10_000

    def test_clamps_to_ceiling(self) -> None:
        assert clamp_ttl_ms(3600, 60_000) == 60_000

    def test_zero_or_negative(self) -> None:
        assert clamp_ttl_ms(0, 60_000) == 0
        assert clamp_ttl_ms(-1, 60_000) == 0

    def test_non_finite(self) -> None:
        assert clamp_ttl_ms(float("nan"), 60_000) == 0
        assert clamp_ttl_ms(float("inf"), 60_000) == 0


class TestMemoryVerifyCache:
    def test_get_returns_value_before_expiry(self) -> None:
        now = [0]
        cache = MemoryVerifyCache(now=lambda: now[0])
        cache.set("k", CachedVerify(result=_result(), expires_at_ms=100))
        now[0] = 50
        hit = cache.get("k")
        assert hit is not None

    def test_evicts_after_expiry(self) -> None:
        now = [0]
        cache = MemoryVerifyCache(now=lambda: now[0])
        cache.set("k", CachedVerify(result=_result(), expires_at_ms=100))
        now[0] = 100
        assert cache.get("k") is None
        assert cache.size() == 0

    def test_lru_evicts_oldest_past_capacity(self) -> None:
        cache = MemoryVerifyCache(max_entries=2)
        for k in ("a", "b", "c"):
            cache.set(k, CachedVerify(result=_result(), expires_at_ms=2**62))
        assert cache.get("a") is None
        assert cache.get("b") is not None
        assert cache.get("c") is not None

    def test_lru_touch_on_get_keeps_recent_alive(self) -> None:
        cache = MemoryVerifyCache(max_entries=2)
        cache.set("a", CachedVerify(result=_result(), expires_at_ms=2**62))
        cache.set("b", CachedVerify(result=_result(), expires_at_ms=2**62))
        cache.get("a")  # touch
        cache.set("c", CachedVerify(result=_result(), expires_at_ms=2**62))
        assert cache.get("a") is not None
        assert cache.get("b") is None
        assert cache.get("c") is not None

    def test_peek_returns_stale_entry(self) -> None:
        now = [0]
        cache = MemoryVerifyCache(now=lambda: now[0])
        cache.set("k", CachedVerify(result=_result(), expires_at_ms=100))
        now[0] = 200
        # get purges stale; peek does not.
        assert cache.peek("k") is not None
        assert cache.get("k") is None
