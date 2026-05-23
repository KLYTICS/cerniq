"""Tests for :mod:`aegis.webhook_events` — typed event union.

Mirrors ``packages/sdk-ts/src/webhook-events.spec.ts`` test-for-test.
The cross-language parity gate
``tests/cross-package/sdk-ts-py-webhook-events-parity.spec.ts``
asserts catalog values + interpret behavior are byte/behavior-
identical to the TS SDK.
"""

from __future__ import annotations

from typing import Any

import pytest

from aegis._shared_constants_generated import WEBHOOK_EVENT
from aegis.webhook_events import (
    AgentPolicyExpiredEvent,
    AgentTrustScoreChangedEvent,
    WebhookEnvelope,
    WebhookEventParseError,
    interpret_webhook_event,
    is_webhook_envelope,
)

# ──────────────────────────────────────────────────────────────────────
# Catalog coverage — the import-time gate already runs; sanity-check here
# ──────────────────────────────────────────────────────────────────────


def test_catalog_has_all_five_known_events() -> None:
    """If WEBHOOK_EVENT grows beyond 5 entries, this test reminds us
    to expand WebhookEventName Literal AND interpret_webhook_event
    AND this test file (and notify the cross-language parity gate).
    """
    assert set(WEBHOOK_EVENT.values()) == {
        "aegis.agent.trust_score_changed",
        "aegis.agent.anomaly_detected",
        "aegis.agent.policy_expired",
        "aegis.agent.flagged_by_relying_party",
        "aegis.agent.revoked",
    }


# ──────────────────────────────────────────────────────────────────────
# Happy path — narrowing on the two known emit sites
# ──────────────────────────────────────────────────────────────────────


def test_interprets_trust_score_changed_with_full_payload_narrowing() -> None:
    raw: dict[str, Any] = {
        "event": "aegis.agent.trust_score_changed",
        "subscriptionId": "sub_1",
        "deliveryId": "del_1",
        "occurredAt": "2026-05-22T12:00:00Z",
        "data": {
            "agentId": "agt_xyz",
            "score": 720,
            "previousScore": 480,
            "band": "VERIFIED",
            "previousBand": "WATCH",
            "weightsVersion": "v1.2.0",
            "contributors": {"manual_attestation": 240},
        },
    }
    event = interpret_webhook_event(raw)
    # Discriminator narrowing — mypy narrows `event` to
    # AgentTrustScoreChangedEvent inside this branch.
    if event["event"] == "aegis.agent.trust_score_changed":
        assert event["data"]["agentId"] == "agt_xyz"
        assert event["data"]["score"] == 720
        assert event["data"]["previousScore"] == 480
        assert event["data"]["band"] == "VERIFIED"
        assert event["data"]["previousBand"] == "WATCH"
        assert event["data"]["weightsVersion"] == "v1.2.0"
        assert event["data"]["contributors"] == {"manual_attestation": 240}
    else:
        pytest.fail(f"unexpected event variant: {event['event']!r}")


def test_interprets_policy_expired_with_concrete_payload() -> None:
    raw: dict[str, Any] = {
        "event": "aegis.agent.policy_expired",
        "data": {
            "policyId": "pol_abc",
            "agentId": "agt_xyz",
            "expiredAt": "2026-05-22T11:00:00Z",
            "sweptAt": "2026-05-22T11:00:05Z",
        },
    }
    event = interpret_webhook_event(raw)
    if event["event"] == "aegis.agent.policy_expired":
        assert event["data"]["policyId"] == "pol_abc"
        assert event["data"]["agentId"] == "agt_xyz"
        assert event["data"]["expiredAt"] == "2026-05-22T11:00:00Z"
        assert event["data"]["sweptAt"] == "2026-05-22T11:00:05Z"
    else:
        pytest.fail(f"unexpected event variant: {event['event']!r}")


# ──────────────────────────────────────────────────────────────────────
# Not-yet-emitted events — opaque data
# ──────────────────────────────────────────────────────────────────────


