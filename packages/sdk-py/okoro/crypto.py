"""Client-side cryptography — Ed25519 keypair + agent token signing.

OKORO is non-custodial: the code in this module runs in the developer's
environment. Private keys never leave the host. Tokens produced here are
bit-identical to the TypeScript SDK (``packages/sdk-ts/src/crypto.ts``):

- Header: base64url of ``{"alg":"EdDSA","typ":"JWT"}`` (no whitespace,
  insertion order)
- Claims: ``json.dumps(..., separators=(",", ":"))`` with insertion order
  preserved (``sub``, ``pid``, ``iat``, ``exp``, ``jti``, ``act``, then
  optional ``amt`` / ``cur`` / ``dom`` / ``mid``)
- Signature: Ed25519 over ``f"{HEADER}.{PAYLOAD}"`` (ASCII bytes)
- ``jti`` is a ULID
"""

from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from typing import Any, TypedDict

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from ulid import ULID

from ._constants import TOKEN_TTL_DEFAULT_SECONDS

__all__ = [
    "Keypair",
    "SignContext",
    "b64u_decode",
    "b64u_encode",
    "decode_unsafe",
    "generate_keypair",
    "sign_agent_token",
    "verify_agent_token",
]


class SignContext(TypedDict, total=False):
    """Per-request context bound into a signed agent token.

    ``action`` is required. The remaining fields populate the corresponding
    short claim names (``amt``, ``cur``, ``dom``, ``mid``) and are skipped
    when absent.
    """

    action: str
    amount: float
    currency: str
    merchant_domain: str
    merchant_id: str
    ttl_seconds: int


@dataclass(frozen=True)
class Keypair:
    """Ed25519 keypair, both halves base64url-encoded (32 bytes raw each)."""

    public_key: str
    private_key: str


# ── base64url helpers ────────────────────────────────────────


