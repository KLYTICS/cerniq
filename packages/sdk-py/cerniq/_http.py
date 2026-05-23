"""Async HTTP layer for the CERNIQ SDK.

Wraps ``httpx.AsyncClient`` with:
- typed exceptions (mapped from the API's error envelope)
- request-id propagation (echoed from server, generated client-side if absent)
- retries on 5xx + connection errors with exponential backoff (250/500/1000 ms)
- per-request timeout
- ``X-CERNIQ-API-Key`` vs. ``X-CERNIQ-Verify-Key`` selection per call
"""

from __future__ import annotations

import asyncio
import json as _json
import uuid
from typing import Any, Final, Literal

import httpx

from ._constants import (
    CERNIQ_HEADER_API_KEY,
    CERNIQ_HEADER_REQUEST_ID,
    CERNIQ_HEADER_VERIFY_KEY,
    DEFAULT_BASE_URL,
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT_MS,
    RETRY_BACKOFF_MS,
)
from ._version import __version__
from .error_catalog import GENERATED_ERROR_CATALOG
from .errors import CerniqError, NetworkError, from_status

HttpMethod = Literal["GET", "POST", "PUT", "PATCH", "DELETE"]

_DEFAULT_USER_AGENT: Final[str] = f"cerniq-python/{__version__}"


