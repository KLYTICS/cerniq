# aegis (Python)

The official AEGIS SDK for Python. AEGIS is the neutral verification, policy
enforcement, and behavioral attestation layer between AI agents and the
services they act on. Private keys never leave your host — only public keys
register with AEGIS.

- Async-first via `httpx`
- Ed25519 via `cryptography`
- Bit-identical token format to the TypeScript SDK (`@aegis/sdk`)
- Strict typing — `mypy --strict` clean
- Sync and async surfaces

## Install

```bash
pip install aegis
```

Requires Python 3.11+.

## Quickstart

### Generate a keypair, register an agent, mint a policy

```python
import asyncio
import os

from aegis import AsyncAegis, generate_keypair


async def main() -> None:
    # Private key stays on this host — AEGIS only sees the public half.
    kp = generate_keypair()

    async with AsyncAegis(api_key=os.environ["AEGIS_API_KEY"]) as aegis:
        agent = await aegis.agents.register(
            public_key=kp.public_key,
            runtime="anthropic",
            principal_id="principal_acme",
            model="claude-sonnet-4-5",
            label="checkout-bot",
        )
        # Example agent_id shape: agt_01HZ9YZXM4QT3B7P8WKJD6R5V
        print("registered:", agent.agent_id)

        policy = await aegis.policies.create(
            agent.agent_id,
            scopes=[
                {
                    "category": "commerce",
                    "spendLimit": {"currency": "USD", "maxPerTransaction": 500},
                    "allowedDomains": ["delta.com"],
                }
            ],
            expires_at="2026-06-01T00:00:00Z",
            label="book-flights-under-500",
        )
        print("policy:", policy.policy_id)


asyncio.run(main())
```

### Sign a per-request agent token

```python
from aegis import sign_agent_token

token = sign_agent_token(
    private_key_b64u=kp.private_key,
    agent_id=agent.agent_id,
    policy_id=policy.policy_id,
    ctx={
        "action": "commerce.purchase",
        "amount": 347,
        "currency": "USD",
        "merchant_domain": "delta.com",
    },
)
# Hand `token` to the relying party in your usual way.
```

### Relying-party verify

```python
import asyncio

from aegis import AsyncAegis


async def check(token: str) -> None:
    async with AsyncAegis(verify_key=os.environ["AEGIS_VERIFY_KEY"]) as aegis:
        result = await aegis.verify(
            token,
            action="commerce.purchase",
            amount=347,
            currency="USD",
            merchant_domain="delta.com",
        )
        if not result.valid:
            raise PermissionError(result.denial_reason)


asyncio.run(check("eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9..."))
```

### Sync surface

If you don't have an event loop, use `Aegis` (a thin sync wrapper):

```python
from aegis import Aegis, generate_keypair

kp = generate_keypair()

with Aegis(api_key="aegis_sk_...") as aegis:
    agent = aegis.agents.register(
        public_key=kp.public_key,
        runtime="custom",
        principal_id="principal_acme",
    )
```

## Configuration

| Argument        | Default                              | Notes                                                      |
| --------------- | ------------------------------------ | ---------------------------------------------------------- |
| `api_key`       | required for management calls        | Header `X-AEGIS-API-Key`                                   |
| `verify_key`    | required only for `verify()`         | Header `X-AEGIS-Verify-Key`                                |
| `base_url`      | `https://api.aegislabs.io/v1`        | Override for sandbox/self-hosted                           |
| `timeout_ms`    | `5000`                               | Per-request timeout                                        |
| `user_agent`    | `aegis-python/<version>`             | Sent on every request                                      |
| `max_retries`   | `3`                                  | Exponential backoff (250ms, 500ms, 1000ms) on 5xx + connect errors |

## Errors

All HTTP failures raise a typed `AegisError` subclass:

| Status | Exception              |
| ------ | ---------------------- |
| 400    | `ValidationError`      |
| 401    | `AuthError`            |
| 403    | `AuthError`            |
| 404    | `NotFoundError`        |
| 429    | `RateLimitedError`     |
| 5xx    | `ServerError`          |

`AegisError` exposes `.status_code`, `.request_id`, `.code`, and `.details`.

## License

MIT — © KLYTICS LLC.