def b64u_encode(data: bytes) -> str:
    """Encode ``data`` as base64url with no padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64u_decode(s: str) -> bytes:
    """Decode a base64url string (with or without padding)."""
    pad = (-len(s)) % 4
    return base64.urlsafe_b64decode(s + ("=" * pad))


# Header is constant: base64url of {"alg":"EdDSA","typ":"JWT"} with no spaces.
# We compute it from the canonical JSON to mirror the TS SDK byte-for-byte
# (instead of hardcoding the string).
_HEADER_B64: str = b64u_encode(
    json.dumps({"alg": "EdDSA", "typ": "JWT"}, separators=(",", ":")).encode("utf-8")
)
# Sanity guard — this string is part of the SDK's wire contract. If any future
# refactor ever changes how we encode the header we want to fail loudly here.
assert _HEADER_B64 == "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9", (
    "OKORO JWT header drifted — must match TS SDK byte-for-byte"
)


# ── public API ───────────────────────────────────────────────


def generate_keypair() -> Keypair:
    """Generate a fresh Ed25519 keypair.

    The private half MUST stay on this host. OKORO only ever sees the public
    half, registered via ``okoro.agents.register``.

    Returns:
        ``Keypair`` whose ``public_key`` and ``private_key`` are base64url
        strings (32 raw bytes each).

    Example:
        >>> kp = generate_keypair()
        >>> len(b64u_decode(kp.public_key))  # 32-byte Ed25519 public key
        32
    """
    priv = Ed25519PrivateKey.generate()
    priv_bytes = priv.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_bytes = priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return Keypair(public_key=b64u_encode(pub_bytes), private_key=b64u_encode(priv_bytes))


def sign_agent_token(
    private_key_b64u: str,
    agent_id: str,
    policy_id: str,
    ctx: SignContext,
) -> str:
    """Sign a per-request agent token. Returns a compact JWT (header.payload.sig).

    The payload always carries ``sub`` (agent_id), ``pid`` (policy_id), ``iat``,
    ``exp`` (= ``iat + ttl_seconds``, default 60 — short-lived to limit replay),
    a ULID ``jti``, and ``act``. Optional ``amount`` / ``currency`` /
    ``merchant_domain`` / ``merchant_id`` populate ``amt`` / ``cur`` / ``dom``
    / ``mid``.

    Args:
        private_key_b64u: Ed25519 private key, base64url. Held client-side.
        agent_id: e.g. ``"agt_01HZ9YZXM4QT3B7P8WKJD6R5V"`` (example).
        policy_id: e.g. ``"pol_01HZ9YZXM4QT3B7P8WKJD6R5V"`` (example).
        ctx: Request-time context. ``action`` is required.

    Returns:
        Compact JWT string ``"<header>.<payload>.<sig>"``.

    Raises:
        KeyError: ``ctx["action"]`` was not provided.
        ValueError: The private key bytes are not 32 bytes long.
    """
    action = ctx["action"]  # Required — let the KeyError speak for itself.
    ttl = int(ctx.get("ttl_seconds", TOKEN_TTL_DEFAULT_SECONDS))
    iat = int(time.time())
    exp = iat + ttl

    # Insertion order matters: it's part of the wire contract with the TS SDK.
    claims: dict[str, Any] = {
        "sub": agent_id,
        "pid": policy_id,
        "iat": iat,
        "exp": exp,
        "jti": str(ULID()),
        "act": action,
    }
    if "amount" in ctx:
        claims["amt"] = ctx["amount"]
    if "currency" in ctx:
        claims["cur"] = ctx["currency"]
    if "merchant_domain" in ctx:
        claims["dom"] = ctx["merchant_domain"]
    if "merchant_id" in ctx:
        claims["mid"] = ctx["merchant_id"]

    # sort_keys=False to preserve insertion order; separators avoid whitespace.
    payload_bytes = json.dumps(claims, separators=(",", ":"), sort_keys=False).encode("utf-8")
    payload_b64 = b64u_encode(payload_bytes)
    signing_input = f"{_HEADER_B64}.{payload_b64}".encode("ascii")

    priv_bytes = b64u_decode(private_key_b64u)
    if len(priv_bytes) != 32:
        raise ValueError(
            f"Ed25519 private key must be 32 bytes, got {len(priv_bytes)} bytes (base64url-decoded)."
        )
    priv = Ed25519PrivateKey.from_private_bytes(priv_bytes)
    sig = priv.sign(signing_input)
    return f"{_HEADER_B64}.{payload_b64}.{b64u_encode(sig)}"


def decode_unsafe(token: str) -> dict[str, Any] | None:
    """Decode a token's claims **without verifying the signature**.

    Useful for tests, CLI tools, and debugging. Never gate authorization on
    this — call ``okoro.verify(token, ...)`` (server-side) for that.

    Returns:
        The claims dict, or ``None`` if the token is malformed.
    """
    parts = token.split(".")
    if len(parts) != 3 or not parts[1]:
        return None
    try:
        payload = b64u_decode(parts[1])
        decoded = json.loads(payload.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(decoded, dict):
        return None
    # type-rationale: JSON dicts have arbitrary string keys/values; preserve
    # whatever the server sent without coercion.
    return decoded


def verify_agent_token(token: str, public_key_b64u: str) -> dict[str, Any] | None:
    """Verify a token locally against a known public key.

    Production verification should call ``okoro.verify(...)`` on the server —
    this helper is for tests, sandboxes, and unit-checking signed payloads.

    Returns:
        The decoded claims if the signature is valid AND the token is not
        expired, otherwise ``None``.
    """
    parts = token.split(".")
    if len(parts) != 3:
        return None
    header_b64, payload_b64, sig_b64 = parts
    try:
        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
        sig = b64u_decode(sig_b64)
        pub = Ed25519PublicKey.from_public_bytes(b64u_decode(public_key_b64u))
        pub.verify(sig, signing_input)
        decoded = json.loads(b64u_decode(payload_b64).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(decoded, dict):
        return None
    exp = decoded.get("exp")
    if isinstance(exp, int) and exp < int(time.time()):
        return None
    if not decoded.get("sub") or not decoded.get("pid"):
        return None
    # type-rationale: see decode_unsafe — JSON dict shape is server-defined.
    return decoded
