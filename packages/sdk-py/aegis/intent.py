"""Intent Manifest client — wraps the ``/v1/intent`` surface (ADR-0017).

Mirrors :class:`IntentClient` in ``packages/sdk-ts/src/intent.ts``. Issues
signed intent manifests, reconciles observed actuals against them, and
reads stored manifest snapshots.

Cross-RP replay defense (IM-T2) is a relying-party concern handled by
``@aegis/verifier-rp``; this issuer-side client does NOT bind to
``expectedVerifyTokenJti`` because issuance happens before the agent
attempts the bound action.

Example::

    from aegis import AsyncAegis

    async with AsyncAegis(api_key="aegis_sk_...") as aegis:
        issued = await aegis.intent.issue(
            agent_id="agt_...",
            verify_token_jti="01HZ...",
            verify_token_sha256_b64url="abc...",
            intent={
                "kind": "commerce-action",
                "action": "stripe.charge",
                "maxCalls": 1,
                "merchantId": "merch_acme",
                "amountCap": {"amount": "25.00", "currency": "USD"},
            },
        )
        # ... agent performs the bound tool call ...
        result = await aegis.intent.reconcile(
            issued["manifestId"],
            idempotency_key=f"recon-{issued['manifestId']}-1",
            actuals=[
                {
                    "observedAt": 1_715_000_000,
                    "kind": "commerce-action",
                    "payload": {
                        "action": "stripe.charge",
                        "merchantId": "merch_acme",
                        "amount": "24.00",
                    },
                }
            ],
        )
        if result.get("recommendedDenialReason"):
            ...  # deny + refund + alert
"""

from __future__ import annotations

from typing import Any

from ._constants import AEGIS_HEADER_IDEMPOTENCY
from ._http import HttpClient
from .errors import NotFoundError


class IntentClient:
    """Async surface for ``/v1/intent/...`` endpoints.

    The Python SDK accepts plain ``dict`` payloads for ``intent`` and
    ``actuals`` in v1 — pydantic models for ``IntentClaim`` /
    ``ActualCallObservation`` may land later once they exist in
    ``packages/types`` and are generated into this SDK. Server-side
    validation is the source of truth either way.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    async def issue(
        self,
        *,
        agent_id: str,
        verify_token_jti: str,
        verify_token_sha256_b64url: str,
        intent: dict[str, Any],
        reconciliation: dict[str, Any] | None = None,
        ttl_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Issue a signed intent manifest bound to a verify-token jti.

        Server-side defaults (per ADR-0017 Phase 2): ``strictness='strict'``,
        ``ttlSeconds=60`` (clamped to ``[30, 60]``).

        Args:
            agent_id: The agent the manifest is issued for.
            verify_token_jti: ``jti`` of the verify token this manifest
                binds to.
            verify_token_sha256_b64url: Base64URL SHA-256 of the verify
                token bytes.
            intent: Discriminated union — one of ``http-call``,
                ``commerce-action``, or ``tool-invocation``. Shape per
                ``packages/types`` ``IntentClaim``.
            reconciliation: Optional ``ReconciliationPolicy``. Defaults
                server-side to ``{"strictness": "strict"}``.
            ttl_seconds: Optional TTL override. Clamped server-side.

        Returns:
            ``{ "manifestId": str, "signedManifest": ..., "expiresAt": int }``.

        Raises:
            AegisError: A typed subclass on 4xx/5xx (see ``errors``).
        """
        body: dict[str, Any] = {
            "agentId": agent_id,
            "verifyTokenJti": verify_token_jti,
            "verifyTokenSha256B64Url": verify_token_sha256_b64url,
            "intent": intent,
        }
        if reconciliation is not None:
            body["reconciliation"] = reconciliation
        if ttl_seconds is not None:
            body["ttlSeconds"] = ttl_seconds

        data = await self._http.request("POST", "/intent", body=body)
        if not isinstance(data, dict):
            # Defensive: server contract says dict; surface anything else as
            # a clearly-wrong shape rather than silently passing through.
            raise TypeError(
                f"AEGIS /v1/intent returned non-dict body: {type(data).__name__}"
            )
        return data

    async def reconcile(
        self,
        manifest_id: str,
        *,
        idempotency_key: str,
        actuals: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Reconcile observed actuals against the manifest.

        ``Idempotency-Key`` is REQUIRED per ADR-0017. Collisions on the
        same key + same body return the prior result (replay); collisions
        on same key + different body raise :class:`ConflictError`
        (HTTP 409 ``IDEMPOTENCY_CONFLICT``).

        Args:
            manifest_id: The manifest id returned from :meth:`issue`.
            idempotency_key: Client-chosen idempotency key. Sent as the
                ``Idempotency-Key`` header.
            actuals: List of ``ActualCallObservation`` dicts.

        Returns:
            ``ReconciliationResult``-shaped dict, optionally with
            ``idempotencyReplay: True`` when the key replayed.
        """
        path = f"/intent/{_quote_path_segment(manifest_id)}/actuals"
        data = await self._http.request(
            "POST",
            path,
            body={"actuals": actuals},
            extra_headers={AEGIS_HEADER_IDEMPOTENCY: idempotency_key},
        )
        if not isinstance(data, dict):
            raise TypeError(
                f"AEGIS /v1/intent/{{id}}/actuals returned non-dict body: "
                f"{type(data).__name__}"
            )
        return data

    async def get(self, manifest_id: str) -> dict[str, Any] | None:
        """Read a stored manifest + reconciliation outcome.

        Returns ``None`` if the manifest is unknown (HTTP 404). Other
        errors raise per the standard error catalog.
        """
        path = f"/intent/{_quote_path_segment(manifest_id)}"
        try:
            data = await self._http.request("GET", path)
        except NotFoundError:
            return None
        if data is None:
            return None
        if not isinstance(data, dict):
            raise TypeError(
                f"AEGIS /v1/intent/{{id}} returned non-dict body: "
                f"{type(data).__name__}"
            )
        return data


def _quote_path_segment(value: str) -> str:
    """URL-encode a path segment.

    ``manifest_id`` is server-generated and ULID-shaped today, but quote
    defensively so a future change in id format doesn't break the URL.
    Mirrors ``encodeURIComponent`` in the TS SDK.
    """
    from urllib.parse import quote

    # ``safe=""`` so even sub-delims are escaped — matches encodeURIComponent.
    return quote(value, safe="")
