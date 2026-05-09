"""Tests for PoliciesClient (create / list / revoke)."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

if sys.version_info >= (3, 11):
    from datetime import UTC
else:
    UTC = timezone.utc
from typing import Any

from aegis import AsyncAegis, PolicyRecord, PolicyScope


async def test_create_policy_with_dict_scopes(
    aegis: AsyncAegis,
    respx_mock: Any,
    sample_policy_record: dict[str, Any],
) -> None:
    route = respx_mock.post("/agents/agt_x/policies").respond(201, json=sample_policy_record)
    policy = await aegis.policies.create(
        "agt_x",
        scopes=[
            {
                "category": "commerce",
                "spendLimit": {"currency": "USD", "maxPerTransaction": 500},
                "allowedDomains": ["delta.com"],
            }
        ],
        expires_at="2026-06-01T00:00:00Z",
        label="example-flights",
    )
    assert isinstance(policy, PolicyRecord)
    assert policy.policy_id == sample_policy_record["policyId"]
    assert policy.signed_token.count(".") == 2  # JWT shape

    body = json.loads(route.calls.last.request.content.decode())
    assert body["scopes"][0]["category"] == "commerce"
    assert body["scopes"][0]["spendLimit"]["currency"] == "USD"
    assert body["scopes"][0]["allowedDomains"] == ["delta.com"]
    assert body["label"] == "example-flights"
    assert body["expiresAt"].startswith("2026-06-01")


async def test_create_policy_with_pydantic_scopes(
    aegis: AsyncAegis,
    respx_mock: Any,
    sample_policy_record: dict[str, Any],
) -> None:
    respx_mock.post("/agents/agt_x/policies").respond(201, json=sample_policy_record)
    scope = PolicyScope.model_validate(
        {
            "category": "data-read",
            "dataScopes": ["read:email"],
        }
    )
    policy = await aegis.policies.create(
        "agt_x",
        scopes=[scope],
        expires_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    assert policy.policy_id == sample_policy_record["policyId"]


async def test_list_policies(aegis: AsyncAegis, respx_mock: Any) -> None:
    server = [
        {
            "policyId": "pol_a",
            "agentId": "agt_x",
            "scopes": [{"category": "commerce"}],
            "status": "active",
            "createdAt": "2026-05-01T00:00:00+00:00",
            "expiresAt": "2026-06-01T00:00:00+00:00",
            "label": None,
        },
        {
            "policyId": "pol_b",
            "agentId": "agt_x",
            "scopes": [{"category": "data-read"}],
            "status": "expired",
            "createdAt": "2026-04-01T00:00:00+00:00",
            "expiresAt": "2026-04-30T00:00:00+00:00",
            "label": "old",
        },
    ]
    respx_mock.get("/agents/agt_x/policies").respond(200, json=server)
    policies = await aegis.policies.list("agt_x")
    assert len(policies) == 2
    assert policies[0].policy_id == "pol_a"
    assert policies[1].status == "expired"


async def test_revoke_policy(aegis: AsyncAegis, respx_mock: Any) -> None:
    route = respx_mock.delete("/agents/agt_x/policies/pol_a").respond(204)
    res = await aegis.policies.revoke("agt_x", "pol_a")
    assert res is None
    assert route.called
