# `reconciliation` — CERNIQ audit ↔ underlying-system reconciler

Joins two NDJSON streams on `endToEndId` (the CERNIQ jti = Stripe
`idempotency-key` = ISO 20022 `EndToEndId`) and surfaces the four
mismatch classes from
[`docs/INTEGRATION_PATTERNS.md` § 10](../../docs/INTEGRATION_PATTERNS.md).

## The four classes

| Class              | Meaning                                                | Action                                                       |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------ |
| `matched_settled`  | CERNIQ approved + system has a settled record          | Happy path; informational                                    |
| `approved_missing` | CERNIQ approved, system has NO record                  | **Investigate** — network drop or system never executed      |
| `denied_present`   | CERNIQ denied, system has a record anyway              | **Investigate** — gate bypass or attacker                    |
| `reversed`         | CERNIQ approved, system settled, system later reversed | BATE feedback signal (`fraud_confirmed` or `false_positive`) |

## Run the demo

The `fixtures/` directory has small sample NDJSON files that exercise
every mismatch class:

```sh
cd examples/reconciliation
pnpm install
pnpm demo
```

Expected output (truncated):

```
CERNIQ reconciliation — ✗ MISMATCH
────────────────────────────────────────────────────────────
cerniq rows           : 7
system rows          : 6
matched & settled    : 3
approved + missing   : 2  ← network drop or system never executed
denied + present     : 2  ← gate bypass — INVESTIGATE
reversed             : 2  ← BATE feedback signal

matched totals (by currency):
  USD  21900

rows requiring investigation (4):
  • approved_missing    e2e_004  agent=ag_alpha
  • approved_missing    e2e_007  agent=ag_alpha
  • denied_present      e2e_003  agent=ag_beta  system=ch_003
  • denied_present      e2e_999  system=ch_999
```

## Fitting it into your pipeline

The recommended cadence:

| Volume profile     | Cadence    | Trigger                      |
| ------------------ | ---------- | ---------------------------- |
| < 1k events/day    | Daily      | Cron at end of day           |
| 1k–100k events/day | Hourly     | Cron / Airflow               |
| > 100k events/day  | Continuous | Streaming join in Flink/Beam |
| Treasury / wires   | Per-batch  | After each rail submission   |

Wire it into your existing data pipeline:

```sh
# 1. Pull CERNIQ audit log for the window.
curl -fsSL "https://api.cerniqapp.com/v1/audit-events/export?since=$START&until=$END" \
     -H "X-CERNIQ-API-Key: $CERNIQ_API_KEY" \
     > cerniq-export.ndjson

# 2. Pull underlying-system records for the same window. Format:
#      { endToEndId, systemId, status, amount, currency, timestamp, reversalCause? }
psql -d analytics -At -c "..." > psp-charges.ndjson

# 3. Reconcile. Non-zero exit on mismatch.
pnpm tsx src/cli.ts --cerniq cerniq-export.ndjson --psp psp-charges.ndjson --json \
  > reconciliation-$(date +%Y-%m-%d).json
```

## BATE feedback loop

The `reversed` rows feed back into CERNIQ so the trust score learns
from real-world outcomes:

```ts
import { reconcile } from './reconcile.js';
import { Cerniq } from '@cerniq/sdk';

const cerniq = new Cerniq({ apiKey: process.env.CERNIQ_API_KEY });
const report = reconcile(cerniqRows, systemRows);

for (const entry of report.entries) {
  if (entry.class !== 'reversed' || !entry.cerniq) continue;
  await cerniq.report({
    agentId: entry.cerniq.agentId,
    eventType: entry.bateFeedback === 'fraud_confirmed' ? 'fraud_confirmed' : 'false_positive',
    severity: entry.bateFeedback === 'fraud_confirmed' ? 'high' : 'low',
    transactionId: entry.endToEndId,
    description: `system reversal: ${entry.system?.reversalCause ?? 'unknown'}`,
  });
}
```

The `fraud_confirmed` signals drop the agent's trust score with
proportional weight (severity-weighted in `bate.weights.ts`); the
`false_positive` signals push it up slightly. Over weeks of
reconciliation the score converges on each agent's actual reliability.

## What's intentionally absent

- **No DB connectivity.** This package reads NDJSON and writes a
  report. Wire it to your warehouse upstream; pipe it to your
  alerting downstream.
- **No streaming join.** O(N) memory in the input. For > 1M rows per
  run, port the same algorithm to a streaming SQL surface
  (Snowflake / BigQuery / DuckDB MERGE on `endToEndId`).
- **No PII in the report.** CERNIQ rows reference agent ids and
  principal ids, never raw user PII. The system rows you pass in
  should already be PII-clean (use the underlying system's report
  export, not the raw payment record).

## Reference

- `docs/INTEGRATION_PATTERNS.md` § 10 (the pattern this implements)
- `packages/audit-verifier/` (verifies the CERNIQ-side input is
  cryptographically intact before reconciling)
- BATE signal types: `fraud_confirmed`, `false_positive` (see
  `apps/api/src/modules/bate/bate.weights.ts`)
