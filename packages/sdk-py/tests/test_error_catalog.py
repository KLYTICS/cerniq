"""Tests for the generated error catalog and the retry helpers built on it."""

from __future__ import annotations

import pytest

from aegis._http import HttpClient, _parse_retry_after
from aegis.error_catalog import GENERATED_ERROR_CATALOG


class _FakeResponse:
    """Minimal stand-in for ``httpx.Response`` for the catalog helpers."""

    def __init__(self, *, body: dict | None = None, headers: dict | None = None) -> None:
        self._body = body
        self.headers = headers or {}

    def json(self) -> object:
        if self._body is None:
            raise ValueError("no body")
        return self._body


def test_catalog_is_non_empty_and_keyed_by_code() -> None:
    assert len(GENERATED_ERROR_CATALOG) > 0
    for code, entry in GENERATED_ERROR_CATALOG.items():
        assert entry["code"] == code
        assert "className" in entry
        assert "httpStatus" in entry
        assert "retryable" in entry
        assert "customerMessage" in entry
        assert "category" in entry
        # Codes are stable lower-snake-case.
        assert code.islower()
        assert " " not in code


def test_retryable_entries_declare_backoff() -> None:
    for entry in GENERATED_ERROR_CATALOG.values():
        if entry.get("retryable"):
            assert "backoff" in entry, f"{entry['code']} retryable but missing backoff"


def test_canonical_denial_codes_present() -> None:
    canonical = {
        "agent_not_found",
        "agent_revoked",
        "invalid_signature",
        "policy_revoked",
        "policy_expired",
        "scope_not_granted",
        "spend_limit_exceeded",
        "trust_score_too_low",
        "anomaly_flagged",
    }
    missing = canonical - set(GENERATED_ERROR_CATALOG.keys())
    assert not missing, f"denial codes missing from catalog: {missing}"


def test_known_entries_have_expected_status_and_retry() -> None:
    rl = GENERATED_ERROR_CATALOG["rate_limited"]
    assert rl["httpStatus"] == 429
    assert rl["retryable"] is True
    assert rl["backoff"] == "on_retry_after_header"

    forbidden = GENERATED_ERROR_CATALOG["forbidden"]
    assert forbidden["httpStatus"] == 403
    assert forbidden["retryable"] is False


# ── HttpClient catalog helpers ───────────────────────────────


def test_extract_catalog_code_from_top_level() -> None:
    resp = _FakeResponse(body={"code": "rate_limited", "message": "slow"})
    assert HttpClient._extract_catalog_code(resp) == "rate_limited"  # type: ignore[arg-type]


def test_extract_catalog_code_from_details() -> None:
    resp = _FakeResponse(body={"details": {"code": "internal_error"}})
    assert HttpClient._extract_catalog_code(resp) == "internal_error"  # type: ignore[arg-type]


def test_extract_catalog_code_unknown_returns_none() -> None:
    resp = _FakeResponse(body={"code": "definitely_not_real"})
    assert HttpClient._extract_catalog_code(resp) is None  # type: ignore[arg-type]


def test_extract_catalog_code_when_body_unparseable() -> None:
    resp = _FakeResponse(body=None)
    assert HttpClient._extract_catalog_code(resp) is None  # type: ignore[arg-type]


def test_catalog_says_retry_uses_catalog_when_code_known() -> None:
    # 429 with rate_limited code → retry per catalog
    assert HttpClient._catalog_says_retry("rate_limited", 429) is True
    # 403 forbidden → catalog says NO retry, even though we sometimes might.
    assert HttpClient._catalog_says_retry("forbidden", 403) is False


def test_catalog_says_retry_falls_back_to_5xx() -> None:
    # No code → preserve legacy "retry on 5xx" behavior
    assert HttpClient._catalog_says_retry(None, 500) is True
    assert HttpClient._catalog_says_retry(None, 503) is True
    assert HttpClient._catalog_says_retry(None, 400) is False


def test_delay_for_linear_schedule() -> None:
    # Construct a synthetic entry — we test the dispatch logic, not the
    # specific catalog values.
    code = "internal_error"  # exponential in the real catalog
    resp = _FakeResponse()
    delay0 = HttpClient._delay_for(code, resp, 0)  # type: ignore[arg-type]
    assert delay0 == 100
    delay1 = HttpClient._delay_for(code, resp, 1)  # type: ignore[arg-type]
    assert delay1 == 400


def test_delay_for_on_retry_after_header() -> None:
    resp = _FakeResponse(headers={"retry-after": "5"})
    delay = HttpClient._delay_for("rate_limited", resp, 0)  # type: ignore[arg-type]
    assert delay == 5_000


def test_delay_for_on_retry_after_header_caps_at_60s() -> None:
    resp = _FakeResponse(headers={"retry-after": "999"})
    delay = HttpClient._delay_for("rate_limited", resp, 0)  # type: ignore[arg-type]
    assert delay == 60_000


def test_delay_for_on_retry_after_header_missing_falls_back() -> None:
    resp = _FakeResponse(headers={})
    delay = HttpClient._delay_for("rate_limited", resp, 0)  # type: ignore[arg-type]
    assert delay == 100  # conservative fallback


def test_delay_for_unknown_code_uses_legacy_schedule() -> None:
    resp = _FakeResponse()
    delay = HttpClient._delay_for(None, resp, 0)  # type: ignore[arg-type]
    assert delay is not None
    assert delay > 0


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("3", 3.0),
        ("0", 0.0),
        ("", None),
        (None, None),
        ("garbage", None),
    ],
)
def test_parse_retry_after(header: str | None, expected: float | None) -> None:
    assert _parse_retry_after(header) == expected
