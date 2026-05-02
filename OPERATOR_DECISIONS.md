---
title: AEGIS Operator Decisions
last-reviewed: 2026-05-01
owner: operator (Erwin)
review-cadence: weekly
---

# AEGIS — Operator Decisions

A top-level register of decisions blocking AEGIS forward progress. Every
open decision has a recommended default that ships if the operator is
silent past the due date — silence is a vote for the default. Decisions
move from **Open** to **Recently decided** once locked.

---

## 1. How to use this doc

1. Scan **§ 2 Open decisions** weekly. If a decision is acceptable as-is,
   reply with the ID + `accept default`; the next session encodes it.
2. To override, edit the row inline (or message the next session) — set
   status to `DECIDED` and update the linked source file in the same PR.
3. To defer past the **Default if not decided by** date, change the due
   date in this table; the default still ships unless the row is updated.

---

## 2. Open decisions

| ID     | Decision                              | Why blocked                                                                                              | Default if not decided by                                                                                                                                                                                                                                                                                                                                                                                                                          | Owner    | Due                       | Status |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------- | ------ |
| OD-001 | BATE scoring weights (signal table)   | Source: `docs/BATE_ALGORITHM.md` § 4 marked `OPERATOR INPUT NEEDED`. Blocks M-007 (BATE) implementation. | Rule-based v1 with weights `{CLEAN_TX: +1, FRAUD_REPORT: -200, VELOCITY_ANOMALY: -50, GEO_INCONSISTENCY: -30, SPEND_DEVIATION: -20, FAILED_VERIFY_SPIKE: -75, POLICY_VIOLATION_ATTEMPT: -100}`. **Note**: these are looser than the conservative table currently published in `docs/BATE_ALGORITHM.md` § 4 (e.g. fraud report -300 there vs. -200 here); operator must confirm which set lands. Encoded in `apps/api/src/modules/bate/bate.weights.ts`. | operator | before M-007 ships        | OPEN   |
| OD-002 | Cold-start trust accelerator policy   | Source: `docs/BATE_ALGORITHM.md` § 5 marked `OPERATOR INPUT NEEDED`. Blocks M-007 cold-start path.       | New agents start at **500**; KYC required to score above **700**. KYC bonus (`+150`) lifts a KYC-verified principal from 500 → 650, comfortably above the common 600 acceptance threshold. Encoded in `apps/api/src/modules/bate/bate.cold-start.ts`.                                                                                                                                                                                              | operator | before public launch      | OPEN   |
| OD-003 | Pricing tier hard gates               | Source: `docs/spec/04_COMMERCIAL_STRATEGY.md` Part V. Blocks M-011 (Stripe billing).                     | Free (1K verifies/mo), Developer ($49 / 50K verifies/mo), Growth ($299 / 500K verifies/mo), Enterprise (custom). **Conflict**: the spec § PART V proposes Free 10K / Developer $29 (500K) / Growth $149 (5M). Operator must reconcile before billing ships. Encoded in `apps/api/src/modules/billing/plans.ts`.                                                                                                                                    | operator | before M-011 ships        | OPEN   |
| OD-004 | Audit retention horizon               | Source: `docs/SECURITY.md` audit chapter. Blocks SOC2 readiness collateral and Enterprise DPA template.  | **7 years** (SOC2 Type II floor; matches financial-services audit norms cited in `docs/spec/04_COMMERCIAL_STRATEGY.md` Persona C). Operator confirms when first paying customer signs.                                                                                                                                                                                                                                                             | operator | first paid contract       | OPEN   |
| OD-005 | Webhook delivery max attempts → DLQ   | Source: `docs/BATE_ALGORITHM.md` § 8 references webhook module. Blocks M-008 (webhooks).                 | **8 attempts** before dead-letter (Stripe parity: Stripe retries 8 times over ~3 days using exponential backoff). Encoded in `apps/api/src/modules/webhooks/webhook.delivery.ts`.                                                                                                                                                                                                                                                                  | operator | before M-008 ships        | OPEN   |
| OD-006 | `/v1/verify` rate-limit on FREE tier  | Source: `docs/spec/04_COMMERCIAL_STRATEGY.md` PART V (Stripe meters). Blocks M-005 throttle config.      | **10 req/sec** per principal on FREE; bursts up to 20 (token bucket). Sized to keep PLG signup → first verify smooth without subsidising abuse. Encoded via `@nestjs/throttler` config in `apps/api/src/modules/verify/verify.module.ts`.                                                                                                                                                                                                          | operator | before public beta        | OPEN   |
| OD-007 | Status-page hosting choice            | Source: `docs/ARCHITECTURE.md` §9 (incident communication). Blocks SOC2 CC7.4 external-comm evidence + Phase 1 GA collateral. | **Self-hosted on the dashboard** at `status.aegislabs.io`, reading `incidents.{open,history}.json` published from the management API. Fallback if dashboard ops capacity is constrained: Statuspage by Atlassian (paid) or Cloudflare's status component. Encoded in `apps/dashboard/app/status/page.tsx` once chosen.                                                                                                                              | operator | before Phase 1 GA         | OPEN   |

> Statuses: **OPEN** (awaiting), **REVIEWED** (operator has read, no decision yet), **DECIDED** (locked, encode in code), **EXPIRED** (default has shipped because the due date passed).

---

## 3. Recently decided

| ID  | Decision | Resolution | Owner | Decided on | Status |
| --- | -------- | ---------- | ----- | ---------- | ------ |

<!-- first entry will land here when OD-001 closes. -->

---

## 4. How to add a decision

1. **Write the entry** in § 2 with a fresh `OD-NNN` ID. Every row needs:
   the question in one sentence, the source file the answer touches, a
   reasoned default (no fabrication — cite the source), and a due date
   tied to a milestone or event.
2. **Ping the operator** in chat or by claiming a `claude-peers` message
   to the operator session. Reference the new OD-ID.
3. **Wait for the verdict.** When the operator responds, flip the status
   to `DECIDED`, fill in the resolution, and move the row into § 3 with
   today's date. Then encode the answer in the source file in the same
   commit so spec and code never drift.

---

## 5. Cross-references — modules each decision blocks

These map to `WORK_BOARD.md` module IDs.

| Decision | Blocks                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| OD-001   | **M-007** (BATE engine — signal ingestion + rule-based scoring)                                                   |
| OD-002   | **M-007** (cold-start path) and indirectly **M-003** (Identity handshake initial-score assignment)                |
| OD-003   | **M-011** (Stripe billing — Free + Developer tiers, usage metering)                                               |
| OD-004   | Cross-cutting: **M-006** (Audit module — write + paginated read + export) retention policy and Enterprise DPA     |
| OD-005   | **M-008** (Webhooks — subscription + delivery worker)                                                             |
| OD-006   | **M-005** (Verify module — the hot path) and **M-009** (Auth — API key issuance) tier-aware throttle              |
| OD-007   | SOC2 CC7.4 external-comm evidence; Phase 1 GA collateral (status page is the visible artifact of incident comm)   |
| OD-018   | **M-018** (Apply operator decisions) — this is the meta-module that ingests every DECIDED row and applies it.     |

---

*Last updated 2026-05-01. Reviewed weekly. Each row is the contract between the operator and the build sessions: silence past the due date is consent for the default.*
