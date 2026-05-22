"""Tests for :mod:`aegis.webhook` — signature verifier.

Strategy: produce signatures with the EXACT primitives the API uses
(:mod:`hmac` / :mod:`hashlib`, hex digest, ``${ts}.${body}`` template) in
the test fixture. This spec doubles as a mini cross-language parity gate
— the canonical-vector test locks byte-equivalence with the TS SDK
(``packages/sdk-ts/src/webhook.spec.ts``).
"""

from __future__ import annotations

import hashlib
import hmac

import pytest

from aegis.webhook import (
    DEFAULT_TOLERANCE_SECONDS,
    WEBHOOK_DELIVERY_ID_HEADER,
    WEBHOOK_EVENT_HEADER,
    WEBHOOK_SIGNATURE_HEADER,
    VerifiedWebhook,
    WebhookSignatureInvalidError,
    WebhookSignatureMalformedError,
    WebhookTimestampError,
    verify_webhook_signature,
)

# ── Canonical cross-language parity vector ─────────────────────────────
# DO NOT EDIT without updating BOTH:
#   - tests/cross-package/sdk-ts-py-webhook-signature-parity.spec.ts
#     (the TS↔Py byte-equivalence gate)
#   - this fixture
# If you change ANY value here, the parity gate will fail until both
# sides agree on the new vector. That is the desired behaviour.
CANONICAL_SECRET = "whsec_parity_M_WEBHOOK_1_py"
CANONICAL_TS = 1716400000
CANONICAL_BODY = (
    '{"event":"aegis.agent.policy_expired","data":'
    '{"agentId":"agt_test","policyId":"pol_test"}}'
)
CANONICAL_SIGNATURE = (
    "t=1716400000,"
    "v1=f7427d8376187b0db3444e09a95c361dc65873a0723a4d10acaaf257d9f8e275"
)


def _make_signature(secret: str, ts: int, body: str) -> str:
    """Mirror of the API's ``WebhookDelivery.sign`` for in-test signing."""
    h = hmac.new(
        secret.encode("utf-8"), f"{ts}.{body}".encode(), hashlib.sha256
    ).hexdigest()
    return f"t={ts},v1={h}"


# ──────────────────────────────────────────────────────────────────────
# Header / constant exports
# ──────────────────────────────────────────────────────────────────────


def test_header_constants_match_api_emission() -> None:
    """The Python constants must match the literals the API stamps."""
    assert WEBHOOK_SIGNATURE_HEADER == "X-AEGIS-Signature"
    assert WEBHOOK_EVENT_HEADER == "X-AEGIS-Event"
    assert WEBHOOK_DELIVERY_ID_HEADER == "X-AEGIS-Delivery-Id"


def test_default_tolerance_matches_ts_sdk() -> None:
    """Operator-pinned default — locked at 300s across both SDKs."""
    assert DEFAULT_TOLERANCE_SECONDS == 300


# ──────────────────────────────────────────────────────────────────────
# Canonical cross-language parity
# ──────────────────────────────────────────────────────────────────────


def test_canonical_parity_vector_verifies() -> None:
    """The Py verifier must accept the canonical TS↔Py parity vector.

    This is the one test that, if it ever fails, means TS and Py have
    drifted out of byte-equivalence. Either side's template change, hex
    encoding change, algorithm swap, or secret-binding change would
    break this test before it broke a customer.
    """
    result = verify_webhook_signature(
        payload=CANONICAL_BODY,
        signature=CANONICAL_SIGNATURE,
        secret=CANONICAL_SECRET,
        now=lambda: float(CANONICAL_TS),
    )
    assert result == VerifiedWebhook(timestamp=CANONICAL_TS, skew_seconds=0)


def test_canonical_hmac_matches_independent_computation() -> None:
    """Belt-and-braces: independently re-compute the HMAC and compare hex.

    If the canonical vector is wrong (someone edited the secret/body/ts
    without updating the expected sig), this catches it before the
    verifier even runs.
    """
    msg = f"{CANONICAL_TS}.{CANONICAL_BODY}".encode()
    expected_hex = hmac.new(
        CANONICAL_SECRET.encode("utf-8"), msg, hashlib.sha256
    ).hexdigest()
    assert f"t={CANONICAL_TS},v1={expected_hex}" == CANONICAL_SIGNATURE


# ──────────────────────────────────────────────────────────────────────
# Happy path
# ──────────────────────────────────────────────────────────────────────


def test_verifies_a_fresh_signature() -> None:
    ts = 1_700_000_000
    body = '{"event":"test","data":{"x":1}}'
    secret = "whsec_x"
    sig = _make_signature(secret, ts, body)
    result = verify_webhook_signature(
        payload=body, signature=sig, secret=secret, now=lambda: float(ts)
    )
    assert result.timestamp == ts
    assert result.skew_seconds == 0


