# offline-verifier-rp

The OKORO **neutrality wedge** demonstrated as a single command.

A relying party — a merchant, a bank, an auditor, a compliance system —
verifies three OKORO-signed agent receipts (valid, revoked-agent,
tampered-signature) and arrives at the correct decision for each one
**without making any runtime network call to OKORO**.

This is what "neutral verification layer" means as code rather than as
marketing. OKORO can be offline, on fire, or compromised, and the
verification still works correctly because the only inputs the relying
party needs are:

1. the **agent's Ed25519 public key** — published openly by OKORO via
   its JWKS endpoint, refreshed at the RP's discretion; and
2. an **agent-status snapshot** — `active` / `revoked` / `suspended`,
   refreshed at most once every few minutes.

OKORO never sees the agent's private key. The relying party never
needs a session with OKORO at request time.

## Run

```sh
pnpm install
pnpm --filter @okoro-examples/offline-verifier-rp demo
```

Expected output:

```
OKORO offline relying-party verification — no calls to OKORO
===============================================================
  scenario             | expected            | actual              | result
  ---------------------+---------------------+---------------------+-------
  valid receipt        | valid               | valid               | PASS
  revoked agent        | AGENT_REVOKED       | AGENT_REVOKED       | PASS
  tampered signature   | INVALID_SIGNATURE   | INVALID_SIGNATURE   | PASS

All scenarios behaved as documented.
Every decision above was reached without a single network call to OKORO.
```

Exit code is `0` when every scenario matches, `1` on regression — safe
to wire into CI as a contract test against the relying-party verifier.

## How the demo proves "no calls to OKORO"

The verifier accepts an injected `fetch` implementation. This demo
passes one that:

- returns a canned agent-status response when asked about the demo
  agent, and
- **throws loudly** for any other URL — so if a future change makes
  the verifier reach for an unexpected endpoint, this demo fails in
  CI before that change reaches a customer.

Read [src/demo.ts](src/demo.ts) — there is no `https://` URL anywhere
except a deliberately invalid sentinel (`https://offline.invalid/v1`)
that the fetch shim will never let escape the process.

## What this demo deliberately does not cover

- **Revocation freshness.** A real RP refreshes its agent-status
  snapshot periodically. This demo hard-codes the snapshot per
  scenario. Production RPs use the `RevocationCache` and webhook
  handler exported from `@okoro/verifier-rp`.
- **JWKS rotation.** The demo resolves the agent's public key via the
  `getAgentPublicKey` callback. Production RPs typically use the
  bundled `JwksClient` against OKORO's signed JWKS endpoint, which
  rotates on a documented cadence.
- **Replay defense.** The demo issues each token freshly, so the
  default `MemoryReplayCache` is sufficient. Production RPs distribute
  the replay cache across instances (Redis, Memcached, etc.) using the
  `ReplayCache` interface.
- **Intent-manifest binding.** Separate wedge surface, covered by
  `verifyIntent` in `@okoro/verifier-rp` and demonstrated in
  `examples/intent-broker-dealer-finra` and siblings.
- **Audit-chain forensic verification.** Separate wedge surface, covered
  by `verifyAuditChain` in `@okoro/verifier-rp` — a SOC 2 auditor walks
  the full append-only chain offline. See the chain primitive's tests
  in `packages/verifier-rp/test/audit-chain.spec.ts`.

## Procurement notes

This example is the artifact to point a CISO or third-party auditor at
when the question is *"How do we know OKORO can't see, modify, or
withhold our verification decisions?"* The answer is the code in
[src/demo.ts](src/demo.ts) plus the dependency graph: `@okoro/sdk` for
signing, `@okoro/verifier-rp` for verifying. No transport, no broker,
no service in the middle at decision time.

## Related

- [examples/relying-party-verifier](../relying-party-verifier) — the
  *online* RP pattern, where the merchant calls back to the OKORO API
  for verification (lower operational burden, requires OKORO to be
  reachable).
- [packages/verifier-rp/README.md](../../packages/verifier-rp/README.md)
  — the full API surface of the offline verifier library.
- [docs/SECURITY.md](../../docs/SECURITY.md) § "Denial precedence" —
  the canonical ordering this demo exercises three reasons of.
- [docs/decisions/0004-denial-precedence-public-api.md](../../docs/decisions/0004-denial-precedence-public-api.md)
  — the ADR pinning the 12-reason precedence as part of the public API.
