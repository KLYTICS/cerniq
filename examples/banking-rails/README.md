# `banking-rails` — OKORO verify gate for programmable banking

Layers OKORO over a bank adapter (Modern Treasury, Increase, Mercury,
direct ISO 20022 to a sponsor) so a treasury team's automated agent
moves money under cryptographic identity, scoped policy, behavioral
trust, and a signed audit chain.

## Why this matters

Agent-driven money movement is the highest-stakes OKORO surface.
A leaked credential moving funds via wire is unrecoverable; the bank
will not unwind it. Defence in depth:

1. **Identity** — Ed25519 keypair generated client-side, only public
   key in OKORO. (CLAUDE.md invariant 1.)
2. **Scope** — policy allow-lists the counterparty (creditor BIC /
   IBAN), caps per-tx and per-day, restricts the rail.
3. **Trust** — per-rail trust score floor. Wire / FedNow demand
   PLATINUM (≥ 800); ACH tolerates 650; book-transfers 500. Tunable.
4. **Audit** — every attempt (allowed, OKORO-denied, bank-rejected)
   produces a signed audit row. Tamper-evident; verifiable offline by
   any auditor with the public key from `/.well-known/audit-signing-key`.

## Per-rail trust floors (default)

| Rail            | Min trust | Reversible? | Settlement     |
|-----------------|-----------|-------------|----------------|
| wire            | 800       | no          | T+0 (intraday) |
| fednow          | 800       | no          | T+0 (instant)  |
| rtp             | 750       | no          | T+0 (instant)  |
| sepa-instant    | 750       | no          | T+0 (10s)      |
| sepa-ct         | 700       | partial     | T+0 / T+1      |
| ach             | 650       | yes (R-codes)| T+1            |
| book-transfer   | 500       | yes (ledger)| T+0 (internal) |

The rule: irrevocable, instant, high-trust. Reversible, batched,
lower-trust. Override per env via `RAIL_MIN_TRUST_*` or extend the
`RAIL_MIN_TRUST` map in `server.ts`.

## The flow

```
  ┌─Treasury Agent ──────────────┐    ┌─Treasury API (this example)──────┐
  │                              │    │                                  │
  │  OKORO-signed token bound to │    │  POST /api/instruct              │
  │  creditor BIC + amount       │───►│   { okoroToken, instruction }    │
  │                              │    │                                  │
  └──────────────────────────────┘    │  1. okoro.verify(token)          │
                                      │     min trust = RAIL_MIN_TRUST   │
                                      │  2. submit to bank rail adapter  │
                                      │     (Modern Treasury, Increase,  │
                                      │      direct ISO 20022 SFTP, …)   │
                                      │  3. respond 200 / 402 / 502      │
                                      └──────────────────────────────────┘
```

## Run

```sh
cd examples/banking-rails
pnpm install

# Provision the agent + treasury policy (out of band).
okoro agents register --runtime CUSTOM --label "treasury-bot-v1" --generate-keypair > agent.json
AGENT_ID=$(jq -r .agentId agent.json)
PKEY=$(jq -r .privateKey agent.json)
POLICY_ID=$(okoro policy create --agent "$AGENT_ID" \
              --scope commerce \
              --max-per-tx 50000.00 \
              --max-per-day 500000.00 \
              --domain CHASUS33 \
              --domain BARCGB22 \
              --expires-in 30d --json | jq -r .policyId)

# Boot the treasury API.
OKORO_VERIFY_KEY=okoro_vk_... \
TREASURY_DOMAIN=acme-treasury.com \
pnpm tsx src/server.ts &

# Drive an ACH instruction from the agent.
OKORO_AGENT_ID=$AGENT_ID \
OKORO_POLICY_ID=$POLICY_ID \
OKORO_AGENT_PRIVATE_KEY=$PKEY \
pnpm tsx src/agent-sim.ts \
  --rail ach --amount 5000000 \
  --debtor-bic GSCRUS33 --creditor-bic CHASUS33 \
  --memo "INV-1042 vendor payment"
```

