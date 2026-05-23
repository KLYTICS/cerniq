# intent-fintech-acp — Agentic Commerce Protocol with AEGIS Intent Manifest

End-to-end demonstration of an ACP merchant verifying an AEGIS Intent Manifest
**locally**, with no AEGIS API in the request path.

## The scenario

An AI shopping agent is buying flowers on behalf of a user at `ACME-FLORIST`.
Before the charge runs, the agent (via AEGIS) issues a signed intent manifest
declaring:

| Field         | Value                          |
| ------------- | ------------------------------ |
| Action        | `acp.payment`                  |
| Merchant      | `ACME-FLORIST` (exact match)   |
| Amount cap    | $200.00 USD (per-call)         |
| Max calls     | 1                              |
| Reconciliation| `strict` — any mismatch denies |

The merchant receives the signed manifest alongside the verify token, calls
`verifyIntent({ manifest, actuals, publicKeysByKid })` from `@aegis/verifier-rp`,
and gets a closed-enum outcome to switch on.

## Run it

```sh
pnpm install               # from repo root
pnpm --filter @aegis-examples/intent-fintech-acp demo
```

Expected output:

```
AEGIS Intent Manifest — ACP merchant demo

[happy-path] decision=approved
[over-amount-cap] decision=denied reason=reconciliation_mismatch
  - over-amount-cap: amount 250.00 > cap 200.00
[wrong-merchant] decision=denied reason=reconciliation_mismatch
  - wrong-merchant: merchantId ROGUE-MERCHANT ≠ ACME-FLORIST
```

## Why this matters

Without an intent binding, a compromised agent can run any amount at any
merchant — the AEGIS verify token authorizes the agent's *existence* but not
the *action's bounds*. The Intent Manifest closes this gap: the agent
cryptographically commits to a bounded action *before* taking it, and the
merchant verifies the binding *locally* (no AEGIS roundtrip on the hot path).

When the merchant detects a mismatch, it emits `INTENT_MISMATCH_OBSERVED` to
AEGIS asynchronously. The agent's trust score drops by up to 300 points per
window (see `apps/api/src/modules/bate/bate.weights.ts:57`), and the next
`/v1/verify` call against ANY relying party returns `TRUST_SCORE_TOO_LOW` —
the penalty travels with the agent across the entire AEGIS-protected surface.

## Production wiring

The merchant code in production is the same shape as the demo:

```ts
import { verifyIntent } from '@aegis/verifier-rp';

app.post('/api/charge', async (req, res) => {
  const outcome = verifyIntent({
    manifest: req.body.intentManifest,
    actuals: [observationFromRequest(req)],
    publicKeysByKid: await aegisJwksCache.keys(),  // /.well-known/audit-signing-key
  });
  if (outcome.kind === 'denied') {
    return res.status(403).json({ reason: outcome.reason.kind });
  }
  // ...process the charge, then async-emit to /v1/intent/{id}/actuals
});
```

Three lines, per Testament Book I §3.

## Wire surface

- **Issuance:** `POST /v1/intent` — `apps/api/src/modules/intent/intent.controller.ts`
- **Reconciliation:** `POST /v1/intent/{manifestId}/actuals` (Idempotency-Key required)
- **Read-back:** `GET /v1/intent/{manifestId}`

All gated behind `AEGIS_INTENT_MANIFEST_ENABLED=true` (Phase 2 default: off,
pending OD-018 Postgres adapter).

## Related

- **Spec:** `docs/spec/AEGIS_API_SPEC.yaml` (`/v1/intent/*`)
- **ADRs:** `docs/decisions/0016-intent-manifest-kernel.md`, `0017-intent-manifest-runtime-issuance.md`
- **Sibling demos:** `intent-treasury-iso20022/`, `intent-broker-dealer-finra/`
