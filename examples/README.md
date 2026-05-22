# OKORO — Examples

Two end-to-end examples that exercise the SDK against a running OKORO API.

| Example                  | Audience                                         | What it shows                                                                                          |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `node-quickstart`        | Developer wiring OKORO into their own app        | Register a principal → register an agent → create a policy → sign a request → verify it. End-to-end in 60 lines. |
| `relying-party-verifier` | The OTHER side — a service deciding whether to honor an AI agent's request | A tiny Express app (`POST /api/checkout`) that pulls `X-OKORO-Token`, calls `okoro.verify(...)`, and approves or denies the transaction. |

Both examples use the published SDK surface (`@okoro/sdk`) so they double as
SDK acceptance tests — if the example breaks, the SDK contract drifted.

## Prerequisites

Run the dev stack first:

```sh
# from repo root
docker compose -f infra/dev/docker-compose.dev.yml --env-file infra/dev/.env up -d --build
```

Then pick an example and follow its README. The `OKORO_API_BASE` env var
tells each example where to find the API (defaults to `http://localhost:4000`).