def test_interprets_anomaly_detected_with_opaque_data() -> None:
    raw: dict[str, Any] = {
        "event": "aegis.agent.anomaly_detected",
        "data": {"any": "shape", "is": ["allowed", 42, None]},
    }
    event = interpret_webhook_event(raw)
    # Until the emitter ships, this variant's data is just dict[str, Any].
    if event["event"] == "aegis.agent.anomaly_detected":
        assert event["data"] == {"any": "shape", "is": ["allowed", 42, None]}
    else:
        pytest.fail(f"unexpected event variant: {event['event']!r}")


def test_interprets_flagged_by_relying_party_with_opaque_data() -> None:
    raw: dict[str, Any] = {
        "event": "aegis.agent.flagged_by_relying_party",
        "data": {"merchantId": "mer_x", "reason": "test"},
    }
    event = interpret_webhook_event(raw)
    if event["event"] == "aegis.agent.flagged_by_relying_party":
        assert event["data"]["merchantId"] == "mer_x"
    else:
        pytest.fail(f"unexpected event variant: {event['event']!r}")


def test_interprets_revoked_with_opaque_data() -> None:
    raw: dict[str, Any] = {
        "event": "aegis.agent.revoked",
        "data": {"by": "operator", "reason": "compromised"},
    }
    event = interpret_webhook_event(raw)
    if event["event"] == "aegis.agent.revoked":
        assert event["data"]["by"] == "operator"
    else:
        pytest.fail(f"unexpected event variant: {event['event']!r}")


# ──────────────────────────────────────────────────────────────────────
# Failure modes
# ──────────────────────────────────────────────────────────────────────


def test_raises_on_non_dict() -> None:
    with pytest.raises(WebhookEventParseError, match="must be a dict"):
        interpret_webhook_event("not a dict")
    with pytest.raises(WebhookEventParseError, match="must be a dict"):
        interpret_webhook_event(None)
    with pytest.raises(WebhookEventParseError, match="must be a dict"):
        interpret_webhook_event([])


def test_raises_on_missing_event_field() -> None:
    with pytest.raises(WebhookEventParseError, match="missing string 'event'"):
        interpret_webhook_event({"data": {}})


def test_raises_on_non_string_event() -> None:
    with pytest.raises(WebhookEventParseError, match="missing string 'event'"):
        interpret_webhook_event({"event": 42, "data": {}})


def test_raises_on_unknown_event_name_with_guidance() -> None:
    with pytest.raises(WebhookEventParseError) as excinfo:
        interpret_webhook_event(
            {"event": "aegis.agent.brand_new_event_2030", "data": {}}
        )
    err = excinfo.value
    assert err.raw_event_name == "aegis.agent.brand_new_event_2030"
    # Guidance message helps customers diagnose without re-reading docs.
    assert "consider upgrading" in str(err)
    assert "aegis.agent.brand_new_event_2030" in str(err)


def test_raw_event_name_attached_for_forensics() -> None:
    """Every error path attaches the offending value (or None) for forensics."""
    with pytest.raises(WebhookEventParseError) as excinfo:
        interpret_webhook_event({"event": 42})
    assert excinfo.value.raw_event_name == 42

    with pytest.raises(WebhookEventParseError) as excinfo:
        interpret_webhook_event(None)
    assert excinfo.value.raw_event_name is None

    with pytest.raises(WebhookEventParseError) as excinfo:
        interpret_webhook_event({"event": "unknown"})
    assert excinfo.value.raw_event_name == "unknown"


# ──────────────────────────────────────────────────────────────────────
# Drift regression — the exact bug M-WEBHOOK-3 caught in the API
# ──────────────────────────────────────────────────────────────────────


def test_drift_regression_okoro_policy_expired_rejected() -> None:
    """Locks the regression net for the live drift bug found 2026-05-22.

    The API was emitting ``type: 'okoro.policy.expired'`` (commit
    7e123 era) instead of the catalog name
    ``'aegis.agent.policy_expired'``. The TS event-emitter parity gate
    caught it; this Python test locks the SDK side — a customer who
    receives the legacy name from a stale deployment should observe a
    parse failure rather than silently mis-routed event handling.
    """
    with pytest.raises(WebhookEventParseError):
        interpret_webhook_event(
            {"event": "okoro.policy.expired", "data": {}}
        )


# ──────────────────────────────────────────────────────────────────────
# is_webhook_envelope (TypeGuard variant)
# ──────────────────────────────────────────────────────────────────────


