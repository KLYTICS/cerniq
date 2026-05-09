---
title: AEGIS Operator Decisions
last-reviewed: 2026-05-02
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
| OD-003 | Pricing tier hard gates               | Source: `docs/spec/04_COMMERCIAL_STRATEGY.md` Part V. Blocks M-011 (Stripe billing).                     | **DECIDED 2026-05-05 — see ADR-0014.** Free trial (10K verifies, lifetime cap, no time limit) / Developer $49 (50K verifies/mo) / Team $299 (500K verifies/mo) / Scale $1,499 (5M verifies/mo) / Enterprise custom. Overage $0.0008/verify uniform across paid tiers. New denial code `TRIAL_EXHAUSTED` inserted in denial precedence between `SCOPE_NOT_GRANTED` and `SPEND_LIMIT_EXCEEDED`. See `docs/decisions/0014-pricing-and-free-trial.md` and companion model `docs/finance/AEGIS_Financial_Model_v1.xlsx` + memo `docs/finance/AEGIS_Strategy_Memo_v1.docx`. To be encoded in `apps/api/src/modules/billing/plans.ts`. | operator | before M-011 ships        | DECIDED |
| OD-004 | Audit retention horizon               | Source: `docs/SECURITY.md` audit chapter. Blocks SOC2 readiness collateral and Enterprise DPA template.  | **7 years** (SOC2 Type II floor; matches financial-services audit norms cited in `docs/spec/04_COMMERCIAL_STRATEGY.md` Persona C). Operator confirms when first paying customer signs.                                                                                                                                                                                                                                                             | operator | first paid contract       | OPEN   |
| OD-005 | Webhook delivery max attempts → DLQ   | Source: `docs/BATE_ALGORITHM.md` § 8 references webhook module. Blocks M-008 (webhooks).                 | **8 attempts** before dead-letter (Stripe parity: Stripe retries 8 times over ~3 days using exponential backoff). Encoded in `apps/api/src/modules/webhooks/webhook.delivery.ts`.                                                                                                                                                                                                                                                                  | operator | before M-008 ships        | OPEN   |
| OD-006 | `/v1/verify` rate-limit on FREE tier  | Source: `docs/spec/04_COMMERCIAL_STRATEGY.md` PART V (Stripe meters). Blocks M-005 throttle config.      | **10 req/sec** per principal on FREE; bursts up to 20 (token bucket). Sized to keep PLG signup → first verify smooth without subsidising abuse. Encoded via `@nestjs/throttler` config in `apps/api/src/modules/verify/verify.module.ts`.                                                                                                                                                                                                          | operator | before public beta        | OPEN   |
| OD-007 | Status-page hosting choice            | Source: `docs/ARCHITECTURE.md` §9 (incident communication). Blocks SOC2 CC7.4 external-comm evidence + Phase 1 GA collateral. | **Self-hosted on the dashboard** at `status.aegislabs.io`, reading `incidents.{open,history}.json` published from the management API. Fallback if dashboard ops capacity is constrained: Statuspage by Atlassian (paid) or Cloudflare's status component. Encoded in `apps/dashboard/app/status/page.tsx` once chosen.                                                                                                                              | operator | before Phase 1 GA         | OPEN   |
| OD-008 | **RESERVED** — PQ hybrid flag flip    | Source: WORK_BOARD M-035. Reserved by peer (`enterprise-plane` session) for the AEGIS_HYBRID_PQ_ENABLED flag-flip decision. | Reserved slot — do not reassign. Default text will be added when peer files M-035 for operator review.                                                                                                                                                                                                                                                                                                                                          | operator | (peer-owned)              | RESERVED |
| OD-009 | CLI authentication model              | Source: this doc + `docs/INDUSTRY_QUICKSTARTS.md`. Blocks M-040a / `packages/cli/cmd/login.go`.                              | **Device-code OAuth** primary (mirrors `gh auth login`, leverages peer's `auth0` module landed 2026-05-02). Fallback flag `--api-key` for headless / CI / non-interactive. Browser-redirect flow skipped to avoid localhost-callback complexity in remote SSH dev environments. Tokens cached in OS keychain (Keychain.app on darwin, Secret Service on linux, Credential Manager on windows) via `99designs/keyring`.                          | operator | before M-040a ships       | OPEN   |
| OD-010 | CLI distribution + binary language    | Source: this doc. Blocks M-040b / installer infra and M-027.                                                                  | **Go single static binary**, cross-compiled via goreleaser to darwin/linux/windows × amd64/arm64. HTTP client generated from `docs/spec/AEGIS_API_SPEC.yaml` via `oapi-codegen` so the wire contract stays single-source-of-truth alongside the TS Zod types. Crypto restricted to Go stdlib `crypto/ed25519` plus `github.com/go-jose/go-jose/v4` (one library, audited — honors CLAUDE.md stack reality). Bun/Node binary skipped: 50 MB vs 5 MB, duplicates SDK logic. | operator | before M-040b ships       | OPEN   |
| OD-011 | First three industry quickstarts      | Source: this doc + `docs/INDUSTRY_QUICKSTARTS.md`. Blocks `examples/<vertical>/` scaffolds.                                  | **fintech-payments** (Stripe-style checkout with AEGIS verify gate before authorization), **ai-platform-tool-call** (MCP agent → AEGIS verify → downstream API; pairs with peer's `@aegis/mcp-server` 2026-05-02 drop), **saas-seat-provisioning** (SCIM-flavored agent provisioning — cleanest greenfield, smallest blast radius). Health, commerce-marketplace, gov, edu, supply-chain deferred to second wave (post Phase 1 GA).            | operator | before examples ship      | OPEN   |
| OD-012 | Onboarding state persistence          | Source: this doc. Blocks dashboard onboarding wizard + `aegis doctor` heuristics.                                            | **Server-persisted** in a new `PrincipalOnboarding` table (additive in M-026 schema migration). Drives both dashboard checklist *and* CLI `aegis doctor` "you haven't done X yet" report. Honest activation funnel measurable without third-party analytics. Client-only (LocalStorage) explicitly rejected: CLI cannot introspect, breaks cross-device pickup. Coordinates with peer holding migrations claim (M-026).                          | operator | before dashboard wizard   | OPEN   |
| OD-013 | Default policy engine per principal   | Source: ADR-0012 §3 + Round 7 (Cedar/OPA adapters landed 2026-05-02). Blocks Cedar/OPA marketing claim and customer onboarding. | **`builtin`** for new principals; opt-in to `cedar` or `opa` via `Principal.policyEngine` (set at signup or `aegis principals set --policy-engine cedar`). Rationale: Cedar/OPA require the customer to author + maintain a policy file. Default-Cedar would force every PLG signup to write Rego/Cedar before first verify works — kills activation. Cedar/OPA become first-class once the customer asks for them; until then, the BuiltinPolicyEngine port covers 80% of cases. | operator | before customer Cedar/OPA quickstart ships | OPEN   |
| OD-014 | PQ hybrid trigger criteria            | Source: ADR-0013 §6 + WORK_BOARD M-035. Sibling to RESERVED OD-008.                                                          | **Three triggers, ANY of which flips `AEGIS_HYBRID_PQ_ENABLED`**: (1) IETF publishes draft-ietf-cose-hybrid-pq-jwt as RFC; (2) AWS KMS GAs EdDSA Sign — switches the migration path from envelope to native KMS sign; (3) a regulated customer (defense / FSI) asks. Rejected: time-based default (e.g. "flip in 18 months") — security posture should follow market readiness, not calendar. Encoded in `apps/api/src/common/crypto/pq.util.ts` behind the env flag (scaffold landed 2026-05-02). | operator | first time any trigger fires | OPEN   |
| OD-015 | Default IdP for new dashboards        | Source: ADR-0009 + Round 7 (Clerk adapter landed 2026-05-02 alongside Auth0).                                                | **Auth0** remains the dashboard default (matches ADR-0009 §1). Clerk is shipped as a swap option for shops that already standardize on Clerk — they replace `Auth0Adapter` with `ClerkAdapter` via the `IdpAdapter` provider binding. Both adapters are tested in unit; full e2e for Clerk deferred to first Clerk-using customer. WorkOS / Microsoft Entra / Okta SAML come later via the same `IdpAdapter` interface. | operator | first Clerk-using deployment | OPEN   |
| OD-016 | GDPR redact API public exposure       | Source: ADR-0006 + Round 7 (compliance.module.ts landed 2026-05-02). Blocks DPA template + privacy-by-design control evidence. | **Public (`POST /v1/compliance/audit/redact-{event,by-agent}`) under ApiKeyGuard with FULL scope only**. Rationale: customers regularly handle Art. 17 requests in-band — making it self-service avoids manual ops tickets. VERIFY_ONLY API keys cannot redact (already excluded by guard scope). Rejected: dashboard-only / human-in-the-loop — would block automated DPA workflows used by EU enterprise customers. The redaction itself is irrevocable, but the meta-event pinned in the audit chain creates a permanent operator record. | operator | before EU GA              | OPEN   |

> Statuses: **OPEN** (awaiting), **REVIEWED** (operator has read, no decision yet), **DECIDED** (locked, encode in code), **EXPIRED** (default has shipped because the due date passed).

---

## 3. Recently decided

| ID  | Decision | Resolution | Owner | Decided on | Status |
| --- | -------- | ---------- | ----- | ---------- | ------ |
| OD-003 | Pricing tier hard gates | $49 Dev / $299 Team / $1,499 Scale + $0.0008 overage. 10K-verify lifetime free trial. New `TRIAL_EXHAUSTED` denial code. See ADR-0014, `docs/finance/AEGIS_Financial_Model_v1.xlsx`, `docs/finance/AEGIS_Strategy_Memo_v1.docx`. | operator | 2026-05-05 | DECIDED |

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
| OD-008   | **M-035** (PQ hybrid verify integration) — peer-owned reservation, see WORK_BOARD                                 |
| OD-009   | **M-040a** (CLI login flow), **M-027** (operator CLI bootstrap)                                                   |
| OD-010   | **M-040b** (CLI distribution / installer infra), **M-027** (binary build)                                         |
| OD-011   | **M-040e..g** (industry example scaffolds — fintech-payments, ai-platform-tool-call, saas-seat-provisioning)      |
| OD-012   | Dashboard onboarding wizard + **M-040c** (`aegis doctor`); coordinates with **M-026** (schema migration)          |
| OD-018   | **M-018** (Apply operator decisions) — this is the meta-module that ingests every DECIDED row and applies it.     |

---

*Last updated 2026-05-02. Reviewed weekly. Each row is the contract between the operator and the build sessions: silence past the due date is consent for the default.*
