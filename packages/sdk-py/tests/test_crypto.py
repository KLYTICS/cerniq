"""Round-trip + format tests for the crypto module."""

from __future__ import annotations

import base64
import json

import pytest

from aegis import (
    Keypair,
    b64u_decode,
    b64u_encode,
    decode_unsafe,
    generate_keypair,
    sign_agent_token,
    verify_agent_token,
)


def test_keypair_is_32_bytes_each() -> None:
    kp = generate_keypair()
    assert isinstance(kp, Keypair)
    assert len(b64u_decode(kp.public_key)) == 32
    assert len(b64u_decode(kp.private_key)) == 32


def test_b64u_round_trip() -> None:
    raw = b"\x00\x01\x02\x03test\xff"
    enc = b64u_encode(raw)
    assert "=" not in enc
    assert "+" not in enc
    assert "/" not in enc
    assert b64u_decode(enc) == raw


def test_jwt_header_matches_ts_sdk(keypair: Keypair) -> None:
    """The first segment is byte-identical to packages/sdk-ts/src/crypto.ts:26."""
    token = sign_agent_token(
        keypair.private_key,
        "agt_test",
        "pol_test",
        {"action": "commerce.purchase"},
    )
    header_b64 = token.split(".")[0]
    assert header_b64 == "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9"
    decoded = json.loads(b64u_decode(header_b64))
    assert decoded == {"alg": "EdDSA", "typ": "JWT"}


def test_token_has_three_segments(keypair: Keypair) -> None:
    token = sign_agent_token(
        keypair.private_key,
        "agt",
        "pol",
        {"action": "x"},
    )
    parts = token.split(".")
    assert len(parts) == 3
    for p in parts:
        # base64url charset only
        assert all(c.isalnum() or c in {"-", "_"} for c in p)


def test_claims_round_trip_through_decode_unsafe(keypair: Keypair) -> None:
    token = sign_agent_token(
        keypair.private_key,
        "agt_x",
        "pol_x",
        {
            "action": "commerce.purchase",
            "amount": 100,
            "currency": "USD",
            "merchant_domain": "delta.com",
            "merchant_id": "delta-airlines",
        },
    )
    claims = decode_unsafe(token)
    assert claims is not None
    assert claims["sub"] == "agt_x"
    assert claims["pid"] == "pol_x"
    assert claims["act"] == "commerce.purchase"
    assert claims["amt"] == 100
    assert claims["cur"] == "USD"
    assert claims["dom"] == "delta.com"
    assert claims["mid"] == "delta-airlines"
    assert isinstance(claims["iat"], int)
    assert isinstance(claims["exp"], int)
    assert claims["exp"] > claims["iat"]
    # jti is a ULID — Crockford base32, 26 chars.
    assert isinstance(claims["jti"], str)
    assert len(claims["jti"]) == 26


def test_claims_insertion_order_matches_ts_sdk(keypair: Keypair) -> None:
    """Order: sub, pid, iat, exp, jti, act, then optional amt/cur/dom/mid."""
    token = sign_agent_token(
        keypair.private_key,
        "a",
        "p",
        {
            "action": "act",
            "amount": 1,
            "currency": "USD",
            "merchant_domain": "d.com",
            "merchant_id": "m1",
        },
    )
    payload_b64 = token.split(".")[1]
    payload_json = b64u_decode(payload_b64).decode("utf-8")
    # Verify the textual order of keys matches the spec.
    expected_order = ["sub", "pid", "iat", "exp", "jti", "act", "amt", "cur", "dom", "mid"]
    indices = [payload_json.index(f'"{k}"') for k in expected_order]
    assert indices == sorted(indices), f"keys out of order in payload: {payload_json}"


def test_optional_fields_omitted_when_absent(keypair: Keypair) -> None:
    token = sign_agent_token(keypair.private_key, "a", "p", {"action": "x"})
    claims = decode_unsafe(token)
    assert claims is not None
    for k in ("amt", "cur", "dom", "mid"):
        assert k not in claims


def test_verify_agent_token_round_trip(keypair: Keypair) -> None:
    token = sign_agent_token(
        keypair.private_key,
        "agt_v",
        "pol_v",
        {"action": "data-read"},
    )
    claims = verify_agent_token(token, keypair.public_key)
    assert claims is not None
    assert claims["sub"] == "agt_v"


def test_verify_with_wrong_public_key_returns_none(keypair: Keypair) -> None:
    other = generate_keypair()
    token = sign_agent_token(
        keypair.private_key,
        "agt",
        "pol",
        {"action": "x"},
    )
    assert verify_agent_token(token, other.public_key) is None


def test_decode_unsafe_returns_none_for_malformed() -> None:
    assert decode_unsafe("not-a-jwt") is None
    assert decode_unsafe("a.b") is None
    assert decode_unsafe("a..c") is None
    assert decode_unsafe("a.???.c") is None


def test_decode_unsafe_returns_none_for_non_object_payload() -> None:
    # Forge a token whose payload is a JSON array, not a dict.
    header = b64u_encode(b'{"alg":"EdDSA","typ":"JWT"}')
    payload = b64u_encode(b"[1,2,3]")
    sig = b64u_encode(b"\x00" * 64)
    assert decode_unsafe(f"{header}.{payload}.{sig}") is None


def test_sign_rejects_short_private_key() -> None:
    short_key = b64u_encode(b"\x00" * 16)  # 16 bytes — too short for Ed25519
    with pytest.raises(ValueError, match="32 bytes"):
        sign_agent_token(short_key, "a", "p", {"action": "x"})


def test_ttl_seconds_is_respected(keypair: Keypair) -> None:
    token = sign_agent_token(
        keypair.private_key,
        "a",
        "p",
        {"action": "x", "ttl_seconds": 30},
    )
    claims = decode_unsafe(token)
    assert claims is not None
    assert claims["exp"] - claims["iat"] == 30


def test_signature_is_64_bytes(keypair: Keypair) -> None:
    token = sign_agent_token(keypair.private_key, "a", "p", {"action": "x"})
    sig_b64 = token.split(".")[2]
    assert len(b64u_decode(sig_b64)) == 64  # Ed25519 signatures are 64 bytes


def test_payload_uses_compact_json(keypair: Keypair) -> None:
    """No whitespace in payload — keep it byte-exact with the TS SDK."""
    token = sign_agent_token(keypair.private_key, "a", "p", {"action": "x"})
    payload_json = b64u_decode(token.split(".")[1]).decode("utf-8")
    assert ", " not in payload_json
    assert ": " not in payload_json


def test_sign_requires_action() -> None:
    kp = generate_keypair()
    with pytest.raises(KeyError):
        sign_agent_token(kp.private_key, "a", "p", {})  # type: ignore[typeddict-item]


def test_sign_padding_handled() -> None:
    """Private key b64url with or without padding both work."""
    kp = generate_keypair()
    raw = b64u_decode(kp.private_key)
    padded = base64.urlsafe_b64encode(raw).decode("ascii")  # has padding
    unpadded = padded.rstrip("=")
    t1 = sign_agent_token(padded, "a", "p", {"action": "x"})
    t2 = sign_agent_token(unpadded, "a", "p", {"action": "x"})
    # Same key → both should be parseable
    assert decode_unsafe(t1) is not None
    assert decode_unsafe(t2) is not None
