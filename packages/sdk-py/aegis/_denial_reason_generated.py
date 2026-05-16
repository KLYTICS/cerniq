# @generated — do not edit; run `pnpm gen:denial-reason`
#
# Mirror of DENIAL_REASON_PRECEDENCE in packages/types/src/constants.ts.
# Order matches the canonical precedence (top-wins). Relying-party SDK
# consumers switch on this enum to handle each denial reason exhaustively.
#
# CI gate `pnpm check:denial-reason-gen` re-runs the generator and fails
# if this file diverges from the canonical source. Hand edits will be
# clobbered by the next `pnpm gen:denial-reason` invocation.

from __future__ import annotations

import sys
from typing import Final

if sys.version_info >= (3, 11):
    from enum import StrEnum
else:
    from enum import Enum

    class StrEnum(str, Enum):  # type: ignore[no-redef]
        """Backport of StrEnum for Python <3.11."""


DENIAL_REASON_PRECEDENCE: Final[tuple[str, ...]] = (
    "PLAN_LIMIT_EXCEEDED",
    "AGENT_NOT_FOUND",
    "AGENT_REVOKED",
    "INVALID_SIGNATURE",
    "POLICY_REVOKED",
    "POLICY_EXPIRED",
    "SCOPE_NOT_GRANTED",
    "TRIAL_EXHAUSTED",
    "SPEND_LIMIT_EXCEEDED",
    "TRUST_SCORE_TOO_LOW",
    "ANOMALY_FLAGGED",
    "INTENT_MISMATCH",
)


class DenialReason(StrEnum):
    """Denial-reason enum mirroring DENIAL_REASON_PRECEDENCE.

    StrEnum invariant: each member's value equals its name so the
    wire-format string never silently diverges from the Python
    identifier on serialization.
    """

    PLAN_LIMIT_EXCEEDED = "PLAN_LIMIT_EXCEEDED"
    AGENT_NOT_FOUND = "AGENT_NOT_FOUND"
    AGENT_REVOKED = "AGENT_REVOKED"
    INVALID_SIGNATURE = "INVALID_SIGNATURE"
    POLICY_REVOKED = "POLICY_REVOKED"
    POLICY_EXPIRED = "POLICY_EXPIRED"
    SCOPE_NOT_GRANTED = "SCOPE_NOT_GRANTED"
    TRIAL_EXHAUSTED = "TRIAL_EXHAUSTED"
    SPEND_LIMIT_EXCEEDED = "SPEND_LIMIT_EXCEEDED"
    TRUST_SCORE_TOO_LOW = "TRUST_SCORE_TOO_LOW"
    ANOMALY_FLAGGED = "ANOMALY_FLAGGED"
    INTENT_MISMATCH = "INTENT_MISMATCH"
