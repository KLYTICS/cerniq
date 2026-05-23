"""Redis adapter for ``VerifyCache``. Mirrors
``packages/sdk-ts/src/adapters/redis.ts``.

Duck-typed against any client that exposes async ``get`` / ``set`` /
``delete`` (matching ``redis.asyncio.Redis`` from redis-py 5.x or
anything that quacks like it). No hard dependency on redis-py — the
package consumer installs their preferred client.

Design contract — validated against
``apps/api/src/common/redis/redis.service.ts``:

* **Fail-soft.** Redis miss / timeout / decode error returns ``None``;
  the gateway then falls through to the network. Backend wobbles never
  cascade into denied verifies.
* **TTL in seconds** (Redis native). Adapter computes
  ``ceil((expires_at_ms − now) / 1000)`` from the gateway's epoch-ms.
* **Key namespace**: ``aegis:verify:<sha256>`` — matches the existing
  ``namespace:resource:id`` colon convention.
* **on_error hook** surfaces backend errors so operators can alarm.
"""

from __future__ import annotations

import json
import math
from time import time_ns
from typing import Any, Awaitable, Callable, Literal, Optional, Protocol, runtime_checkable

from ..models import VerifyResult
from ..verify_cache import CachedVerify

DEFAULT_PREFIX = "aegis:verify:"

CacheOp = Literal["get", "set", "delete"]


@runtime_checkable
class RedisLike(Protocol):
    """Minimal async Redis surface this adapter relies on. Matches
    ``redis.asyncio.Redis`` and most async Upstash shims.
    """

    def get(self, key: str) -> Awaitable[Optional[bytes | str]]: ...
    def set(
        self,
        key: str,
        value: str | bytes,
        *,
        ex: int | None = ...,
    ) -> Awaitable[Any]: ...
    def delete(self, *keys: str) -> Awaitable[Any]: ...


class RedisVerifyCache:
    """Async Redis-backed ``VerifyCache`` for ``AsyncVerifyGateway``."""

    __slots__ = ("_client", "_prefix", "_on_error", "_now")

    def __init__(
        self,
        client: Any,  # duck-typed; constrained by RedisLike Protocol at usage
        *,
        key_prefix: str = DEFAULT_PREFIX,
        on_error: Callable[[CacheOp, BaseException, str], None] | None = None,
        now: Callable[[], int] | None = None,
    ) -> None:
        self._client = client
        self._prefix = key_prefix
        self._on_error = on_error
        self._now = now or (lambda: time_ns() // 1_000_000)

    async def get(self, key: str) -> CachedVerify | None:
        full_key = self._prefix + key
        try:
            raw = await self._client.get(full_key)
        except Exception as err:  # noqa: BLE001 — fail-soft contract
            self._safe_on_error("get", err, full_key)
            return None
        if raw is None:
            return None
        return self._decode(raw, full_key)

    async def peek(self, key: str) -> CachedVerify | None:
        # Redis enforces TTL natively — peek and get are equivalent at
        # the backend. The gateway still validates expires_at itself for
        # the half-open serve-stale window.
        return await self.get(key)

    async def set(self, key: str, value: CachedVerify) -> None:
        full_key = self._prefix + key
        ttl_sec = max(1, math.ceil((value.expires_at_ms - self._now()) / 1000))
        try:
            payload = json.dumps(
                {
                    "result": value.result.model_dump(by_alias=True, mode="json"),
                    "expiresAt": value.expires_at_ms,
                }
            )
        except Exception as err:  # noqa: BLE001
            self._safe_on_error("set", err, full_key)
            return
        try:
            # ``ex=`` is the canonical kwarg in redis-py 5.x. Most async
            # shims (aioredis 2.x, Upstash) accept it too.
            await self._client.set(full_key, payload, ex=ttl_sec)
        except Exception as err:  # noqa: BLE001
            self._safe_on_error("set", err, full_key)

    async def delete(self, key: str) -> None:
        full_key = self._prefix + key
        try:
            await self._client.delete(full_key)
        except Exception as err:  # noqa: BLE001
            self._safe_on_error("delete", err, full_key)

    def _decode(self, raw: bytes | str, full_key: str) -> CachedVerify | None:
        try:
            text = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw
            parsed = json.loads(text)
            if (
                not isinstance(parsed, dict)
                or "result" not in parsed
                or not isinstance(parsed.get("expiresAt"), int)
            ):
                raise TypeError("malformed VerifyCache payload")
            result = VerifyResult.model_validate(parsed["result"])
            return CachedVerify(result=result, expires_at_ms=parsed["expiresAt"])
        except Exception as err:  # noqa: BLE001
            self._safe_on_error("get", err, full_key)
            return None

    def _safe_on_error(self, op: CacheOp, err: BaseException, key: str) -> None:
        if self._on_error is None:
            return
        try:
            self._on_error(op, err, key)
        except Exception:  # noqa: BLE001 — hooks must never break the verify path
            pass
