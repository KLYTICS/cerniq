# intent-treasury-iso20022 — Corporate treasury wires with AEGIS Intent Manifest

End-to-end demonstration of an AI treasury agent executing an ISO 20022
`pacs.008` wire under cryptographic intent supervision.

## The scenario

An AI treasury agent at a corporate TMS executes a single wire:

| Field         | Value                                            |
| ------------- | ------------------------------------------------ |
| Action        | `iso20022.pacs.008`                              |
| Beneficiary   | `BENEF_GMBH_DE89AB` (encoded in `merchantId`)    |
| Amount cap    | EUR 50,000.00                                    |
| Max calls     | 1                                                |
| Reconciliation| `graduated`, tolerance 5%                        |

The treasury platform verifies the signed manifest, dispatches the SWIFT
MT103 / ISO 20022 `pacs.008` message, then reconciles the settlement
notification against the declared intent.

## Run it

```sh
pnpm install
pnpm --filter @aegis-examples/intent-treasury-iso20022 demo
```

Expected output:

```
AEGIS Intent Manifest — Treasury ISO 20022 demo

[happy-path] decision=approved
[wrong-beneficiary-hijack] decision=denied reason=reconciliation_mismatch
  - wrong-merchant: merchantId ROGUE_LLC_GB99XX ≠ BENEF_GMBH_DE89AB
[over-amount-cap] decision=denied reason=reconciliation_mismatch
  - over-amount-cap: amount 55000.00 > cap 50000.00
```

## Why `graduated` mode (and the footgun by design)

The reconciliation policy is `graduated` with 5% tolerance — chosen
**deliberately** to exercise the kernel's footgun-by-design:

- Graduated mode tolerates **over-call-count** up to `floor(maxCalls × 1.05)`.
- **Non-count mismatches** — `wrong-merchant`, `over-amount-cap`,
  `wrong-method`, `wrong-endpoint`, `arg-shape-mismatch` — remain
  **STRICTLY denying** regardless of the tolerance setting.

See `packages/intent-manifest/src/reconcile.ts:232` for the
`mapDenialReason` implementation.

This is exactly the right semantics for treasury: a one-off batch overrun is
forgivable, but a wire to the wrong account is unrecoverable in seconds. The
operator who sets tolerance is telling the kernel "I might run a few more
wires than planned" — not "I might wire to a different account than declared."

## Why this matters

ISO 20022 migration is in flight across SWIFT, Fedwire, and CHAPS through
2025–2027. AI treasury agents are emerging in major TMS platforms (Kyriba,
SAP, Trovata). Cryptographic intent binding gives the treasury platform a
non-repudiable supervision trail the auditor can replay end-to-end:

- **Pre-execution evidence:** the signed manifest proves what the agent
  *intended* before the wire dispatched.
- **Post-execution evidence:** the audit chain entry from
  `/v1/intent/{id}/actuals` proves what *actually* happened.
- **Mismatch evidence:** any deviation is signed, timestamped, and tied to
  the manifest by id.

Auditor's request "show me every wire that deviated from declared intent
in Q2" becomes a single audit-chain query, not a reconstruction of broker
logs and email approvals.

## Wire surface and BATE feedback

Same wire as the ACP demo:

- **Issuance:** `POST /v1/intent`
- **Reconciliation:** `POST /v1/intent/{manifestId}/actuals` (Idempotency-Key required)
- **Read-back:** `GET /v1/intent/{manifestId}`

A detected mismatch emits `INTENT_MISMATCH_OBSERVED` to BATE. The agent's
trust score drops; subsequent verify attempts return `TRUST_SCORE_TOO_LOW`
once the per-window cap binds (~300 points / 3 mismatches). For treasury,
this is critical: a single hijacked wire attempt should immediately demote
the agent from `VERIFIED` toward `WATCH` so the next attempt is denied
before it dispatches.

## Related

- **Spec:** `docs/spec/AEGIS_API_SPEC.yaml` (`/v1/intent/*`)
- **ADRs:** `docs/decisions/0016-intent-manifest-kernel.md`, `0017-intent-manifest-runtime-issuance.md`
- **Sibling demos:** `intent-fintech-acp/`, `intent-broker-dealer-finra/`
