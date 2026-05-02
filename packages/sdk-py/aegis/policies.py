"""Policy management — create, list, revoke."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ._http import HttpClient
from .models import (
    AgentPolicy,
    PolicyCreateRequest,
    PolicyRecord,
    PolicyScope,
)


def _scopes_to_jsonable(scopes: list[PolicyScope] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for s in scopes:
        if isinstance(s, PolicyScope):
            out.append(s.model_dump(by_alias=True, exclude_none=True))
        else:
            out.append(dict(s))
    return out


class PoliciesClient:
    """Async surface for ``/v1/agents/{agentId}/policies`` endpoints."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    async def create(
        self,
        agent_id: str,
        *,
        scopes: list[PolicyScope] | list[dict[str, Any]],
        expires_at: datetime | str,
        label: str | None = None,
    ) -> PolicyRecord:
        """Create a scoped permission policy for an agent.

        Args:
            agent_id: The agent receiving the policy.
            scopes: List of ``PolicyScope`` (or dicts in camelCase shape).
            expires_at: ISO-8601 string or aware ``datetime``.
            label: Optional human-readable label.

        Returns:
            ``PolicyRecord`` with the AEGIS-signed JWT in ``signed_token``.
        """
        # Normalize scopes through pydantic so we surface validation errors
        # client-side (rather than as a 400 from the server).
        normalized_scopes: list[PolicyScope] = []
        for s in scopes:
            if isinstance(s, PolicyScope):
                normalized_scopes.append(s)
            else:
                normalized_scopes.append(PolicyScope.model_validate(s))

        if isinstance(expires_at, str):
            # Validate format upfront — pydantic will turn this into a real datetime.
            req = PolicyCreateRequest(
                scopes=normalized_scopes,
                expires_at=datetime.fromisoformat(expires_at.replace("Z", "+00:00")),
                label=label,
            )
        else:
            req = PolicyCreateRequest(
                scopes=normalized_scopes,
                expires_at=expires_at,
                label=label,
            )

        body = req.model_dump(by_alias=True, exclude_none=True, mode="json")
        data = await self._http.request("POST", f"/agents/{agent_id}/policies", body=body)
        return PolicyRecord.model_validate(data)

    async def list(self, agent_id: str) -> list[AgentPolicy]:
        """List active policies for an agent."""
        data = await self._http.request("GET", f"/agents/{agent_id}/policies")
        if not isinstance(data, list):
            return []
        # type-rationale: server-shaped dicts; pydantic validates each.
        return [AgentPolicy.model_validate(item) for item in data]

    async def revoke(self, agent_id: str, policy_id: str) -> None:
        """Instantly revoke a policy. Subsequent ``verify`` calls return invalid."""
        await self._http.request(
            "DELETE", f"/agents/{agent_id}/policies/{policy_id}"
        )