## ISO 20022 mapping

The `PaymentInstruction` shape is rail-agnostic. The bank-adapter
(out of scope) translates to the rail's wire format:

| Field          | pacs.008 (wires) | pain.001 (init.) | NACHA (ACH)   |
|----------------|------------------|------------------|---------------|
| endToEndId     | EndToEndId       | EndToEndId       | Trace-Number  |
| rail           | InstrPrty        | InstrPrty        | SEC-Code      |
| debtor         | Debtor.BICFI     | Debtor.BICFI     | DFI ABA       |
| creditor       | Creditor.BICFI   | Creditor.BICFI   | RDFI ABA      |
| amount         | InstdAmt @Ccy    | InstdAmt @Ccy    | Amount field  |
| currency       | InstdAmt @Ccy    | InstdAmt @Ccy    | (USD only)    |
| valueDate      | IntrBkSttlmDt    | ReqdExctnDt      | Effective Date|
| remittanceInfo | RmtInf.Ustrd     | RmtInf.Ustrd     | Addenda       |

The adapter's job is shape-mapping; OKORO's job is identity / policy /
trust / audit. The two layers compose.

## Settlement reconciliation

A real treasury system runs a periodic job that joins:

- OKORO audit events (`POST /v1/audit-events`) by `endToEndId`
- Bank settlement records (camt.054 / pacs.002 ACK / NACHA returns)
  by trace number / UETR

Mismatches surface as anomalies (audit row exists but no settlement,
or vice versa). Pattern is documented in `docs/INTEGRATION_PATTERNS.md`
§ Reconciliation. This example doesn't ship the reconciler; it ships
the field that makes reconciliation possible (`endToEndId` end-to-end).

## Production checklist

- [ ] Replace `submitToBank()` with the real bank adapter call. The
      `BankSubmitVerdict` shape is stable across Modern Treasury,
      Increase, and direct adapters.
- [ ] Subscribe to `okoro.agent.revoked` and `okoro.agent.policy_expired`
      so a compromised treasury agent stops moving money the moment
      it's revoked.
- [ ] Run a per-rail latency budget alarm. If `okoro.verify` p99 ever
      exceeds the rail's submission window (RTP / FedNow are 5s end-to-
      end), OKORO becomes the bottleneck. p99 SLA is 200ms (see
      `docs/CAPACITY_PLAN.md`).
- [ ] Pair OKORO audit events to bank confirmations in your data
      warehouse. SOC2 auditors will ask for both halves of the trail.
- [ ] BATE signal feedback: when the bank rejects, report the
      rejection back to OKORO via `/v1/agents/:id/report` so the
      trust score reflects bank-side issues that OKORO can't directly
      observe (e.g. NACHA R03 — invalid account number — pattern
      across multiple agents may indicate credential reuse).

## What's intentionally absent

- **Real bank-rail integration.** The example uses an in-process mock
  with a single illustrative refusal (wire cutoff 4pm ET) so the file
  stays runnable. Swap `submitToBank()` for `mt.payments.create()` /
  `increase.transfers.ach.create()` / a SOAP client to your sponsor.
- **AML / sanctions screening.** That's a layer ABOVE OKORO — your
  compliance stack screens the counterparty before the agent even
  attempts the action. OKORO gates *agent authorization*, not the
  legality of the underlying payment.
- **Multi-currency FX execution.** Cross-currency settlement is
  rail-specific (wire vs SEPA-CT vs SEPA-Instant differ in FX
  semantics). Out of scope; document in your bank-adapter README.

## Reference

- ISO 20022 message catalog: <https://www.iso20022.org/iso-20022-message-definitions>
- `docs/INTEGRATION_PATTERNS.md` § Banking rails
- `docs/CAPACITY_PLAN.md` § Verify p99 budget
- `docs/THREAT_MODEL_v2.md` § 8 (atomic spend / fail-closed Redis)
