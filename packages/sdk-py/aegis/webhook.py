"""Webhook signature verification — Python mirror of ``packages/sdk-ts/src/webhook.ts``.

AEGIS delivers webhooks with three headers::

    X-AEGIS-Signature:    t=<unix-ts>,v1=<hmac-sha256-hex(`${ts}.${body}`)>
    X-AEGIS-Event:        <event-type>      (e.g. ``aegis.agent.policy_expired``)
    X-AEGIS-Delivery-Id:  <ulid>            (unique per delivery attempt)

The signature header is Stripe-shape on purpose. It composes a unix
timestamp plus one or more HMAC-SHA-256 signatures (``v1=<hex>``) so:

- The timestamp lets receivers reject stale replays without storing
  every delivery id forever.
- Multiple ``v1=`` segments support key rotation: subscribe with two
  secrets during cutover; signature passes if ANY ``v1=`` verifies.
  (The API currently emits exactly one — this SDK parses permissively
  so rotation lands without a customer upgrade.)

**SECURITY CONSTRAINTS** (these are NOT optional):

1. **Constant-time comparison.** We use :func:`hmac.compare_digest` which
   is constant-time by definition — never compare HMAC hex strings with
   ``==``. That is the #1 webhook-SDK CVE pattern.
2. **Timestamp tolerance.** A captured-and-replayed signature stays
   valid forever without a tolerance window. Default = 5 min;
   operator can tune via ``tolerance_seconds``.
3. **Raw body.** The caller MUST pass the unparsed request body string.
   ``json.dumps(json.loads(body))`` does not round-trip; key ordering,
   whitespace, and number formatting all matter.

Source-of-truth contract: API signs via
``WebhookDelivery.sign(secret, ts, body)`` at
``apps/api/src/modules/webhooks/webhook.delivery.ts:438``. Cross-package
parity is enforced by ``tests/cross-package/webhook-signature-parity.spec.ts``
(API↔TS-SDK) and ``tests/cross-package/sdk-ts-py-webhook-signature-parity.spec.ts``
(TS-SDK↔Py-SDK).

This module is a byte-equivalent mirror of the TypeScript verifier. The
canonical parity vector ``test_canonical_parity_vector`` in
``tests/test_webhook.py`` locks the contract — flip a single byte in
either implementation and that test fails.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

from .errors import AegisError

# ── Wire-header constants — mirror packages/sdk-ts/src/webhook.ts:40-42 ──
WEBHOOK_SIGNATURE_HEADER: Final[str] = "X-AEGIS-Signature"
WEBHOOK_EVENT_HEADER: Final[str] = "X-AEGIS-Event"
WEBHOOK_DELIVERY_ID_HEADER: Final[str] = "X-AEGIS-Delivery-Id"

# ── Operator-pinned default tolerance window ────────────────────────────
# 300 seconds (5 minutes), matching the TS default. Pinned 2026-05-22 to
# Stripe's industry default. Balances replay defense vs delivery jitter
# from BullMQ exponential-backoff retries. A captured signature remains
# valid for 5 minutes after delivery — receivers wanting tighter defense
# (e.g. on fraud-confirm or KMS-rotation events) can override per call.
#
# Trade-offs considered and rejected:
#   - 60s (strict): rejects legitimate retries past the first backoff
#     window; would fire false security alerts.
#   - 900s (lenient): doubles replay attack surface for a tiny delivery-
#     reliability gain.
#
# Callers can always override per call via ``tolerance_seconds``. To
# change the default, update this constant AND ``test_webhook.py`` AND
# notify customers via the SDK CHANGELOG — this value is part of the
# customer-observable contract.
DEFAULT_TOLERANCE_SECONDS: Final[int] = 300


class WebhookSignatureMalformedError(AegisError):
    """Signature header was syntactically malformed.

    Missing ``t=``, missing any ``v1=``, non-hex ``v1=`` value, or
    non-integer timestamp. Receiver should respond 400 to the API; do
    NOT retry-process the delivery.
    """

    code = "WEBHOOK_SIGNATURE_MALFORMED"

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=400)


class WebhookSignatureInvalidError(AegisError):
    """Signature header well-formed but no ``v1=`` segment verified.

    Either the secret is wrong, the payload was modified in transit, or
    the delivery is forged. Receiver should respond 401/403 and audit
    the attempt.
    """

    code = "WEBHOOK_SIGNATURE_INVALID"

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=401)


class WebhookTimestampError(AegisError):
    """Signature verified but timestamp is outside the tolerance window.

    Either a captured-signature replay attack, or a legitimate retry
    that exceeded the operator's tolerance setting.

    Attributes:
        signature_timestamp: Timestamp from the signature (unix seconds).
        received_at: Receiver's clock at verification (unix seconds).
        tolerance_seconds: Configured tolerance window.
    """

    code = "WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE"

    def __init__(
        self,
        message: str,
        *,
        signature_timestamp: int,
        received_at: int,
        tolerance_seconds: int,
    ) -> None:
        super().__init__(message, status_code=400)
        self.signature_timestamp = signature_timestamp
        self.received_at = received_at
        self.tolerance_seconds = tolerance_seconds


@dataclass(frozen=True)
class VerifiedWebhook:
    """Returned by :func:`verify_webhook_signature` on success.

    Attributes:
        timestamp: Unix timestamp from the signature, in seconds.
        skew_seconds: Receiver clock skew relative to delivery, in
            seconds. Positive = late delivery; negative = clock drift.
    """

    timestamp: int
    skew_seconds: int


@dataclass(frozen=True)
class _ParsedSignatureHeader:
    """Internal structured form of a parsed signature header."""

    t: int
    v1: tuple[str, ...]


_T_RE = re.compile(r"\A-?\d+\Z")
_V1_HEX_RE = re.compile(r"\A[0-9a-fA-F]+\Z")


def _parse_signature_header(header: str) -> _ParsedSignatureHeader:
    """Parse a Stripe-shape signature header into structured form.

    Accepts extra unknown segments (``v2=...``, ``unknown=...``) for
    forward-compat; we ignore them rather than fail. Multiple ``v1=``
    segments are all collected — used during key-rotation cutover when
    the API may emit signatures from two secrets simultaneously.

    Raises:
        WebhookSignatureMalformedError: If ``t=`` is missing/non-integer
            or no valid ``v1=`` segment is present.
    """
    segments = [s.strip() for s in header.split(",") if s.strip()]
    t: int | None = None
    v1: list[str] = []
    for segment in segments:
        eq = segment.find("=")
        if eq == -1:
            continue
        k = segment[:eq]
        v = segment[eq + 1 :]
        if k == "t":
            if not _T_RE.match(v):
                raise WebhookSignatureMalformedError(
                    f"webhook signature: 't' must be a non-negative integer, got {v!r}"
                )
            parsed = int(v)
            if parsed < 0:
                raise WebhookSignatureMalformedError(
                    f"webhook signature: 't' must be a non-negative integer, got {v!r}"
                )
            t = parsed
        elif k == "v1":
            # Permissive hex check — ``hmac.compare_digest`` rejects bad input
            # anyway, but a clearer error here helps operators debug.
            if not _V1_HEX_RE.match(v) or len(v) % 2 != 0:
                raise WebhookSignatureMalformedError(
                    f"webhook signature: 'v1' must be even-length hex, got {len(v)} chars"
                )
            v1.append(v)
        # Unknown segments are ignored for forward-compat.
    if t is None:
        raise WebhookSignatureMalformedError(
            "webhook signature: missing required 't=<unix-ts>' segment"
        )
    if not v1:
        raise WebhookSignatureMalformedError(
            "webhook signature: missing required 'v1=<hmac-hex>' segment"
        )
    return _ParsedSignatureHeader(t=t, v1=tuple(v1))


def verify_webhook_signature(
    *,
    payload: str,
    signature: str,
    secret: str,
    tolerance_seconds: int | float = DEFAULT_TOLERANCE_SECONDS,
    now: Callable[[], float] | None = None,
) -> VerifiedWebhook:
    """Verify a webhook signature against the canonical payload + secret.

    Resolution order:

    1. Parse the signature header. Malformed → :class:`WebhookSignatureMalformedError`.
    2. Check timestamp against tolerance window. Out of window →
       :class:`WebhookTimestampError`. (We check the timestamp BEFORE the
       HMAC because a malicious caller could otherwise flood us with
       HMAC computations on signatures they already know are stale.)
    3. HMAC-verify each ``v1=`` segment via :func:`hmac.compare_digest`
       (constant-time). Accept on the first match.
    4. No segment verified → :class:`WebhookSignatureInvalidError`.

    Args:
        payload: Raw request body — UNPARSED string. Critical: pass the
            literal body bytes the API sent, NOT ``json.dumps(json.loads(body))``.
            JSON round-tripping is lossy on key order, number formatting,
            and whitespace; the HMAC is computed over the literal bytes.
        signature: Value of the ``X-AEGIS-Signature`` header.
        secret: Operator's webhook subscription secret (``whsec_...``).
        tolerance_seconds: Tolerance window in seconds. Defaults to
            :data:`DEFAULT_TOLERANCE_SECONDS` (operator-pinned). Accepts past
            OR future skew up to this many seconds. Set to
            ``float('inf')`` to disable the timestamp check entirely
            (NOT recommended — only for offline replay analysis).
        now: Clock injection for tests. Defaults to ``time.time``.

    Returns:
        :class:`VerifiedWebhook` carrying the timestamp and observed skew.

    Raises:
        WebhookSignatureMalformedError: Header was syntactically broken.
        WebhookTimestampError: Header verified but outside the tolerance window.
        WebhookSignatureInvalidError: No ``v1=`` segment verified the payload.
    """
    parsed = _parse_signature_header(signature)
    current = int(now() if now is not None else time.time())

    skew = current - parsed.t
    # ``float('inf')`` disables the timestamp check; any finite value enforces it.
    if tolerance_seconds != float("inf") and abs(skew) > tolerance_seconds:
        raise WebhookTimestampError(
            f"webhook timestamp out of tolerance: |{skew}|s > {tolerance_seconds}s",
            signature_timestamp=parsed.t,
            received_at=current,
            tolerance_seconds=int(tolerance_seconds),
        )

    signed_bytes = f"{parsed.t}.{payload}".encode()
    expected = hmac.new(
        secret.encode("utf-8"), signed_bytes, hashlib.sha256
    ).hexdigest()

    # Try each v1= segment. Accept on first match — constant-time within
    # each comparison; the iteration count leaks "how many sigs in the
    # header", which is not secret information (it's right there in the
    # header bytes).
    for candidate in parsed.v1:
        # ``hmac.compare_digest`` is constant-time and accepts unequal-length
        # inputs without short-circuiting. Both inputs are lowercase hex
        # ASCII; normalize the candidate to handle uppercase emission.
        if hmac.compare_digest(expected, candidate.lower()):
            return VerifiedWebhook(timestamp=parsed.t, skew_seconds=skew)

    raise WebhookSignatureInvalidError(
        f"webhook signature: no v1= segment verified "
        f"({len(parsed.v1)} candidate{'s' if len(parsed.v1) != 1 else ''} tried)"
    )


__all__ = [
    "DEFAULT_TOLERANCE_SECONDS",
    "WEBHOOK_DELIVERY_ID_HEADER",
    "WEBHOOK_EVENT_HEADER",
    "WEBHOOK_SIGNATURE_HEADER",
    "VerifiedWebhook",
    "WebhookSignatureInvalidError",
    "WebhookSignatureMalformedError",
    "WebhookTimestampError",
    "verify_webhook_signature",
]
