"""Agent management — register, get, revoke, status, audit, report."""

from __future__ import annotations

from typing import Any

from ._http import HttpClient
from .models import (
    AgentRecord,
    AgentRegistrationRequest,
    AgentStatusResponse,
    AuditLogResponse,
    PolicyScope,
    ReportAccepted,
    ReportRequest,
)


def _scopes_to_jsonable(scopes: list[PolicyScope] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Accept both pydantic ``PolicyScope`` and raw dicts; emit camelCase JSON."""
    out: list[dict[str, Any]] = []
    for s in scopes:
        if isinstance(s, PolicyScope):
            out.append(s.model_dump(by_alias=True, exclude_none=True))
        else:
            out.append(dict(s))
    return out


class AgentsClient:
    """Async surface for ``/v1/agents/...`` endpoints. Composed by ``AsyncOkoro``."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    async def register(
        self,
        *,
        public_key: str,
        runtime: str,
        principal_id: str,
        model: str | None = None,
        label: str | None = None,
    ) -> AgentRecord:
        """Register a new agent identity. Private key never leaves your host.

        Args:
            public_key: Ed25519 public key, base64url. From ``generate_keypair``.
            runtime: One of ``openai`` / ``anthropic`` / ``google`` /
                ``huggingface`` / ``custom``.
            principal_id: Your OKORO principal (org / user) id.
            model: Optional model name, e.g. ``"claude-sonnet-4-5"``.
            label: Optional human-readable label.

        Returns:
            The registered ``AgentRecord``.
        """
        body = AgentRegistrationRequest.model_validate(
            {
                "publicKey": public_key,
                "runtime": runtime,
                "principalId": principal_id,
                "model": model,
                "label": label,
            }
        ).model_dump(by_alias=True, exclude_none=True)
        data = await self._http.request("POST", "/agents/register", body=body)
        return AgentRecord.model_validate(data)

    async def get(self, agent_id: str) -> AgentRecord:
        """Fetch an agent by id."""
        data = await self._http.request("GET", f"/agents/{agent_id}")
        return AgentRecord.model_validate(data)

    async def revoke(self, agent_id: str) -> None:
        """Permanently revoke an agent. Cannot be undone."""
        await self._http.request("DELETE", f"/agents/{agent_id}")

    async def status(self, agent_id: str) -> AgentStatusResponse:
        """Public status + trust score. Doesn't require an API key.

        The SDK still sends whichever key is configured for consistency, but
        the server permits unauthenticated access to this endpoint.
        """
        data = await self._http.request("GET", f"/agents/{agent_id}/status")
        return AgentStatusResponse.model_validate(data)

    async def audit(
        self,
        agent_id: str,
        *,
        from_: str | None = None,
        to: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> AuditLogResponse:
        """Fetch the audit log for an agent. Use ``from_`` / ``to`` (ISO-8601)
        to bound by date and ``cursor`` to paginate.
        """
        params = {"from": from_, "to": to, "limit": limit, "cursor": cursor}
        data = await self._http.request("GET", f"/agents/{agent_id}/audit", params=params)
        return AuditLogResponse.model_validate(data)

    async def report(
        self,
        agent_id: str,
        *,
        event_type: str,
        severity: str = "medium",
        description: str | None = None,
        transaction_id: str | None = None,
        evidence: dict[str, Any] | None = None,
    ) -> ReportAccepted:
        """Report a behavioral signal (fraud, anomaly, policy violation, etc.).

        Signals feed BATE and affect the agent's trust score.
        """
        body = ReportRequest.model_validate(
            {
                "eventType": event_type,
                "severity": severity,
                "description": description,
                "transactionId": transaction_id,
                "evidence": evidence,
            }
        ).model_dump(by_alias=True, exclude_none=True)
        data = await self._http.request("POST", f"/agents/{agent_id}/report", body=body)
        if data is None:
            return ReportAccepted(accepted=True)
        return ReportAccepted.model_validate(data)
