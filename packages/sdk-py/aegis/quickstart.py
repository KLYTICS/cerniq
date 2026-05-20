"""One-call onboarding helper for the AEGIS Python SDK — Round 25 seed.

Mirror of the TS SDK's ``Aegis.quickstart()``. Collapses the canonical
5-step flow (generate keypair → register agent → mint policy → sign
per-request → verify) into a single call so juniors hit a working
``verify`` in <60 seconds.

Example:

    import asyncio
    from aegis.quickstart import quickstart

    async def main():
        bundle = await quickstart(label="my-first-agent")
        token = await bundle.sign(action="commerce.purchase", amount=100)
        async with bundle.client as aegis:
            result = await aegis.verify(token)
            print("ok" if result.valid else result.denial_reason)

    asyncio.run(main())

The keypair lives on disk at ``~/.aegis/keys/<label>.json`` (mode 0600)
when the filesystem is writable, in memory otherwise (Lambda).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

from .client import AsyncAegis
from .crypto import (
    SignContext,
    generate_keypair,
    sign_agent_token,
)
from .key_storage import KeyStorage, StoredKey, default_key_storage
from .models import AgentRecord, PolicyRecord, PolicyScope
from .runtime import PythonRuntime, detect_runtime

DEFAULT_LABEL = "aegis-quickstart"
DEFAULT_RUNTIME = "anthropic"
DEFAULT_POLICY_TTL = timedelta(hours=24)
DEFAULT_SCOPES: list[dict[str, Any]] = [
    {
        "category": "commerce",
        "spendLimit": {
            "currency": "USD",
            "maxPerTransaction": 100,
            "maxPerDay": 500,
        },
    },
]


@dataclass
class QuickstartBundle:
    """Returned by :func:`quickstart`."""

    client: AsyncAegis
    """Configured AEGIS client (entered context manager on first await use)."""

    agent: AgentRecord
    """The registered agent."""

    policy: PolicyRecord
    """The freshly-minted policy."""

    sign: Callable[..., Awaitable[str]]
    """Pre-bound signer. Pass the same kwargs as :func:`sign_agent_token`'s
    ``SignContext`` (``action``, ``amount``, ``currency``, ``merchant_domain``,
    ``merchant_id``, ``ttl_seconds``). Returns the signed token string.
    """

    runtime: PythonRuntime
    """Detected runtime for telemetry / debugging."""

    storage: KeyStorage
    """The KeyStorage adapter that holds the keypair."""

    key_name: str
    """Storage key name, in case the caller wants to rebind later."""


def _resolve_api_key(explicit: Optional[str]) -> str:
    """Resolve API key from explicit arg, falling back to ``AEGIS_API_KEY`` env."""
    if explicit:
        return explicit
    from_env = os.environ.get("AEGIS_API_KEY", "")
    if from_env:
        return from_env
    raise ValueError(
        "quickstart: api_key not provided. "
        "Set AEGIS_API_KEY in your environment, or pass api_key= to quickstart() "
        "(https://docs.aegislabs.io/errors/auth_required)",
    )


async def quickstart(
    *,
    api_key: Optional[str] = None,
    principal_id: Optional[str] = None,
    label: str = DEFAULT_LABEL,
    runtime: str = DEFAULT_RUNTIME,
    storage: Optional[KeyStorage] = None,
    key_name: Optional[str] = None,
    scopes: Optional[list[dict[str, Any]] | list[PolicyScope]] = None,
    policy_expires_at: Optional[datetime] = None,
    base_url: Optional[str] = None,
) -> QuickstartBundle:
    """One-call onboarding. Returns a :class:`QuickstartBundle`.

    Args:
        api_key: AEGIS API key. Falls back to ``AEGIS_API_KEY`` env.
        principal_id: AEGIS principal id. Required for registration.
        label: Human-readable label for the agent. Default ``"aegis-quickstart"``.
        runtime: Agent runtime. Default ``"anthropic"``.
        storage: KeyStorage adapter. Default: runtime-appropriate (filesystem
            on writable runtimes, memory on Lambda).
        key_name: Storage key name. Defaults to ``label``.
        scopes: Override the default permissive policy scopes.
        policy_expires_at: Override the default 24-hour expiry.
        base_url: Override the AEGIS API endpoint.
    """
    resolved_key = _resolve_api_key(api_key)
    if not principal_id:
        principal_id = os.environ.get("AEGIS_PRINCIPAL_ID", "")
    if not principal_id:
        raise ValueError(
            "quickstart: principal_id not provided. "
            "Pass principal_id= or set AEGIS_PRINCIPAL_ID env var.",
        )

    name = key_name or label
    store = storage or default_key_storage()
    detected = detect_runtime()

    client_kwargs: dict[str, Any] = {"api_key": resolved_key}
    if base_url:
        client_kwargs["base_url"] = base_url
    client = AsyncAegis(**client_kwargs)

    # Step 1 — load or generate the keypair.
    stored = await store.get(name)
    if stored is None:
        kp = generate_keypair()
        stored = StoredKey(
            private_key=kp.private_key,
            public_key=kp.public_key,
            created_at=datetime.now(timezone.utc).isoformat(),
            label=label,
        )
        await store.put(name, stored)

    # Step 2 — register or reuse.
    if stored.agent_id:
        try:
            agent = await client.agents.get(stored.agent_id)
        except Exception:
            # Stale binding — re-register and update storage.
            agent = await client.agents.register(
                public_key=stored.public_key,
                runtime=runtime,
                principal_id=principal_id,
                label=label,
            )
            stored = StoredKey(
                private_key=stored.private_key,
                public_key=stored.public_key,
                created_at=stored.created_at,
                agent_id=agent.agent_id,
                label=label,
            )
            await store.put(name, stored)
    else:
        agent = await client.agents.register(
            public_key=stored.public_key,
            runtime=runtime,
            principal_id=principal_id,
            label=label,
        )
        stored = StoredKey(
            private_key=stored.private_key,
            public_key=stored.public_key,
            created_at=stored.created_at,
            agent_id=agent.agent_id,
            label=label,
        )
        await store.put(name, stored)

    # Step 3 — mint policy.
    expiry = policy_expires_at or (datetime.now(timezone.utc) + DEFAULT_POLICY_TTL)
    policy = await client.policies.create(
        agent.agent_id,
        scopes=scopes or DEFAULT_SCOPES,
        expires_at=expiry,
        label=f"{label}-policy",
    )

    # Step 4 — pre-bound signer closure.
    private_key = stored.private_key
    agent_id = agent.agent_id
    policy_id = policy.policy_id

    async def _sign(**kwargs: Any) -> str:
        ctx = SignContext(**kwargs)
        return sign_agent_token(private_key, agent_id, policy_id, ctx)

    return QuickstartBundle(
        client=client,
        agent=agent,
        policy=policy,
        sign=_sign,
        runtime=detected,
        storage=store,
        key_name=name,
    )


__all__ = ["QuickstartBundle", "quickstart"]
