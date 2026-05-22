"""Kind-discriminated webhook event union — Python mirror of
``packages/sdk-ts/src/webhook-events.ts``.

Webhook deliveries arrive at customer endpoints as JSON bodies with at
least ``event`` (the type name from the WEBHOOK_EVENT catalog) plus a
``data`` payload whose shape depends on the event. Without a typed
union, customers must access ``event["data"]`` blind and lose all
narrowing on payload shape.

This module ships:

- A :class:`WebhookEnvelope` :class:`TypedDict` union — each variant
  declares its ``event`` field as a :class:`Literal` so mypy narrows
  on ``if event["event"] == "..."``.
- :func:`interpret_webhook_event` — runtime validator that accepts a
  raw parsed-JSON dict and returns the union-typed envelope, raising
  :class:`WebhookEventParseError` on unknown events.
- :func:`is_webhook_envelope` — :class:`TypeGuard` variant for
  silent-skip patterns.
- A module-import-time catalog-coverage assertion that locks the
  Literal type against ``WEBHOOK_EVENT`` from
  ``_shared_constants_generated.py``: if the canonical catalog grows
  a new entry and this file isn't updated, import fails loudly
  rather than silently dropping events.

Customer pattern (after :func:`verify_webhook_signature` +
:func:`assert_not_replay`)::

    event = interpret_webhook_event(json.loads(verified_body))
    if event["event"] == "aegis.agent.trust_score_changed":
        # mypy narrows event["data"] to AgentTrustScoreChangedPayload
        score = event["data"]["score"]
        prev = event["data"]["previousScore"]
        ...
    elif event["event"] == "aegis.agent.policy_expired":
        # event["data"] is AgentPolicyExpiredPayload
        await revoke_downstream_session(event["data"]["agentId"])
        ...

Forward-compat: when a NEW event type ships in WEBHOOK_EVENT, the
import-time assertion below fails — forces an update to the union AND
the :func:`interpret_webhook_event` switch in the same release. Customer
code using ``if/elif`` on ``event["event"]`` also benefits from
:func:`typing.assert_never` exhaustiveness checks under mypy strict.

Payload schemas mirror the TS choice:

- For events with a known emitter
  (``aegis.agent.policy_expired``, ``aegis.agent.trust_score_changed``),
  we ship concrete payload :class:`TypedDict` shapes sourced from the
  API emitter code.
- For events declared in the catalog but not yet emitted
  (``anomaly_detected``, ``flagged_by_relying_party``, ``revoked``),
  payload is ``dict[str, Any]`` — concrete schemas land WITH the
  emitter, per CLAUDE.md docs rule "docs reflect code, not aspiration".
"""

from __future__ import annotations

from typing import Any, Literal, NotRequired, TypedDict, TypeGuard

from ._shared_constants_generated import WEBHOOK_EVENT

# ── Event-name literal (locked against WEBHOOK_EVENT catalog) ─────────
# Exact mirror of `WebhookEvent` in @aegis/types. If the catalog grows
# a new entry, the import-time assertion at the bottom of this module
# fails with a clear error pointing at the missing variant — the same
# discipline as the TS ``_ExhaustivenessGate``.
WebhookEventName = Literal[
    "aegis.agent.trust_score_changed",
    "aegis.agent.anomaly_detected",
    "aegis.agent.policy_expired",
    "aegis.agent.flagged_by_relying_party",
    "aegis.agent.revoked",
]


# ── Payload shapes ────────────────────────────────────────────────────


class AgentTrustScoreChangedPayload(TypedDict):
    """Emitted when an agent's trust score crosses a band boundary.

    Source: ``apps/api/src/modules/bate/bate.worker.ts:249``.
    """

    agentId: str
    score: int
    previousScore: int
    band: str
    previousBand: str
    weightsVersion: str
    contributors: dict[str, int]


class AgentPolicyExpiredPayload(TypedDict):
    """Emitted when an agent's policy passes its ``expiresAt`` timestamp.

    Source: ``apps/api/src/modules/policy/policy.expiry.worker.ts:144``.
    """

    policyId: str
    agentId: str
    expiredAt: str  # ISO-8601 timestamp the policy was scheduled to expire
    sweptAt: str  # ISO-8601 timestamp the expiry sweep ran