class HttpClient:
    """Async HTTP transport for the CERNIQ API.

    Owns an ``httpx.AsyncClient`` unless one is injected. Construct with
    ``api_key=`` for management calls and / or ``verify_key=`` for relying-
    party verify calls. Both can be set at once (the SDK picks per call).
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        verify_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        user_agent: str | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if api_key is None and verify_key is None:
            raise CerniqError(
                "CERNIQ SDK requires at least one of api_key= or verify_key=.",
                code="AUTH_REQUIRED",
            )
        self._api_key = api_key
        self._verify_key = verify_key
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_ms / 1000.0
        self._user_agent = user_agent or _DEFAULT_USER_AGENT
        self._max_retries = max(0, max_retries)
        self._owns_client = client is None
        # http2 enabled when httpx[http2] is installed (it is; pinned in pyproject).
        self._client = client or httpx.AsyncClient(
            timeout=self._timeout_s,
            http2=True,
        )

    # ── lifecycle ────────────────────────────────────────────

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # ── core request ────────────────────────────────────────

    async def request(
        self,
        method: HttpMethod,
        path: str,
        *,
        body: Any = None,
        params: dict[str, Any] | None = None,
        verify_only: bool = False,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        """Send a request and return the parsed JSON body (or ``None`` on 204).

        Args:
            method: HTTP verb.
            path: Path under ``base_url`` (leading ``/`` allowed; both work).
            body: JSON-serializable body, or ``None``.
            params: Query string params. ``None`` values are dropped.
            verify_only: If True, send the verify key (``/verify`` endpoint
                takes either, but relying parties should use the verify key).
            extra_headers: Additional headers to merge onto the request.

        Raises:
            CerniqError: A typed subclass on HTTP failure.
            NetworkError: On connect / timeout failure that exhausts retries.
        """
        url = self._build_url(path)
        headers = self._build_headers(verify_only=verify_only, extra=extra_headers)

        # Drop None-valued params so they don't show up as ``?key=``.
        clean_params: dict[str, Any] | None = None
        if params:
            clean_params = {k: v for k, v in params.items() if v is not None}

        json_body: Any = body if body is not None else None

        last_exc: BaseException | None = None
        attempt = 0
        while True:
            try:
                response = await self._client.request(
                    method,
                    url,
                    json=json_body,
                    params=clean_params,
                    headers=headers,
                )
            except (httpx.TimeoutException, httpx.TransportError, httpx.ConnectError) as exc:
                last_exc = exc
                if attempt >= self._max_retries:
                    raise NetworkError(
                        f"CERNIQ request failed: {exc.__class__.__name__}: {exc}",
                        code="NETWORK_ERROR",
                    ) from exc
                await self._sleep_backoff(attempt)
                attempt += 1
                continue

            # Catalog-driven retry decision. We peek at the response body
            # (cheap — content is already in memory) so we can honor the
            # server's `retryable` declaration even on 4xx (e.g. 429).
            if attempt < self._max_retries:
                catalog_code = self._extract_catalog_code(response)
                if self._catalog_says_retry(catalog_code, response.status_code):
                    delay_ms = self._delay_for(catalog_code, response, attempt)
                    if delay_ms is not None:
                        await asyncio.sleep(delay_ms / 1000.0)
                        attempt += 1
                        continue

            if response.status_code == 204 or not response.content:
                if not response.is_success:
                    raise self._error_from_response(response, payload=None)
                return None

            payload = self._parse_payload(response)

            if not response.is_success:
                raise self._error_from_response(response, payload=payload)

            return payload

        # Unreachable — the loop always returns or raises.
        raise NetworkError(
            f"CERNIQ request retries exhausted ({last_exc!r})",
            code="NETWORK_ERROR",
        )

    # ── helpers ─────────────────────────────────────────────

    def _build_url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return f"{self._base_url}{path}"

    def _build_headers(
        self,
        *,
        verify_only: bool,
        extra: dict[str, str] | None,
    ) -> dict[str, str]:
        headers: dict[str, str] = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": self._user_agent,
            CERNIQ_HEADER_REQUEST_ID: uuid.uuid4().hex,
        }
        if verify_only:
            if not self._verify_key:
                raise CerniqError(
                    "verify() requires verify_key=; got api_key only.",
                    code="AUTH_REQUIRED",
                )
            headers[CERNIQ_HEADER_VERIFY_KEY] = self._verify_key
        else:
            if not self._api_key:
                raise CerniqError(
                    "Management calls require api_key=; got verify_key only.",
                    code="AUTH_REQUIRED",
                )
            headers[CERNIQ_HEADER_API_KEY] = self._api_key
        if extra:
            headers.update(extra)
        return headers

    @staticmethod
    def _parse_payload(response: httpx.Response) -> Any:
        ctype = response.headers.get("content-type", "")
        if "application/json" in ctype:
            try:
                return response.json()
            except (ValueError, _json.JSONDecodeError):
                return response.text
        return response.text

    @staticmethod
    def _error_from_response(response: httpx.Response, *, payload: Any) -> CerniqError:
        request_id = response.headers.get(CERNIQ_HEADER_REQUEST_ID)
        message = f"CERNIQ request failed ({response.status_code})"
        code: str | None = None
        details: Any = None

        if isinstance(payload, dict):
            # Server envelope shape: { error, message, statusCode, requestId, details? }
            msg = payload.get("message")
            if isinstance(msg, str) and msg:
                message = msg
            err = payload.get("error")
            if isinstance(err, str) and err:
                code = err
            req_id_body = payload.get("requestId")
            if isinstance(req_id_body, str) and req_id_body:
                request_id = req_id_body
            details = payload.get("details")
        elif isinstance(payload, str) and payload:
            message = payload

        return from_status(
            response.status_code,
            message=message,
            request_id=request_id,
            code=code,
            details=details,
        )

    @staticmethod
    async def _sleep_backoff(attempt: int) -> None:
        idx = min(attempt, len(RETRY_BACKOFF_MS) - 1)
        await asyncio.sleep(RETRY_BACKOFF_MS[idx] / 1000.0)

    # ── catalog-driven retry helpers ───────────────────────

    @staticmethod
    def _extract_catalog_code(response: httpx.Response) -> str | None:
        """Pull the stable lower-snake-case `code` from the response body.

        Tries top-level ``code`` first, then ``details.code``. Falls back
        to ``error`` when it happens to match a catalog code directly.
        """
        try:
            body = response.json()
        except (ValueError, _json.JSONDecodeError):
            return None
        if not isinstance(body, dict):
            return None
        code = body.get("code")
        if isinstance(code, str) and code in GENERATED_ERROR_CATALOG:
            return code
        details = body.get("details")
        if isinstance(details, dict):
            inner = details.get("code")
            if isinstance(inner, str) and inner in GENERATED_ERROR_CATALOG:
                return inner
        err = body.get("error")
        if isinstance(err, str) and err in GENERATED_ERROR_CATALOG:
            return err
        return None

    @staticmethod
    def _catalog_says_retry(catalog_code: str | None, status_code: int) -> bool:
        """Decide whether to retry based on the catalog. Falls back to 5xx-is-retryable."""
        if catalog_code is not None:
            entry = GENERATED_ERROR_CATALOG.get(catalog_code)
            if entry is not None:
                return bool(entry.get("retryable", False))
        # No catalog code present (older server, non-CERNIQ error). Preserve
        # the previous "retry on 5xx" behavior so we don't regress.
        return status_code >= 500

    @staticmethod
    def _delay_for(catalog_code: str | None, response: httpx.Response, attempt: int) -> int | None:
        """Compute a delay in ms per the catalog-declared backoff strategy.

        Returns ``None`` to signal "do not retry".
        """
        backoff: str | None = None
        if catalog_code is not None:
            entry = GENERATED_ERROR_CATALOG.get(catalog_code)
            if entry is not None:
                # entry.get returns Optional[str] for the optional 'backoff' field.
                backoff = entry.get("backoff")
        if backoff is None:
            # Legacy path — preserve the old fixed schedule.
            idx = min(attempt, len(RETRY_BACKOFF_MS) - 1)
            return RETRY_BACKOFF_MS[idx]
        if backoff == "none":
            return None
        if backoff == "linear":
            schedule = (100, 200, 400)
            return schedule[min(attempt, len(schedule) - 1)]
        if backoff == "exponential":
            schedule = (100, 400, 1_600)
            return schedule[min(attempt, len(schedule) - 1)]
        if backoff == "on_retry_after_header":
            header = response.headers.get("retry-after")
            seconds = _parse_retry_after(header)
            if seconds is None:
                # Server said "honor it" but didn't provide one — be polite.
                return 100
            return min(int(seconds * 1000), 60_000)
        # Unknown strategy — refuse to retry rather than guessing.
        return None


def _parse_retry_after(value: str | None) -> float | None:
    """Parse a Retry-After header into seconds (int or HTTP date)."""
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    if value.isdigit():
        return float(value)
    # HTTP date.
    from email.utils import parsedate_to_datetime
    from datetime import datetime, timezone

    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = (dt - datetime.now(timezone.utc)).total_seconds()
    return max(0.0, delta)
