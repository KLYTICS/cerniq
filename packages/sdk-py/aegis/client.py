"""Top-level AEGIS clients — :class:`AsyncAegis` (primary) + :class:`Aegis` sync wrapper."""

from __future__ import annotations

import asyncio
from datetime import datetime
from types import TracebackType
from typing import Any, Self

import httpx

from ._constants import DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS
from ._http import HttpClient
from .agents import AgentsClient
from .models import (
    AgentPolicy,
    AgentRecord,
    AgentStatusResponse,
    AuditLogResponse,
    Currency,
    PolicyRecord,
    PolicyScope,
    ReportAccepted,
    VerifyResult,
)
from .policies import PoliciesClient
from .verify import VerifyClient

__all__ = ["Aegis", "AsyncAegis"]


class AsyncAegis:
    """Async AEGIS client. Composition root for ``agents``, ``policies``, ``verify``.

    Example:
        >>> import asyncio
        >>> from aegis import AsyncAegis, generate_keypair
        >>> async def main() -> None:
        ...     kp = generate_keypair()
        ...     async with AsyncAegis(api_key="aegis_sk_example") as aegis:
        ...         agent = await aegis.agents.register(
        ...             public_key=kp.public_key,
        ...             runtime="anthropic",
        ...             principal_id="principal_acme",
        ...         )
        ...         _ = agent  # use agent.agent_id, agent.trust_score, ...
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        verify_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        user_agent: str | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._http = HttpClient(
            api_key=api_key,
            verify_key=verify_key,
            base_url=base_url,
            timeout_ms=timeout_ms,
            user_agent=user_agent,
            max_retries=max_retries,
            client=client,
        )
        self.agents = AgentsClient(self._http)
        self.policies = PoliciesClient(self._http)
        self._verify = VerifyClient(self._http)

    # ── lifecycle ────────────────────────────────────────────

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        """Close the underlying HTTP client (if owned)."""
        await self._http.aclose()

    # ── verify ──────────────────────────────────────────────

    async def verify(
        self,
        token: str,
        *,
        action: str | None = None,
        amount: float | None = None,
        currency: Currency | str | None = None,
        merchant_id: str | None = None,
        merchant_domain: str | None = None,
        min_trust_score: int | None = None,
        context: dict[str, Any] | None = None,
    ) -> VerifyResult:
        """Relying-party verify call. See :class:`VerifyClient.__call__`."""
        return await self._verify(
            token,
            action=action,
            amount=amount,
            currency=currency,
            merchant_id=merchant_id,
            merchant_domain=merchant_domain,
            min_trust_score=min_trust_score,
            context=context,
        )


class Aegis:
    """Sync facade over :class:`AsyncAegis`. Each method runs ``asyncio.run``.

    Use this only when you don't already have an event loop. For server-side
    code (FastAPI, ASGI, etc.) prefer :class:`AsyncAegis` directly.

    Closes its event loop / HTTP client on ``close()`` or context exit.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        verify_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        user_agent: str | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> None:
        self._kwargs: dict[str, Any] = {
            "api_key": api_key,
            "verify_key": verify_key,
            "base_url": base_url,
            "timeout_ms": timeout_ms,
            "user_agent": user_agent,
            "max_retries": max_retries,
        }
        # Sync facade groups
        self.agents = _SyncAgents(self)
        self.policies = _SyncPolicies(self)

    # ── lifecycle ────────────────────────────────────────────

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        """No-op — ``Aegis`` opens / closes the async client per call."""
        return None

    # ── verify ──────────────────────────────────────────────

    def verify(
        self,
        token: str,
        *,
        action: str | None = None,
        amount: float | None = None,
        currency: Currency | str | None = None,
        merchant_id: str | None = None,
        merchant_domain: str | None = None,
        min_trust_score: int | None = None,
        context: dict[str, Any] | None = None,
    ) -> VerifyResult:
        async def _go() -> VerifyResult:
            async with AsyncAegis(**self._kwargs) as a:
                return await a.verify(
                    token,
                    action=action,
                    amount=amount,
                    currency=currency,
                    merchant_id=merchant_id,
                    merchant_domain=merchant_domain,
                    min_trust_score=min_trust_score,
                    context=context,
                )

        return asyncio.run(_go())