# Placeholder payload types for events with no emitter yet. Concrete
# schemas land WITH the emitter — mirrors TS's `Record<string, unknown>`.
AgentAnomalyDetectedPayload = dict[str, Any]
AgentFlaggedByRelyingPartyPayload = dict[str, Any]
AgentRevokedPayload = dict[str, Any]


# ── Envelope variants ─────────────────────────────────────────────────


class AgentTrustScoreChangedEvent(TypedDict):
    """Webhook envelope for ``aegis.agent.trust_score_changed``."""

    event: Literal["aegis.agent.trust_score_changed"]
    data: AgentTrustScoreChangedPayload
    subscriptionId: NotRequired[str]
    deliveryId: NotRequired[str]
    occurredAt: NotRequired[str]


class AgentAnomalyDetectedEvent(TypedDict):
    """Webhook envelope for ``aegis.agent.anomaly_detected``."""

    event: Literal["aegis.agent.anomaly_detected"]
    data: AgentAnomalyDetectedPayload
    subscriptionId: NotRequired[str]
    deliveryId: NotRequired[str]
    occurredAt: NotRequired[str]


class AgentPolicyExpiredEvent(TypedDict):
    """Webhook envelope for ``aegis.agent.policy_expired``."""

    event: Literal["aegis.agent.policy_expired"]
    data: AgentPolicyExpiredPayload
    subscriptionId: NotRequired[str]
    deliveryId: NotRequired[str]
    occurredAt: NotRequired[str]


class AgentFlaggedByRelyingPartyEvent(TypedDict):
    """Webhook envelope for ``aegis.agent.flagged_by_relying_party``."""

    event: Literal["aegis.agent.flagged_by_relying_party"]
    data: AgentFlaggedByRelyingPartyPayload
    subscriptionId: NotRequired[str]
    deliveryId: NotRequired[str]
    occurredAt: NotRequired[str]


class AgentRevokedEvent(TypedDict):
    """Webhook envelope for ``aegis.agent.revoked``."""

    event: Literal["aegis.agent.revoked"]
    data: AgentRevokedPayload
    subscriptionId: NotRequired[str]
    deliveryId: NotRequired[str]
    occurredAt: NotRequired[str]


# The full kind-discriminated webhook event union. Match/check on
# ``envelope["event"]`` to narrow to the concrete envelope variant.
WebhookEnvelope = (
    AgentTrustScoreChangedEvent
    | AgentAnomalyDetectedEvent
    | AgentPolicyExpiredEvent
    | AgentFlaggedByRelyingPartyEvent
    | AgentRevokedEvent
)


# ── Errors ────────────────────────────────────────────────────────────


class WebhookEventParseError(ValueError):
    """Raised when an envelope doesn't match any known event.

    Inherits from :class:`ValueError` (not :class:`AegisError`) because
    parse failures are caller-input errors, not API errors — caller
    likely deserialized a non-envelope JSON body or is running an
    SDK older than the API. The accompanying guidance message points
    at the most common cause.

    Attributes:
        raw_event_name: The raw ``event`` value that failed to map.
            ``None`` if the envelope was missing the discriminator
            entirely or was not a dict.
    """

    def __init__(self, message: str, *, raw_event_name: object | None) -> None:
        super().__init__(message)
        self.raw_event_name = raw_event_name


# ── Import-time exhaustiveness gate ───────────────────────────────────
#
# Lock the WebhookEventName Literal against the WEBHOOK_EVENT catalog.
# If a new event is added to ``_shared_constants_generated.py`` (which
# is itself regenerated from ``packages/types/src/constants.ts``) but
# this module isn't updated, this assertion fails at import time —
# loud enough that any consumer of `aegis` notices, and the
# cross-language parity gate catches it earlier in CI.
#
# The set of catalog values must EXACTLY equal the set of strings
# expressible as ``WebhookEventName``. We can't introspect a
# :class:`Literal` at runtime cleanly, so we hard-code the expected set
# and assert both directions: (1) every catalog value is one of ours,
# (2) every one of ours is in the catalog.

_KNOWN_EVENT_NAMES: frozenset[str] = frozenset(
    {
        "aegis.agent.trust_score_changed",
        "aegis.agent.anomaly_detected",
        "aegis.agent.policy_expired",
        "aegis.agent.flagged_by_relying_party",
        "aegis.agent.revoked",
    }
)

