"""Shared constants — mirrors ``packages/types/src/constants.ts``.

Importing the same constant from a Python client vs. the API guarantees they
agree on enum names, header names, and TTL boundaries.

Architecture: the wire-level constants are re-exported from the generated
modules to keep TS↔PY drift structurally impossible. Two generators:

  - ``scripts/generate-denial-reason.ts`` → ``_denial_reason_generated.py``
    (DENIAL_REASON_PRECEDENCE; CI gate ``check:denial-reason-gen``)
  - ``scripts/generate-shared-constants.ts`` → ``_shared_constants_generated.py``
    (AEGIS_HEADER_*, TRUST_BAND_THRESHOLDS, TOKEN_TTL bounds,
    POLICY_TTL_MAX_DAYS, VERIFY_RESULT_DEFAULT_TTL_SECONDS, WEBHOOK_EVENT;
    CI gate ``check:shared-constants-gen``)

Public consumers should keep importing from this module
(``from aegis._constants import AEGIS_HEADER_TOKEN``) — the generated
modules are private (leading underscore) and may move between minor
versions.

Anything declared as a literal in THIS file (not re-exported from
generated) is sdk-py-local and intentionally not in the canonical TS
source. Each such item carries an inline rationale comment.
"""

from __future__ import annotations

from typing import Final

# Re-exports from the wire-constants generator. Adding a new wire-level
# constant: (1) export it from packages/types/src/constants.ts,
# (2) extend scripts/generate-shared-constants.ts renderPy(),
# (3) run `pnpm gen:shared-constants`, (4) add the re-export below.
from ._shared_constants_generated import (  # noqa: F401
    AEGIS_HEADER_API_KEY,
    AEGIS_HEADER_IDEMPOTENCY,
    AEGIS_HEADER_REQUEST_ID,
    AEGIS_HEADER_SIGNATURE,
    AEGIS_HEADER_TOKEN,
    AEGIS_HEADER_VERIFY_KEY,
    POLICY_TTL_MAX_DAYS,
    TOKEN_TTL_MAX_SECONDS,
    TOKEN_TTL_MIN_SECONDS,
    TRUST_BAND_THRESHOLDS,
    VERIFY_RESULT_DEFAULT_TTL_SECONDS,
    WEBHOOK_EVENT,
)

# Re-export from the denial-reason generator (see _denial_reason_generated.py
# header for the rationale of each reason's precedence position and the
# CI-gate / parity-test defense layering).
from ._denial_reason_generated import DENIAL_REASON_PRECEDENCE  # noqa: F401

# ── sdk-py-local constants (intentionally NOT in canonical TS) ───
#
# TOKEN_TTL_DEFAULT_SECONDS: the TTL a Python client requests when it
# does not specify one explicitly. TS clients either pass an explicit
# value or fall back to the server-side default (60s, matched here).
# Not in canonical TS because the TS SDK does not expose a "default"
# helper — TS callers reach for TOKEN_TTL_MAX_SECONDS directly. If we
# ever expose `aegis.tokens.requestDefaultTtl()` in TS, this constant
# should move into the shared-constants generator and the asymmetry
# resolved. Until then, an asymmetric-but-documented sdk-py local is
# preferable to a silently-divergent generated mirror.
TOKEN_TTL_DEFAULT_SECONDS: Final[int] = 60

# Library defaults — Python-client-side ergonomics; not wire contract.
# TS SDK has analogous values in its own client config; both packages
# intentionally diverge here because Python httpx vs. TS fetch retry
# semantics differ.
DEFAULT_BASE_URL: Final[str] = "https://api.aegislabs.io/v1"
DEFAULT_TIMEOUT_MS: Final[int] = 5_000
DEFAULT_MAX_RETRIES: Final[int] = 3
RETRY_BACKOFF_MS: Final[tuple[int, ...]] = (250, 500, 1_000)