def test_positive_skew_within_tolerance_is_reported() -> None:
    ts = 1_700_000_000
    body = "{}"
    secret = "s"
    sig = _make_signature(secret, ts, body)
    # 120 seconds of late delivery — well inside 300s default.
    result = verify_webhook_signature(
        payload=body, signature=sig, secret=secret, now=lambda: float(ts + 120)
    )
    assert result.skew_seconds == 120


def test_negative_skew_within_tolerance_is_reported() -> None:
    """Negative skew = receiver clock is behind delivery (clock drift)."""
    ts = 1_700_000_000
    body = "{}"
    secret = "s"
    sig = _make_signature(secret, ts, body)
    result = verify_webhook_signature(
        payload=body, signature=sig, secret=secret, now=lambda: float(ts - 5)
    )
    assert result.skew_seconds == -5


def test_infinity_tolerance_disables_timestamp_check() -> None:
    """``float('inf')`` is the operator escape hatch for offline replay."""
    ts = 1_700_000_000
    body = "{}"
    secret = "s"
    sig = _make_signature(secret, ts, body)
    # 10 years late — would normally fail; passes with inf tolerance.
    result = verify_webhook_signature(
        payload=body,
        signature=sig,
        secret=secret,
        tolerance_seconds=float("inf"),
        now=lambda: float(ts + 60 * 60 * 24 * 365 * 10),
    )
    assert result.timestamp == ts


# ──────────────────────────────────────────────────────────────────────
# Timestamp tolerance
# ──────────────────────────────────────────────────────────────────────


def test_skew_past_tolerance_raises_with_forensics() -> None:
    ts = 1_700_000_000
    body = "{}"
    secret = "s"
    sig = _make_signature(secret, ts, body)
    receive_at = ts + 400  # 400s skew > 300s default tolerance.
    with pytest.raises(WebhookTimestampError) as excinfo:
        verify_webhook_signature(
            payload=body, signature=sig, secret=secret, now=lambda: float(receive_at)
        )
    err = excinfo.value
    assert err.signature_timestamp == ts
    assert err.received_at == receive_at
    assert err.tolerance_seconds == 300
    assert err.status_code == 400


def test_custom_tolerance_window_honored() -> None:
    ts = 1_700_000_000
    body = "{}"
    secret = "s"
    sig = _make_signature(secret, ts, body)
    # 90s skew — outside 60s custom window.
    with pytest.raises(WebhookTimestampError):
        verify_webhook_signature(
            payload=body,
            signature=sig,
            secret=secret,
            tolerance_seconds=60,
            now=lambda: float(ts + 90),
        )


# ──────────────────────────────────────────────────────────────────────
# Header parsing — malformed cases
# ──────────────────────────────────────────────────────────────────────


def test_missing_t_segment_raises_malformed() -> None:
    with pytest.raises(WebhookSignatureMalformedError, match="missing required 't="):
        verify_webhook_signature(payload="x", signature="v1=deadbeef", secret="s")


def test_missing_v1_segment_raises_malformed() -> None:
    with pytest.raises(WebhookSignatureMalformedError, match="missing required 'v1="):
        verify_webhook_signature(
            payload="x", signature="t=1700000000", secret="s", now=lambda: 1_700_000_000.0
        )


def test_non_integer_t_raises_malformed() -> None:
    with pytest.raises(WebhookSignatureMalformedError, match="'t' must be"):
        verify_webhook_signature(
            payload="x", signature="t=not_a_number,v1=deadbeef", secret="s"
        )


def test_odd_length_hex_v1_raises_malformed() -> None:
    with pytest.raises(WebhookSignatureMalformedError, match="even-length hex"):
        verify_webhook_signature(
            payload="x",
            signature="t=1700000000,v1=abc",
            secret="s",
            now=lambda: 1_700_000_000.0,
        )


def test_non_hex_v1_raises_malformed() -> None:
    with pytest.raises(WebhookSignatureMalformedError, match="even-length hex"):
        verify_webhook_signature(
            payload="x",
            signature="t=1700000000,v1=zzzz",
            secret="s",
            now=lambda: 1_700_000_000.0,
        )


def test_unknown_segments_are_ignored_for_forward_compat() -> None:
    """A future v2 segment must NOT break v1 verification."""
    ts = 1_700_000_000
    body = "{}"
    secret = "s"
    legitimate_v1 = _make_signature(secret, ts, body).split(",")[1]
    header = f"t={ts},v2=futurething,{legitimate_v1},unknown=xyz"
    result = verify_webhook_signature(
        payload=body, signature=header, secret=secret, now=lambda: float(ts)
    )
    assert result.timestamp == ts