def test_is_webhook_envelope_true_for_known_event() -> None:
    raw: dict[str, Any] = {
        "event": "aegis.agent.policy_expired",
        "data": {
            "policyId": "p", "agentId": "a",
            "expiredAt": "2026-05-22T11:00:00Z",
            "sweptAt": "2026-05-22T11:00:05Z",
        },
    }
    assert is_webhook_envelope(raw) is True


def test_is_webhook_envelope_false_for_unknown_event() -> None:
    assert is_webhook_envelope({"event": "future.event", "data": {}}) is False


def test_is_webhook_envelope_false_for_non_dict() -> None:
    assert is_webhook_envelope("not a dict") is False
    assert is_webhook_envelope(None) is False
    assert is_webhook_envelope(42) is False


# ──────────────────────────────────────────────────────────────────────
# Full catalog coverage runtime sanity
# ──────────────────────────────────────────────────────────────────────


def test_every_catalog_value_interprets_successfully() -> None:
    """Runtime mirror of the import-time exhaustiveness gate.

    Iterates the WEBHOOK_EVENT catalog and asserts each value passes
    through interpret_webhook_event without raising. If a new catalog
    entry ships without updating the module, this test fails BEFORE
    the import-time assertion saves us — caught one level earlier.
    """
    for event_name in WEBHOOK_EVENT.values():
        raw: dict[str, Any] = {"event": event_name, "data": {}}
        event = interpret_webhook_event(raw)
        assert event["event"] == event_name


# ──────────────────────────────────────────────────────────────────────
# Static-type smoke — narrowed access does not raise at runtime
# ──────────────────────────────────────────────────────────────────────


def test_narrowed_access_uses_typed_keys() -> None:
    """Runtime smoke that the typed access pattern (event["data"]["agentId"])
    works for the two known payload variants. mypy would catch any key
    typo at type-check time; this is the runtime equivalent.
    """
    score_event: AgentTrustScoreChangedEvent = {
        "event": "aegis.agent.trust_score_changed",
        "data": {
            "agentId": "agt_a",
            "score": 800,
            "previousScore": 700,
            "band": "VERIFIED",
            "previousBand": "VERIFIED",
            "weightsVersion": "v1",
            "contributors": {},
        },
    }
    # The cast assignment above type-checks under mypy strict — the
    # TypedDict shape must match. Runtime access is the smoke.
    assert score_event["data"]["score"] == 800

    expired_event: AgentPolicyExpiredEvent = {
        "event": "aegis.agent.policy_expired",
        "data": {
            "policyId": "p1",
            "agentId": "a1",
            "expiredAt": "2026-05-22T00:00:00Z",
            "sweptAt": "2026-05-22T00:00:05Z",
        },
    }
    assert expired_event["data"]["policyId"] == "p1"


# ──────────────────────────────────────────────────────────────────────
# Type-only roundtrip — WebhookEnvelope variants are assignable
# ──────────────────────────────────────────────────────────────────────


def test_webhook_envelope_union_accepts_each_variant() -> None:
    """Static smoke: any of the five envelope variants is a valid
    WebhookEnvelope. If a future refactor narrows the Union, this
    function fails to type-check.
    """
    variants: list[WebhookEnvelope] = [
        {  # AgentTrustScoreChangedEvent
            "event": "aegis.agent.trust_score_changed",
            "data": {
                "agentId": "a", "score": 1, "previousScore": 0,
                "band": "VERIFIED", "previousBand": "WATCH",
                "weightsVersion": "v1", "contributors": {},
            },
        },
        {  # AgentAnomalyDetectedEvent
            "event": "aegis.agent.anomaly_detected",
            "data": {},
        },
        {  # AgentPolicyExpiredEvent
            "event": "aegis.agent.policy_expired",
            "data": {
                "policyId": "p", "agentId": "a",
                "expiredAt": "x", "sweptAt": "y",
            },
        },
        {  # AgentFlaggedByRelyingPartyEvent
            "event": "aegis.agent.flagged_by_relying_party",
            "data": {},
        },
        {  # AgentRevokedEvent
            "event": "aegis.agent.revoked",
            "data": {},
        },
    ]
    assert len(variants) == 5
