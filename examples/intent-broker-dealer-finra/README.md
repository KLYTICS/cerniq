# intent-broker-dealer-finra — Equity order routing under FINRA Rule 3110

End-to-end demonstration of an AI portfolio-rebalancing agent at a
FINRA-supervised broker-dealer placing an equity order under cryptographic
supervision.

## The scenario

A portfolio-rebalancing agent at `prn_alpha_capital_demo` places a single
limit order:

| Field         | Value                                                 |
| ------------- | ----------------------------------------------------- |
| Action        | `finra.equity.buy`                                    |
| Venue         | `NASDAQ` (encoded in `merchantId`)                    |
| Symbol / qty  | AAPL × 100                                            |
| Limit price   | $195.00                                               |
| Notional cap  | $19,500.00 (100 × $195.00)                            |
| Max calls     | 1                                                     |
| Reconciliation| `strict` — no tolerance on equity orders              |

FINRA Rule 3110 requires the broker-dealer to supervise all such orders.
The intent manifest provides the cryptographic supervision trail: signed
intent issued **before** the order hits the OMS, reconciled against the
fill report **after** execution.

## Run it

```sh
pnpm install
pnpm --filter @aegis-examples/intent-broker-dealer-finra demo
```

Expected output:

```
AEGIS Intent Manifest — Broker-dealer FINRA demo

[happy-path] decision=approved
[wrong-side-buy-to-sell] decision=denied reason=reconciliation_mismatch
  - wrong-endpoint: action finra.equity.sell ≠ finra.equity.buy
[over-notional-cap] decision=denied reason=reconciliation_mismatch
  - over-amount-cap: amount 20500.00 > cap 19500.00
[wrong-venue] decision=denied reason=reconciliation_mismatch
  - wrong-merchant: merchantId NYSE ≠ NASDAQ
```

## Mismatch → Rule 3110 supervisory ledger mapping

The kernel's `IntentMismatchKind` enum maps directly to supervisory
ledger entries:

| `IntentMismatchKind`      | Rule 3110 supervisory event                  |
| ------------------------- | -------------------------------------------- |
| `wrong-endpoint`          | Wrong side, symbol, or order type            |
| `over-amount-cap`         | Oversized notional (price slippage / attack) |
| `wrong-merchant`          | Wrong venue                                  |
| `over-call-count`         | Duplicate order submission                   |
| `manifest-expired`        | Stale-intent execution attempt               |
| `manifest-not-yet-valid`  | Clock skew or replay                         |

Every kind is a closed enum value the supervisor (or post-trade
surveillance) can route to a specific compliance workflow without parsing
free-form prose.

## Why this matters

AI agents in broker-dealer workflows are coming — portfolio rebalancing,
TWAP/VWAP execution, hedging — and FINRA supervision is *regulatory law*,
not "best practice." A broker-dealer that lets an AI agent route orders
without cryptographic supervision is one bad fill away from a Rule 3110
violation that took a human supervisor's approval to commit before the
agent era.

The intent manifest produces:

- **Pre-trade evidence:** signed intent issued before the order leaves
  the agent's control.
- **Post-trade evidence:** audit-chain entry tied to the manifest id,
  with the closed-enum deviation kind if any.
- **Cross-venue evidence:** because `merchantId` carries the venue, a
  routing-table compromise that silently rewrites the venue is caught
  the same way a different agent is caught.

## Production wiring

```ts
import { verifyIntent } from '@aegis/verifier-rp';

orderManager.on('orderRequest', async (request) => {
  const verify = verifyIntent({
    manifest: request.intentManifest,
    actuals: [],  // pre-execution: no actuals yet
    publicKeysByKid: jwks.keys(),
  });
  if (verify.kind === 'denied' && verify.reason.kind === 'manifest_signature') {
    return reject('signature_invalid');
  }
  // ...route the order to the venue...
});

orderManager.on('fillReport', async (fill) => {
  const reconcile = verifyIntent({
    manifest: fill.intentManifest,
    actuals: [observationFromFill(fill)],
    publicKeysByKid: jwks.keys(),
  });
  if (reconcile.kind === 'denied') {
    await supervisor.flag(fill, reconcile.reason);  // Rule 3110 trigger
  }
  // ... and post to /v1/intent/{id}/actuals with Idempotency-Key=fillId
  //     so partial-fill retries are dedupe'd by AEGIS.
});
```

## Related

- **Spec:** `docs/spec/AEGIS_API_SPEC.yaml` (`/v1/intent/*`)
- **ADRs:** `docs/decisions/0016-intent-manifest-kernel.md`, `0017-intent-manifest-runtime-issuance.md`
- **Sibling demos:** `intent-fintech-acp/`, `intent-treasury-iso20022/`
