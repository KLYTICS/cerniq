"""Tests for the Redis adapter. Uses a duck-typed in-memory fake to
avoid pulling redis-py into the test deps.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest

from aegis import CachedVerify, VerifyResult
from aegis.adapters import RedisVerifyCache


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


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.last_set: tuple[str, str, int | None] | None = None
        self.throw_on: str | None = None

    async def get(self, key: str) -> str | None:
        if self.throw_on == "get":
            raise RuntimeError("redis down")
        return self.store.get(key)

    async def set(self, key: str, value: str | bytes, *, ex: int | None = None) -> str:
        if self.throw_on == "set":
            raise RuntimeError("redis down")
        text = value.decode() if isinstance(value, (bytes, bytearray)) else value
        self.last_set = (key, text, ex)
        self.store[key] = text
        return "OK"

    async def delete(self, *keys: str) -> int:
        if self.throw_on == "delete":
            raise RuntimeError("redis down")
        n = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                n += 1
        return n


@pytest.mark.asyncio
async def test_round_trip() -> None:
    fake = FakeRedis()
    now = [1_000]
    cache = RedisVerifyCache(fake, now=lambda: now[0])
    entry = CachedVerify(result=_result(), expires_at_ms=now[0] + 30_000)
    await cache.set("abc", entry)
    hit = await cache.get("abc")
    assert hit is not None
    assert hit.result.valid is True
    assert hit.expires_at_ms == now[0] + 30_000


@pytest.mark.asyncio
async def test_set_uses_ex_kwarg_with_seconds_ttl() -> None:
    fake = FakeRedis()
    cache = RedisVerifyCache(fake, now=lambda: 0)
    await cache.set("k", CachedVerify(result=_result(), expires_at_ms=30_000))
    assert fake.last_set is not None
    assert fake.last_set[0] == "aegis:verify:k"
    assert fake.last_set[2] == 30  # 30s


@pytest.mark.asyncio
async def test_namespaces_keys_with_prefix() -> None:
    fake = FakeRedis()
    cache = RedisVerifyCache(fake, key_prefix="rp1:verify:")
    await cache.set(
        "xyz",
        CachedVerify(result=_result(), expires_at_ms=10**18),
    )
    assert "rp1:verify:xyz" in fake.store


@pytest.mark.asyncio
async def test_fails_soft_on_get_error() -> None:
    fake = FakeRedis()
    fake.throw_on = "get"
    errors: list[tuple[str, str]] = []
    cache = RedisVerifyCache(
        fake, on_error=lambda op, _err, key: errors.append((op, key))
    )
    hit = await cache.get("k")
    assert hit is None
    assert errors[0][0] == "get"


@pytest.mark.asyncio
async def test_fails_soft_on_set_error() -> None:
    fake = FakeRedis()
    fake.throw_on = "set"
    errors: list[str] = []
    cache = RedisVerifyCache(fake, on_error=lambda op, *_: errors.append(op))
    # Must not raise.
    await cache.set(
        "k", CachedVerify(result=_result(), expires_at_ms=10**18)
    )
    assert "set" in errors


@pytest.mark.asyncio
async def test_returns_none_on_malformed_payload() -> None:
    fake = FakeRedis()
    fake.store["aegis:verify:bad"] = "not-json{{{"
    errors: list[str] = []
    cache = RedisVerifyCache(fake, on_error=lambda op, *_: errors.append(op))
    hit = await cache.get("bad")
    assert hit is None
    assert "get" in errors


@pytest.mark.asyncio
async def test_handles_bytes_response_from_client() -> None:
    """redis-py returns bytes by default unless ``decode_responses=True``."""

    class BytesRedis(FakeRedis):
        async def get(self, key: str) -> bytes | None:
            v = self.store.get(key)
            return v.encode() if v is not None else None

    fake = BytesRedis()
    cache = RedisVerifyCache(fake, now=lambda: 0)
    await cache.set("k", CachedVerify(result=_result(), expires_at_ms=30_000))
    hit = await cache.get("k")
    assert hit is not None
    assert hit.result.valid is True