# ── sync facades for sub-clients ────────────────────────────


class _SyncAgents:
    """Sync mirror of :class:`AgentsClient`. Each method runs ``asyncio.run``."""

    def __init__(self, parent: Aegis) -> None:
        self._parent = parent

    def register(
        self,
        *,
        public_key: str,
        runtime: str,
        principal_id: str,
        model: str | None = None,
        label: str | None = None,
    ) -> AgentRecord:
        async def _go() -> AgentRecord:
            async with AsyncAegis(**self._parent._kwargs) as a:
                return await a.agents.register(
                    public_key=public_key,
                    runtime=runtime,
                    principal_id=principal_id,
                    model=model,
                    label=label,
                )

        return asyncio.run(_go())

    def get(self, agent_id: str) -> AgentRecord:
        async def _go() -> AgentRecord:
            async with AsyncAegis(**self._parent._kwargs) as a:
                return await a.agents.get(agent_id)

        return asyncio.run(_go())

    def revoke(self, agent_id: str) -> None:
        async def _go() -> None:
            async with AsyncAegis(**self._parent._kwargs) as a:
                await a.agents.revoke(agent_id)

        asyncio.run(_go())

    def status(self, agent_id: str) -> AgentStatusResponse:
        async def _go() -> AgentStatusResponse:
            async with AsyncAegis(**self._parent._kwargs) as a:
                return await a.agents.status(agent_id)

        return asyncio.run(_go())

    def audit(
        self,
        agent_id: str,
        *,
        from_: str | None = None,
        to: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> AuditLogResponse:
        async def _go() -> AuditLogResponse:
            async with AsyncAegis(**self._parent._kwargs) as a:
                return await a.agents.audit(
                    agent_id, from_=from_, to=to, limit=limit, cursor=cursor
                )

        return asyncio.run(_go())

    def report(
        self,
        agent_id: str,
        *,
        event_type: str,
        severity: str = "medium",
        description: str | None = None,
        transaction_id: str | None = None,
        evidence: dict[str, Any] | None = None,
    ) -> ReportAccepted:
        async def _go() -> ReportAccepted:
            async with AsyncAegis(**self._parent._kwargs) as a:
                return await a.agents.report(
                    agent_id,
                    event_type=event_type,
                    severity=severity,
                    description=description,
                    transaction_id=transaction_id,
                    evidence=evidence,
                )

        return asyncio.run(_go())


class _SyncPolicies:
    """Sync mirror of :class:`PoliciesClient`."""

    def __init__(self, parent: Aegis) -> None:
        self._parent = parent

    def create(
        self,
        agent_id: str,
        *,
        scopes: list[PolicyScope] | list[dict[str, Any]],
        expires_at: datetime | str,
        label: str | None = None,
    ) -> PolicyRecord:
        async def _go() -> PolicyRecord:
            async with AsyncAegis(**self._parent._kwargs) as a:
                return await a.policies.create(
                    agent_id, scopes=scopes, expires_at=expires_at, label=label
                )

        return asyncio.run(_go())

    def list(self, agent_id: str) -> list[AgentPolicy]:
        async def _go() -> list[AgentPolicy]:
            async with AsyncAegis(**self._parent._kwargs) as a:
                return await a.policies.list(agent_id)

        return asyncio.run(_go())

    def revoke(self, agent_id: str, policy_id: str) -> None:
        async def _go() -> None:
            async with AsyncAegis(**self._parent._kwargs) as a:
                await a.policies.revoke(agent_id, policy_id)

        asyncio.run(_go())