# ──────────────────────────────────────────────────────────────────────
# Signature validity
# ──────────────────────────────────────────────────────────────────────


def test_wrong_secret_raises_invalid() -> None:
    ts = 1_700_000_000
    body = "{}"
    sig = _make_signature("right_secret", ts, body)
    with pytest.raises(WebhookSignatureInvalidError, match="no v1= segment verified"):
        verify_webhook_signature(
            payload=body, signature=sig, secret="wrong_secret", now=lambda: float(ts)
        )


def test_modified_payload_raises_invalid() -> None:
    ts = 1_700_000_000
    secret = "s"
    sig = _make_signature(secret, ts, '{"event":"original"}')
    with pytest.raises(WebhookSignatureInvalidError):
        verify_webhook_signature(
            payload='{"event":"tampered"}',
            signature=sig,
            secret=secret,
            now=lambda: float(ts),
        )


def test_wrong_template_separator_raises_invalid() -> None:
    """Catches the partial-refactor case where API ships colon vs dot."""
    ts = 1_700_000_000
    body = '{"event":"x"}'
    secret = "s"
    # Build a signature using the WRONG template (colon vs dot).
    wrong_hmac = hmac.new(
        secret.encode("utf-8"), f"{ts}:{body}".encode(), hashlib.sha256
    ).hexdigest()
    sig = f"t={ts},v1={wrong_hmac}"
    with pytest.raises(WebhookSignatureInvalidError):
        verify_webhook_signature(
            payload=body, signature=sig, secret=secret, now=lambda: float(ts)
        )


def test_wrong_algorithm_raises_invalid() -> None:
    """An attacker emitting SHA-512 must be rejected — algorithm is locked at SHA-256."""
    ts = 1_700_000_000
    body = '{"event":"x"}'
    secret = "s"
    sha512_hmac = hmac.new(
        secret.encode("utf-8"), f"{ts}.{body}".encode(), hashlib.sha512
    ).hexdigest()
    sig = f"t={ts},v1={sha512_hmac}"
    with pytest.raises(WebhookSignatureInvalidError):
        verify_webhook_signature(
            payload=body, signature=sig, secret=secret, now=lambda: float(ts)
        )


# ──────────────────────────────────────────────────────────────────────
# Key rotation (multi-v1)
# ──────────────────────────────────────────────────────────────────────


def test_accepts_v1_from_either_secret_during_rotation() -> None:
    """During key rotation, the API emits two v1= segments; either should pass."""
    ts = 1_700_000_000
    body = "{}"
    secret_old = "old_secret"
    secret_new = "new_secret"
    sig_old = hmac.new(
        secret_old.encode("utf-8"), f"{ts}.{body}".encode(), hashlib.sha256
    ).hexdigest()
    sig_new = hmac.new(
        secret_new.encode("utf-8"), f"{ts}.{body}".encode(), hashlib.sha256
    ).hexdigest()
    header = f"t={ts},v1={sig_old},v1={sig_new}"

    # Customer holding the OLD secret accepts.
    r_old = verify_webhook_signature(
        payload=body, signature=header, secret=secret_old, now=lambda: float(ts)
    )
    assert r_old.timestamp == ts

    # Customer holding the NEW secret accepts.
    r_new = verify_webhook_signature(
        payload=body, signature=header, secret=secret_new, now=lambda: float(ts)
    )
    assert r_new.timestamp == ts


# ──────────────────────────────────────────────────────────────────────
# Constant-time discipline — sanity check
# ──────────────────────────────────────────────────────────────────────


def test_uses_hmac_compare_digest_not_eq() -> None:
    """The module source uses ``hmac.compare_digest`` and never ``==``.

    Belt-and-braces — if a future refactor accidentally introduces
    ``expected == candidate`` comparison, this test catches it. The #1
    webhook-SDK CVE pattern is non-constant-time string equality.
    """
    import inspect

    from aegis import webhook as webhook_module

    src = inspect.getsource(webhook_module)
    assert "hmac.compare_digest" in src, "must use constant-time compare"
    # Allow `==` in comparisons OTHER than the candidate↔expected HMAC compare.
    # Quick guard: no line directly compares ``expected == candidate`` or vv.
    bad_patterns = [
        "expected == candidate",
        "candidate == expected",
        "expected != candidate",
    ]
    for pattern in bad_patterns:
        assert pattern not in src, f"forbidden non-constant-time compare: {pattern!r}"