_catalog_values: frozenset[str] = frozenset(WEBHOOK_EVENT.values())

_missing_from_module: frozenset[str] = _catalog_values - _KNOWN_EVENT_NAMES
if _missing_from_module:
    raise RuntimeError(
        f"webhook_events.py is out of date: WEBHOOK_EVENT catalog has "
        f"new entries not yet declared as WebhookEnvelope variants: "
        f"{sorted(_missing_from_module)}. Add the variants AND update "
        f"_KNOWN_EVENT_NAMES AND update interpret_webhook_event."
    )

_extra_in_module: frozenset[str] = _KNOWN_EVENT_NAMES - _catalog_values
if _extra_in_module:
    raise RuntimeError(
        f"webhook_events.py declares variants that aren't in WEBHOOK_EVENT "
        f"catalog: {sorted(_extra_in_module)}. Either remove the variants "
        f"or update _shared_constants_generated.py / @aegis/types."
    )


# ── interpret helper ──────────────────────────────────────────────────


def interpret_webhook_event(raw: object) -> WebhookEnvelope:
    """Narrow a raw envelope (typically ``json.loads(verified_body)``) into
    the typed :class:`WebhookEnvelope` union.

    Resolution:

    1. Validate the envelope is a :class:`dict`.
    2. Validate ``event`` is a string and one of the known catalog
       entries. Unknown → :class:`WebhookEventParseError` with a
       guidance message about SDK upgrade.
    3. Cast the raw dict through to the narrowed union type. No
       payload shape validation — that is the customer's responsibility
       (use a runtime guard, pydantic schema, etc.). Validating here
       would require shipping schemas for every payload, which we don't
       have for events with no emitter (matches TS choice).

    Args:
        raw: A parsed-JSON value — typically ``json.loads(verified_body)``.

    Returns:
        The same dict, narrowed to :class:`WebhookEnvelope`.

    Raises:
        WebhookEventParseError: ``raw`` is not a dict, ``event`` is
            missing/not-a-string, or ``event`` is not one of the
            known catalog values.
    """
    if not isinstance(raw, dict):
        raise WebhookEventParseError(
            f"webhook envelope must be a dict, got {type(raw).__name__}",
            raw_event_name=None,
        )

    event_name = raw.get("event")
    if not isinstance(event_name, str):
        raise WebhookEventParseError(
            f"webhook envelope missing string 'event' field, got "
            f"{type(event_name).__name__}",
            raw_event_name=event_name,
        )

    if event_name not in _KNOWN_EVENT_NAMES:
        raise WebhookEventParseError(
            f"webhook envelope has unknown event name: {event_name!r}. "
            f"SDK may be older than the API — consider upgrading the "
            f"`aegis` package.",
            raw_event_name=event_name,
        )

    # Trust the post-signature-verify envelope shape. The import-time
    # catalog-coverage assertion above has already proved every catalog
    # value is a valid variant; the runtime cast is safe.
    return raw  # type: ignore[return-value]


def is_webhook_envelope(raw: object) -> TypeGuard[WebhookEnvelope]:
    """Type-guard variant of :func:`interpret_webhook_event`.

    Returns ``True`` and narrows ``raw`` when the envelope is a known
    webhook event; returns ``False`` otherwise without raising. Use
    when you want to silently skip unknown events (e.g. during SDK-
    upgrade transitions when the API may emit events the SDK doesn't
    recognize yet).
    """
    try:
        interpret_webhook_event(raw)
    except WebhookEventParseError:
        return False
    else:
        return True


__all__ = [
    "AgentAnomalyDetectedEvent",
    "AgentAnomalyDetectedPayload",
    "AgentFlaggedByRelyingPartyEvent",
    "AgentFlaggedByRelyingPartyPayload",
    "AgentPolicyExpiredEvent",
    "AgentPolicyExpiredPayload",
    "AgentRevokedEvent",
    "AgentRevokedPayload",
    "AgentTrustScoreChangedEvent",
    "AgentTrustScoreChangedPayload",
    "WebhookEnvelope",
    "WebhookEventName",
    "WebhookEventParseError",
    "interpret_webhook_event",
    "is_webhook_envelope",
]
