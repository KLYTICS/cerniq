# AEGIS Relying-Party Compliance Dashboard

**"Audit our audit." The proof, not the prose.**

A runnable Express service that fetches AEGIS audit events + JWKS from a
live AEGIS instance and renders **chain integrity in real time**, using
only public discovery endpoints. No AEGIS-side trust required beyond the
published Ed25519 audit signing key.

This is the customer-side answer to *"how do we know your audit log is
real?"* — built in 30 seconds, deployable anywhere a Node 20+ container
can run.

## What it does

1. Polls `GET /.well-known/audit-signing-key` (slow, 1h cache) — public Ed25519 keys
2. Polls `GET /v1/audit/events?order=asc` (fast, 30s default) — event stream
3. Calls `verifyChain()` from [`@aegis/audit-verifier`](../../packages/audit-verifier/)
   — independent re-implementation of the chain construction, no AEGIS code path involved
4. Renders the verdict at `GET /`:
   - **Green** — chain intact, N events verified
   - **Red** — chain broken at event index X with reason Y
5. Exposes `GET /api/report` for programmatic consumers / CI alarms
6. Exposes `GET /health` for k8s probes (503 when chain breaks)

The dashboard auto-refreshes every 30s. The `/api/report` endpoint emits
the full structured `ChainReport` from `@aegis/audit-verifier` —
including per-row signature + link verdicts for the first 25 events.

## Quickstart (3 steps)

```sh
# 1. Install
pnpm install

# 2. Set env (production)
export AEGIS_API_BASE=https://api.aegislabs.io
export VERIFY_API_KEY=ak_verify_<your-verify-only-key>

# 3. Run
pnpm start

# Open http://localhost:8080
```

For local development against an in-development AEGIS:

```sh
AEGIS_API_BASE=http://localhost:3000 pnpm dev
# (no VERIFY_API_KEY needed if AEGIS allows unauthenticated audit reads
#  in dev mode — production always requires the verify-only key)
```

## Why a verify-only key, not a full management key

`/v1/audit/events` requires authentication to prevent enumeration
attacks. The verify-only key (`X-AEGIS-Verify-Key`) gives read-only
access to:
- `/v1/verify` (per-request decision lookup)
- `/v1/agents/:id/status` (agent revocation state)
- `/v1/audit/events` (this dashboard's source)

It cannot mint policies, register agents, or modify state. Mint one in
the dashboard at **Settings → API keys → New verify-only key**.

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `AEGIS_API_BASE` | yes | — | e.g. `https://api.aegislabs.io` |
| `VERIFY_API_KEY` | for prod | — | `ak_verify_...` for `/v1/audit/events` access |
| `PORT` | no | `8080` | HTTP listener |
| `POLL_INTERVAL_MS` | no | `30000` | how often to refetch + reverify |
| `MAX_EVENTS` | no | `1000` | bounded per-poll fetch |
| `PRINCIPAL_FILTER` | no | — | scope to one principal's events (for multi-tenant RPs) |

## What "chain intact" means

For every event row in the polled batch (`asc` order):

1. **Signature verifies** — `Ed25519.verify(jwks[event.signingKeyId], prev_hash ‖ canonical(payload)) == event.signature`
2. **Chain link valid** — `event.prevEventId == previous_row.id AND event.prevSignatureB64Url == previous_row.signature`

Both must hold for every row. Failure at row `i` means either:
- **Tampered payload** — `INVALID_SIGNATURE` (someone modified an event)
- **Reordered events** — `BROKEN_PREV_LINK` (an event was inserted or moved)
- **Unknown key** — `UNKNOWN_SIGNING_KEY` (the kid isn't in the JWKS — could be rotation; re-fetch JWKS and retry)
- **Out-of-order timestamps** — `OUT_OF_ORDER_TIMESTAMP` (suggests key compromise; report immediately)

The dashboard surfaces the **first** break it finds, with the exact
event id — so an SOC2 auditor has a precise starting point, not a
generic "something broke" message.

## Deploying as a customer-side compliance probe

This dashboard is designed to run **inside the customer's perimeter**,
not on AEGIS infrastructure. Typical deployments:

- **Vercel / Cloudflare Pages** — works as-is; the express server runs
  in any Node host. Set env vars in the platform's dashboard.
- **Kubernetes sidecar** — co-deploy with your monitoring stack. Wire
  `/health` to your existing readiness probe. Alert on 503.
- **Docker on a security-team VM** — single image, polls forever, posts
  to a Slack webhook when `chainIntact` flips false.

The polling cadence (`POLL_INTERVAL_MS=30000`) is gentle — well under
AEGIS's verify-only-key rate limits. For higher-frequency probing,
batch via the NDJSON export endpoint instead of paginated reads.

## What's NOT in this demo

- **Multi-window analysis** — this verifies a single rolling batch.
  Production compliance probes should checkpoint progress + verify
  forward-only across rolling windows.
- **Cryptographic timestamp anchoring** — for an extra layer of trust,
  pair this with an RFC 3161 timestamp service to prove "when AEGIS
  signed event X, this dashboard was already verifying it."
- **Slack / PagerDuty integration** — the `console.warn('[CHAIN-BREAK]')`
  log line carries everything needed; pipe through your log shipper.
- **Authentication** — the dashboard itself is unauthenticated. Run
  behind your VPN or a reverse proxy with SSO. Source code is small;
  add auth in 20 lines.

## Reference

- `@aegis/audit-verifier` — the canonical offline chain verifier
  ([package](../../packages/audit-verifier/))
- `docs/SECURITY.md` § "Audit chain integrity" — the protocol spec
- `apps/api/src/common/crypto/audit-chain.util.ts` — the signing side
  (byte-for-byte parity guarded by `tests/cross-package/audit-chain-parity.spec.ts`)
- `infra/observability/runbooks/audit-chain-break.md` — on-call playbook
  when this dashboard's `/health` goes 503
