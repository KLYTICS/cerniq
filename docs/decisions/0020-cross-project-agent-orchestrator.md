# ADR-0020 — Cross-project agent orchestrator (Slack-surfaced)

**Status**: accepted
**Date**: 2026-05-21
**Deciders**: operator (Erwin Kiess-Alfonso) — eight sub-decisions packaged
  (operator response 2026-05-21: `accept defaults D1–D7`; D8 added as
  follow-up correction after cross-project probe revealed CK's API is
  Python + CK has an internal orchestrator that must be preserved;
  operator response 2026-05-21 follow-up: `accept defaults D8a/b/c`.
  All eight sub-decisions now locked.)
**Builds on**: ADR-0007 (transactional outbox), ADR-0012 (pluggable policy
engine), ADR-0016 (intent-bound attestation), ADR-0017 (intent runtime
issuance)
**Related**: WORK_BOARD `M-060` (to be filed), OPERATOR_DECISIONS `OD-020`
(to be filed)

> **Reader note**: this ADR was seeded from a strategic question — _"should
> I incorporate Slack into OKORO and ComplianceKit for all my cloud agents
> working together?"_ It proposes that OKORO itself become the
> cross-project agent orchestrator (with ComplianceKit as the first
> external consumer), rather than building a parallel control plane.
>
> Two operator follow-ons extended the scope: the orchestrator must (a)
> support **highly scalable, world-class human + agent teams** across
> OKORO, ComplianceKit, and future projects (Klytics, APEX, Forge, ...)
> with minimal onboarding friction, and (b) map every task to a
> **measurable ROI activity** so the executive narrative writes itself.
> D6 and D7 below address those explicitly. Seven design tensions force
> explicit operator decisions before any code lands.

## Context

The operator runs multiple agent-bearing products in parallel:

- **OKORO** — agent gateway, identity, audit, policy, BATE
- **ComplianceKit** — AI-native compliance for B2B SaaS
- (future projects expected — Klytics, APEX, Forge, etc.)

Across these, the operator wants a single durable surface that lets cloud
agents coordinate work, escalate to humans, and produce a unified audit
trail — accessible from anywhere (mobile), always on, and aligned with
OKORO's existing security model.

A naive read-out would build a new "control plane" repo. But OKORO already
ships the load-bearing primitives this needs:

| Primitive needed                | Existing OKORO surface                                        |
| ------------------------------- | ------------------------------------------------------------- |
| Agent identity                  | `apps/api/src/modules/identity/` (Ed25519, public-key-only)   |
| Signed event log                | `apps/api/src/modules/audit/` (append-only, hash-chained)     |
| At-least-once event publishing  | `apps/api/src/common/outbox/` (ADR-0007 transactional outbox) |
| Approval / human-in-loop gate   | `apps/api/src/common/policy-engine/` (ADR-0012 pluggable)     |
| Behavioral attestation          | `apps/api/src/modules/bate/`                                  |
| Tenant isolation                | `principalId` carried through every layer (invariant #5)      |
| Correlation across surfaces     | `apps/api/src/common/correlation/`                            |
| External integration adapters   | `packages/integrations/{anthropic,openai,langchain,n8n,...}`  |

The gap is narrow:

1. **No work queue** — agents have no way to claim cross-project work units.
2. **No Slack adapter** — `packages/integrations/` covers AI vendors and
   automation platforms but no human-surface adapter.
3. **No external SDK use case yet** — `@okoro/sdk-ts` has been
   built/shipped but no OKORO-external product consumes it for
   orchestration. ComplianceKit becomes the first real consumer.

If we accept that gap framing, this is a **3-piece addition** to OKORO,
not a new platform:

```
              ┌────────────────────────────────────────────┐
              │            OKORO API (existing)            │
              │   identity · audit · outbox · policy ·     │
              │   bate · correlation · idempotency         │
              └────┬────────────────────┬──────────────────┘
                   │                    │
   ┌───────────────▼───────────┐  ┌─────▼──────────────┐
   │  NEW: orchestrator module │  │ NEW: integrations  │
   │  POST /v1/tasks           │  │      /slack        │
   │  GET  /v1/tasks?status=…  │  │ outbox subscriber  │
   │  POST /v1/tasks/:id/claim │  │ + approval callback│
   │  POST /v1/tasks/:id/event │  └────────────────────┘
   └───────────┬───────────────┘
               │
   ┌───────────▼──────────────┐
   │ OKORO-EXTERNAL consumer  │
   │ ComplianceKit agents via │
   │ @okoro/sdk-ts            │
   └──────────────────────────┘
```

The remainder of this ADR lays out five decisions the operator must lock
before code lands. Defaults are proposed; rationale and rejected
alternatives follow each.

## Decisions (operator-input-needed)

> Each `D#` below is marked **OPERATOR-INPUT-NEEDED**. The proposed default
> reflects OKORO's existing invariants and the operator's stated framing
> (DB-is-truth, Slack-is-surface, tiered autonomy). The operator may
> accept the defaults wholesale (reply `accept defaults` on OD-020) or
> override individual decisions inline.

### D1 — Tenancy model for cross-project tasks

**OPERATOR-INPUT-NEEDED**

**Proposed default**: tasks are **always within one `principalId`**.
Cross-project routing (OKORO↔CK) is achieved by issuing **federated
principals** — a CK tenant maps 1:1 to an OKORO `principalId` and CK's
own agents register under that principalId. There is no notion of a
"cross-tenant" task.

**Rationale**: preserves invariant #5 (`principalId` everywhere). Avoids
a new "cross-tenant" code path that would need its own threat model and
isolation tests. Cross-project handoff still works — the CK tenant
declares a task under principalId `pK_compliancekit_xxx` and an OKORO
agent registered under the same principalId picks it up. The "project"
becomes a `kind` tag on the task envelope, not a tenancy boundary.

**Rejected alternative**: native cross-tenant tasks with a separate
`broker_principal_id`. Rejected because (a) it forks every Prisma query
that touches tasks, (b) introduces a new tenant-leakage surface, (c)
"my own agents across my own products" is already cleanly modeled as
"agents under the same principalId," and (d) third-party orchestration
(an OKORO customer's CK tenant talking to another customer's CK tenant)
is explicitly out of scope for V1.

### D2 — Audit-chain relationship for task events

**OPERATOR-INPUT-NEEDED**

**Proposed default**: task lifecycle events are written **through the
existing signed AuditEvent chain**, not a separate stream. Task IDs are
attached as a `task_id` field on the existing AuditEvent record (Prisma
migration adds a nullable column).

**Rationale**: invariant #3 (signed append-only chain) is the strongest
guarantee OKORO makes. Routing task events through it gives orchestrator
audit-trail evidence for free — including for ComplianceKit's *own*
compliance story. A separate stream would mean two audit chains, two
canonicalization rules, two redaction-flow guarantees (ADR-0006), and
two verifier surfaces (`@okoro/verifier-rp`). The cost of one extra
nullable column on AuditEvent is far below that.

**Rejected alternative**: separate `OrchestratorEvent` table with its
own signing. Rejected: violates the spirit of invariant #3 (audit chain
is the substrate); customer demand for "one audit export covers
everything" is already real per OD-004 (audit retention).

### D3 — Approval flow integration with denial-precedence

**OPERATOR-INPUT-NEEDED**

**Proposed default**: task approval is **NOT** a new entry in the
denial-precedence chain (ADR-0004). It is a separate task state machine:

```
created → ready → claimed → in_progress → awaiting_approval → done
                                                            ↘ failed
                                                            ↘ rejected
```

When an agent attempts to mutate state via a `task.action`, the
orchestrator (a) emits a verify-ish check through the existing
`policy-engine` to decide auto-execute vs. require-human, (b) writes
`awaiting_approval` state and emits an audit event, (c) the Slack
integration posts a button-bearing card, (d) human click flips state to
`approved` and the task worker resumes. The verify hot path is never
involved; this preserves invariant #2 (verify portability) absolutely.

**Rationale**: putting `AWAITING_APPROVAL` into denial-precedence would
mean shipping a new denial code, breaking parity (M-059-style work
across SDKs, docs, dashboard, OpenAPI), and conflating two semantically
distinct gates (verify-time policy vs. task-time approval).

**Rejected alternative**: new `AWAITING_APPROVAL` denial reason. Rejected
for the above; also creates ambiguity for relying parties who today
treat denial as "request rejected" — `AWAITING_APPROVAL` is "request
suspended."

### D4 — Wire schema placement for task envelope

**OPERATOR-INPUT-NEEDED**

**Proposed default**: task envelope Zod schema lives in
`packages/types/src/orchestrator.ts`. Module DTOs in
`apps/api/src/modules/orchestrator/` import from there. SDK methods in
`@okoro/sdk-ts` import the same schema. OpenAPI is generated from it
(invariant #7).

Initial envelope fields (subject to refinement by operator before code):

```ts
{
  taskId: string;            // ULID, server-issued
  principalId: string;       // tenant boundary (invariant #5)
  kind: string;              // e.g. "ck.evidence.refresh", "okoro.audit.investigate"
  payload: Record<string, unknown>;  // kind-specific, validated by registered handler
  riskTier: 'read' | 'write' | 'admin';  // drives auto-approve vs human gate
  status: TaskStatus;        // see D3 state machine
  createdAt: string;
  claimedBy?: AgentRef;      // agentId that holds the claim
  correlationId: string;     // ties to existing common/correlation
  parentTaskId?: string;     // task graph; null for roots
}
```

**Rationale**: `packages/types` is the canonical contract surface per
CLAUDE.md root and invariant #7. Co-locating with existing OKORO Zod
schemas (M-002) gives ComplianceKit a zero-friction import. The
`riskTier` field is the load-bearing one — it drives D3's policy-engine
call.

**Rejected alternative**: schema lives in `apps/api/src/modules/
orchestrator/task.schema.ts` only. Rejected: violates the
contract-centrality rule; would force SDK and dashboard to redeclare
the type.

### D5 — Slack integration shape and OPERATOR-INPUT items

**OPERATOR-INPUT-NEEDED**

**Proposed default**: new package `packages/integrations/slack/`,
following the existing integration-adapter convention. Boundary:

- **Inbound (OKORO → Slack)**: subscribes to outbox events with
  `category = "orchestrator"`. Posts threaded messages per task; thread
  parent = task creation event, replies = state transitions. Approval
  events post an interactive card with `approve` / `reject` buttons.
- **Outbound (Slack → OKORO)**: a single HMAC-signed callback endpoint
  `POST /v1/integrations/slack/interactivity` validates Slack's signing
  secret, looks up task by embedded `task_id`, calls
  `orchestrator.service.approve(taskId, slackUserId, decision)`.
- **Idempotency**: Slack's `event_id` becomes the idempotency key
  (invariant: `common/idempotency`).
- **Mapping**: per-principalId Slack workspace + channel routing config
  in a new `SlackIntegration` Prisma table (one row per principalId).

**Sub-decisions for the operator**:

1. **Workspace model** — one Slack workspace per OKORO tenant
   (recommended) vs. a shared "OKORO HQ" workspace with per-tenant
   channels.
2. **Slack identity ↔ OKORO identity binding** — does a Slack user
   need to OAuth-link to an OKORO principal before their approval
   click counts? (Recommended: yes; otherwise any workspace member can
   approve sensitive task actions.)
3. **Button-payload signing** — Slack interactivity payloads include
   our `task_id` + `nonce`. Sign with the same KMS-managed key as
   policy JWTs (ADR-0011) so a forged payload from a compromised Slack
   workspace cannot approve a task.
4. **Retention** — Slack message log retention vs. OKORO audit-chain
   retention (OD-004, 7 years default). Slack workspace retention is
   the customer's; the canonical record lives in the audit chain.
5. **Failure mode** — Slack down: orchestrator continues (DB is truth),
   approval queue backs up, retry resumes on Slack recovery (outbox
   guarantees at-least-once).

**Rejected alternatives**:
- A Slack-as-source-of-truth model (rejected up front — see ADR
  context; violates DB-is-truth principle and adds Slack as a data
  processor inside OKORO's compliance boundary, which is awkward for
  a product that *sells* audit trails).
- Discord / Microsoft Teams as the first integration. Rejected for
  V1 scope. The adapter shape generalizes; second-surface integrations
  can follow.

### D6 — Org / team / project scaling model (world-class team ops)

**OPERATOR-INPUT-NEEDED**

**Proposed default**: introduce a **lightweight Team/Project layer as
metadata on the Task envelope**, not as a new tenancy boundary. The
hierarchy is:

```
principalId  (TENANCY — security boundary, D1 unchanged)
  └─ project   (ORG — string tag: "okoro" | "compliancekit" | "klytics" | …)
       └─ team    (ORG — string tag: "evidence-collection" | "incident-response" | …)
            └─ members
                 ├─ agents   (existing identity module, with optional capability set)
                 └─ humans   (Slack-identity-bound per D5b, with role)
```

Concretely added to the task envelope (extends D4):

```ts
{
  // …D4 fields…
  project: string;           // e.g. "okoro", "compliancekit", "klytics"
  team: string;              // e.g. "evidence-collection"
  capabilities?: string[];   // task requires; agents declare; pool match
  assignTo?: AgentRef | HumanRef;  // optional explicit; otherwise pool-claimed
}
```

**New-project onboarding contract** (the scale promise):

A new project (e.g. Klytics) plugs into the orchestrator with no OKORO
code changes:

1. Register under the operator's existing `principalId`.
2. Declare project's task `kind` registry — a per-handler-package
   JSON manifest at `packages/klytics-handlers/orchestrator.manifest.json`
   listing `{kind, schemaRef, capability, defaultRiskTier, roi}` per
   handler. OKORO validates incoming task envelopes against the
   referenced schema (D4 contract).
3. Declare team roster — list of agent identities + Slack user OAuth
   bindings (D5b) per team.
4. Point Slack channel routing — one `SlackIntegration` row per
   `(principalId, project, team)` triple.

Expected effort to onboard project #3 (Klytics): **~50 lines of
declaration code in Klytics + zero changes in OKORO**. This is the
scalability invariant the design must preserve.

**Scale targets (orchestrator V1 SLOs)**:

| Dimension                              | V1 target | Notes                                                       |
| -------------------------------------- | --------- | ----------------------------------------------------------- |
| Projects per principalId               | ≥ 25      | string-tag costs O(1); no per-project schema work in OKORO  |
| Teams per project                      | ≥ 100     | same                                                        |
| Concurrent agents per principalId      | ≥ 1,000   | pool model; BullMQ workers + Redis claim-key per `kind`     |
| Tasks created per second per principal | ≥ 100     | outbox-backed; inserts amortize via existing throttle layer |
| Task envelope payload size             | ≤ 256 KiB | hard cap; larger payloads go to S3/Blob with reference      |
| P95 task creation → ready              | < 250 ms  | DB write + outbox enqueue, no external calls in hot path    |
| P95 task ready → claimed               | < 2 s     | depends on agent pool warmth                                |
| Approval round-trip (Slack post→click) | < 60 s    | human-bound; Slack post < 1 s, click whenever               |

These targets get encoded in `tests/load/orchestrator.k6.ts` (new) as
gates before V1 GA. Failure of any gate before GA blocks the flag flip.

**Rationale**: keeping team/project as metadata (not tenancy) avoids
forking Prisma query paths, preserves invariant #5 absolutely, and
makes onboarding additive (string-tag the work, don't reshape the
schema). The pool model (capability-based matching, no per-agent
routing) is the same pattern that lets BullMQ scale linearly in worker
count — OKORO already uses BullMQ for the outbox, so the operational
muscle exists.

**Rejected alternatives**:
- **Team as a tenancy boundary** (separate `team_principal_id`).
  Rejected: forks every Prisma query (same reason as D1's rejected
  cross-tenant tasks), and "your own org's teams" is cleanly served
  by metadata routing under one principalId.
- **Per-project schemas baked into OKORO code**. Rejected: scales
  linearly with project count (every new project = OKORO PR);
  contradicts the "zero OKORO changes for project #3" goal.
- **No capability/pool model — explicit assignTo always required**.
  Rejected: doesn't scale past ~10 agents; operator becomes a
  scheduler; defeats the point.

### D7 — ROI activity tagging (every task attributes to value)

**OPERATOR-INPUT-NEEDED**

**Proposed default**: every task envelope carries a **required** `roi`
field with a typed activity tag. Five top-level kinds, each with
operator-defined sub-types (see D7a below):

```ts
type RoiActivity =
  | { kind: 'revenue';           sub: RevenueSub;        expectedValueUsd?: number }
  | { kind: 'cost_avoided';      sub: CostSub;           expectedHoursSaved?: number; hourlyRateUsd?: number }
  | { kind: 'risk_reduced';      sub: RiskSub;           severity: 'low' | 'med' | 'high' | 'critical' }
  | { kind: 'product_velocity';  sub: VelocitySub;       storyPoints?: number }
  | { kind: 'discovery';         sub: DiscoverySub;      learning?: string };
  // The five top-level kinds are OKORO-defined and stable; sub-types are operator-defined per D7a.

// After completion, append actuals (single TaskCompletionRecord, append-only via D2):
type RoiActuals = {
  taskId: string;
  actualValueUsd?: number;     // realized $ if measurable
  actualHoursSaved?: number;
  outcome: 'achieved' | 'partial' | 'missed' | 'pivoted';
  notes?: string;
};
```

**Why required (not optional)**: makes the discipline a forcing
function. If a task can't be ROI-tagged, it probably shouldn't run
autonomously — operator (or human team member) must explicitly tag it
`discovery` with a `learning` rationale. This prevents the common
failure mode where executive dashboards are empty because nobody
backfills tags.

**Aggregation product** (the executive narrative): a new orchestrator
endpoint `GET /v1/orchestrator/roi/rollup?from=…&to=…&groupBy=…`
returns:

```
Per period × per project × per team × per kind:
  - tasks_count
  - sum_expected_value_usd
  - sum_actual_value_usd
  - sum_hours_saved
  - risk_reduced_by_severity
  - velocity_story_points
  - discovery_count (with learning summary)
```

This feeds a dashboard tile per principalId that produces sentences
like _"In Q2, OKORO agents handled 1,247 tasks: $84K revenue-adjacent,
$112K cost-avoided, 9 critical risks reduced, 41 story points
shipped, 18 discoveries."_ Same shape rolls up across projects for
the portfolio view.

**Sub-decisions for the operator (D7a / D7b / D7c)**:

- **D7a — Sub-type taxonomy**. The five top-level kinds are
  OKORO-defined and stable. The sub-types are operator-defined and
  refined per project. Proposed defaults (5–10 lines the operator
  should refine in `packages/types/src/orchestrator-roi.ts` during
  M-060a):

  ```ts
  type RevenueSub      = 'trial_to_paid' | 'usage_growth' | 'new_customer' | 'renewal' | 'expansion';
  type CostSub         = 'incident' | 'support_ticket' | 'manual_investigation' | 'maintenance';
  type RiskSub         = 'security' | 'compliance' | 'reliability' | 'reputational';
  type VelocitySub     = 'feature_ship' | 'tech_debt' | 'docs' | 'test_coverage';
  type DiscoverySub    = 'research' | 'spike' | 'experiment';
  ```

  The operator may add (e.g., `'soc2_audit_cycle'` under cost_avoided
  for ComplianceKit) or remove. OKORO rejects unknown sub-types at
  envelope validation time (D4 Zod), so the taxonomy is enforced.

- **D7b — Cost model for normalization**. To roll cost_avoided and
  risk_reduced into a single dollar figure for the portfolio view, we
  need:
  - Default `hourlyRateUsd` (proposed: $150/hr — average loaded cost
    of a senior engineer + ops blend; operator overrides per role).
  - Severity → $ table for risk_reduced:
    - `low` = $1,000, `med` = $10,000, `high` = $100,000,
      `critical` = $1,000,000. (Industry-rough; operator should
      calibrate against own incident history.)
  Encoded in `packages/types/src/orchestrator-roi.ts` and overridable
  via `SystemConfig` row.

- **D7c — `discovery` semantics**. Tasks tagged `discovery` produce
  no dollar contribution to the rollup but DO count toward
  `discovery_count` and capture the `learning` string. This makes
  exploratory work first-class and prevents agents/humans gaming the
  system by mis-tagging research as `cost_avoided`. The dashboard
  shows discovery alongside the dollar columns — visible, not hidden.

**Rationale**: Without ROI tagging, the orchestrator is "neat tech"
but doesn't tell the operator what it's *worth* in business terms.
With it, every executive update, board deck, and OKORO sales pitch
("here's the ROI of AI agents under our control plane") writes
itself from the rollup. The required-field design is the forcing
function — optional taggers fail.

**Rejected alternatives**:
- **Free-form `tags: string[]`**. Rejected: no aggregation possible;
  taxonomy drifts in days.
- **Optional ROI field**. Rejected: never gets filled in; the
  dashboard ends up empty in 3 months; the operator narrative dies.
- **Per-project ROI taxonomies (no shared kinds)**. Rejected: cannot
  roll up across projects for the portfolio view, which is the
  central executive output of this design.
- **Compute ROI after-the-fact from audit events alone**. Rejected:
  audit events describe what happened, not what it was worth.
  Attribution requires intent at creation time.

### D8 — Interop with consumer projects' internal orchestration (additive-only)

**OPERATOR-INPUT-NEEDED** (this section added as a follow-up
correction after probing ComplianceKit state on 2026-05-21)

**Context**: ComplianceKit (the first M-060e consumer) **already has
its own internal orchestrator** at `apps/api/app/agents/orchestrator.py`
that drives a 10-agent swarm under a < 45-minute vault-generation SLA
(CK CLAUDE.md load-bearing rule #2). Future projects with their own
internal agent systems (likely: APEX trading bots, Klytics batch
agents, Forge automation) will be in the same posture. The OKORO
orchestrator must NOT replace these — replacement risks consumer-side
SLA invariants and creates a coordination cliff.

**Proposed default**: OKORO orchestrator is **additive-only**. The
consumer-side contract:

- **OKORO owns**: cross-project tasks, human approval surface (Slack),
  ROI attribution, cross-project audit chain, agent identity (already
  via `identity/`).
- **Consumer owns**: internal scheduling, intra-project agent
  coordination, fast-path local workflows that don't cross the OKORO
  boundary.
- **The seam**: a consumer task is "OKORO-routed" when it (a)
  originates outside the project, (b) requires human approval, (c)
  needs cross-project ROI attribution, or (d) needs the audit-chain
  evidence for compliance export. Local tasks that don't meet any of
  those stay inside the consumer's internal orchestrator and are
  invisible to OKORO.

**Specifically for ComplianceKit (M-060e shape)**:

```
                    ┌───────────────────────────────────────────┐
                    │      OKORO orchestrator (cross-project)   │
                    │   handles: cross-project handoffs,        │
                    │   approval gates, ROI rollup, audit       │
                    └───────┬───────────────────────────────────┘
                            │ @okoro/sdk-py  (D8 SEAM)
       ┌────────────────────▼─────────────────────────────┐
       │   ComplianceKit API (FastAPI + Python 3.12)      │
       │                                                  │
       │   ┌────────────────────────────────────────┐     │
       │   │  CK internal orchestrator (preserved)  │     │
       │   │  apps/api/app/agents/orchestrator.py   │     │
       │   │  10-agent swarm, < 45-min vault SLA    │     │
       │   └────────────────────────────────────────┘     │
       │                                                  │
       │   OKORO-routed tasks:                            │
       │   - "evidence refresh requested by sales call"   │
       │   - "SOC2 audit-cycle started" (ROI tag)         │
       │   - "policy revision needs operator approval"    │
       │                                                  │
       │   Internal tasks (NOT routed via OKORO):         │
       │   - vault-generation 10-agent swarm fanout       │
       │   - per-org policy linting                       │
       │   - trust-page render                            │
       └──────────────────────────────────────────────────┘
```

**The threshold rule** (operator-tunable, encoded per consumer in
their `ProjectManifest`): a task crosses the OKORO seam if **any** of:

1. `crossProject: true` (touches more than one project)
2. `riskTier === 'write' || 'admin'` AND `approvalRequired: true`
3. `roi.kind ∈ {'revenue', 'risk_reduced'}` AND
   `expectedValueUsd > $threshold` (portfolio-attribution-worthy)
4. `complianceArtifact: true` (needs to land on the signed audit chain
   for customer-facing export)

Otherwise: stays internal, never touches OKORO.

**Rationale**: this preserves consumer SLA invariants (CK's <45-min
promise lives or dies on internal-orchestrator latency, which can't
afford an external network round-trip per task), while keeping the
OKORO surface focused on the **portfolio-level decisions** that
benefit from centralization (approval, ROI, audit, cross-project).
The threshold rule is also the answer to "won't OKORO be a
bottleneck?" — no, because 99% of consumer-internal tasks never touch
it.

**Operator-input questions**:

- **D8a** — Is the threshold rule above the right shape, or should
  it be more permissive (more tasks cross the seam) or more
  restrictive (fewer)? Default proposed: as-stated.
- **D8b** — Per-project threshold tunables encoded where? Proposed:
  in the `ProjectManifest` JSON (D6) so each project sets its own
  thresholds without OKORO code changes.
- **D8c** — Migration story for future projects that DON'T yet have
  internal orchestration (e.g., a greenfield project starts with
  OKORO-orchestrator-only): proposed default — they declare
  `internalOrchestrator: null` in manifest; the threshold rule
  becomes "all tasks route via OKORO." When they outgrow this and
  build internal orchestration, they flip the manifest entry. No
  code change in OKORO.

**Rejected alternatives**:
- **Replace consumer-internal orchestration with OKORO** (uniform
  control plane). Rejected: per-task network round-trip kills CK's
  <45-min SLA; same risk for APEX trading-bot latency and Klytics
  batch throughput. Centralization-at-all-costs is the wrong
  ideology for a portfolio of products with diverse latency
  profiles.
- **OKORO is purely observability (read-only, no orchestration)**.
  Rejected: defeats D6's cross-project handoff and D3's approval
  surface. Half-measures lose the executive narrative.
- **Per-consumer custom integration (no seam contract)**. Rejected:
  re-invents the wheel for project #3, #4, #5. The D8 threshold
  rule IS the contract.

## Operator-input items (cross-reference for OD-020)

The seven `OPERATOR-INPUT-NEEDED` decisions above translate to these
choices the operator needs to lock before M-060 ships:

| Ref | Question                                                              | Default                                           |
| --- | --------------------------------------------------------------------- | ------------------------------------------------- |
| D1  | Tenancy: federated principalId vs. native cross-tenant?               | federated principalId                             |
| D2  | Audit: existing chain vs. separate stream?                            | existing chain (+ nullable `task_id`)             |
| D3  | Approval: denial-precedence vs. separate state machine?               | separate state machine                            |
| D4  | Schema location: `packages/types` vs. module-local?                   | `packages/types/src/orchestrator.ts`              |
| D5a | Slack workspace: per-tenant vs. shared?                               | per-tenant                                        |
| D5b | Slack identity binding: OAuth-link required?                          | yes                                               |
| D5c | Slack button-payload signing: KMS-managed?                            | yes                                               |
| D5d | Failure mode: orchestrator continues if Slack down?                   | yes (DB is truth)                                 |
| D6  | Team/project: metadata layer vs. new tenancy boundary?                | metadata layer (string tags on envelope)          |
| D6s | Scale targets locked as SLOs gating GA?                               | yes — encoded in `tests/load/orchestrator.k6.ts`  |
| D7a | ROI sub-type taxonomy (operator-refined per project)?                 | starter taxonomy in D7a — operator may add/remove |
| D7b | Cost model: $150/hr + low/med/high/critical → $1K/$10K/$100K/$1M?     | yes (operator calibrates against incident history)|
| D7c | `discovery` first-class kind (no $ contribution, visible in rollup)?  | yes                                               |
| D8a | Threshold rule shape (cross-project / write+approval / high-$ ROI / compliance)? | as-stated default                       |
| D8b | Per-project threshold tunables encoded in `ProjectManifest`?          | yes (D6 onboarding contract carries thresholds)   |
| D8c | Greenfield projects (no internal orchestrator) — manifest `internalOrchestrator: null` routes all tasks via OKORO? | yes |

Operator response shape (drop into OD-020 when filed):
- `accept defaults` — ship everything above as-stated, or
- `accept all except D{x}` with override text — partial accept, or
- Per-row override text in OD-020 table.

## Consequences

If accepted as drafted:

**Required follow-on work (separate claimed PRs)**:

1. `M-060a` — `packages/types/src/orchestrator.ts` Zod schemas + OpenAPI
   parity, INCLUDING the team/project metadata fields (D6) and the
   `roi` envelope contract (D7) with `packages/types/src/orchestrator-roi.ts`.
   Smallest first PR; operator refines the sub-type taxonomy here (D7a)
   in their own commits.
2. `M-060b` — `apps/api/src/modules/orchestrator/` module (controller,
   service, DTO, worker for state-machine transitions, Prisma migration
   for `Task` table + nullable `task_id` on AuditEvent, `SlackIntegration`
   table, `ProjectManifest` table for D6 onboarding contract).
3. `M-060c` — `@okoro/sdk-ts` AND `@okoro/sdk-py` `tasks.*` methods
   (create, claim, list, reportEvent, awaitApproval,
   completeWithActuals). **Both SDKs ship in parallel** because the
   first real consumer (ComplianceKit, M-060e) is FastAPI/Python on
   the API side and Next.js/TS on the web side — both surfaces need
   the SDK. Splitting into `M-060c-ts` and `M-060c-py` is acceptable
   if claim ergonomics favor that; treat as one logical unit of work.
4. `M-060d` — `packages/integrations/slack/` adapter + interactivity
   controller.
5. `M-060e` — ComplianceKit consumer wiring (in CK repo; depends on
   60a-d shipping). **Consumer language: Python** (CK's API and agent
   swarm are FastAPI 0.115 / Python 3.12 per CK's CLAUDE.md). CK web
   admin tile may also call `@okoro/sdk-ts`, but the orchestrator-side
   integration is Python-first via `@okoro/sdk-py`. First real
   consumer of the D6 onboarding contract; serves as the template for
   project #3 (Klytics) and beyond. **Critical interop constraint —
   see D8 below**: CK's internal `apps/api/app/agents/orchestrator.py`
   is preserved (load-bearing for CK's < 45-min vault SLA per CK
   CLAUDE.md rule #2). OKORO orchestrator is ADDITIVE: it handles
   cross-project work (OKORO↔CK handoffs, ROI rollup attribution,
   external approval surfacing); CK keeps its internal 10-agent
   swarm scheduling unchanged.
6. `M-060f` — **ROI rollup endpoint + dashboard tile**. New
   `GET /v1/orchestrator/roi/rollup` (paginated, principalId-scoped per
   invariant #5), plus dashboard tile at
   `apps/dashboard/app/orchestrator/roi/page.tsx` rendering the
   per-project / per-team / per-kind aggregation. The executive
   narrative surface.
7. `M-060g` — **Load gates**. `tests/load/orchestrator.k6.ts` encoding
   the D6 scale targets. Blocks V1 flag flip if any SLO regresses.
8. Docs: `docs/SERVICE_MAP.md`, `docs/spec/OKORO_API_SPEC.yaml`,
   `docs/spec/01_MASTER.md` orchestrator section, plus new
   `docs/runbooks/orchestrator.md` for operator runbook coverage.

**Invariant impact assessment**:
- Invariant #1 (private keys never in OKORO): unchanged.
- Invariant #2 (verify portability): preserved (D3 keeps orchestrator
  off the verify hot path).
- Invariant #3 (signed append-only chain): preserved (D2 routes events
  through it).
- Invariant #4 (no silent failures): orchestrator inherits the existing
  error catalog; new task-status codes added to it.
- Invariant #5 (principalId everywhere): preserved (D1).
- Invariant #6 (denial precedence stable): preserved (D3 keeps
  approval out of denial-precedence).
- Invariant #7 (centrally owned contracts): preserved (D4).
- Invariant #8 (SDK portability): preserved (Slack adapter is API-side
  only; SDK has no Slack-specific code).

**New OPERATOR-INPUT-NEEDED items added to OPERATOR_DECISIONS.md**:
- OD-020 — orchestrator design lock (this ADR's D1–D7).
- (Possibly) OD-021 — Slack workspace registration UX (whether
  operator self-serves via dashboard or via dashboard CLI).
- (Possibly) OD-022 — initial cost model calibration (D7b dollar
  values for severity table) — locks before M-060f ships, so the
  rollup numbers reflect operator reality not industry-rough defaults.

**Threat-model deltas** (route to `docs/THREAT_MODEL.md` when ADR
proposed):
- Slack workspace compromise — mitigated by KMS-signed button payloads
  (D5c) + per-principalId scoping (D5a).
- Replay of approval clicks — mitigated by per-task idempotency key.
- Stale claim — task `claimedBy` TTL'd (default 1h); auto-released on
  agent heartbeat absence.

## Rejected alternatives (whole-ADR level)

1. **New standalone repo (`agent-control`)**. Rejected: duplicates
   OKORO's identity, audit, policy, outbox primitives; would mean
   ComplianceKit talks to two control planes; harder to dogfood.

2. **Inside ComplianceKit monorepo**. Rejected: couples a platform
   capability to a single product surface; future projects (Klytics,
   APEX) would have to depend on ComplianceKit just to get
   orchestration; awkward billing/compliance boundary.

3. **Full agent autonomy without approval gates**. Rejected after
   operator review (see chat history 2026-05-21): ComplianceKit's value
   prop sells the inverse (controlled agent automation), so OKORO's
   internal agents going full-autonomy creates a sales objection and
   contradicts the compliance narrative. Tiered (read-auto / write-ask)
   is the locked policy. May relax per-task-type later via allowlist.

4. **Discord / Teams as first integration**. Deferred to post-V1.
   Adapter shape generalizes.

## Enterprise quality readiness

Per root CLAUDE.md, OKORO is *"public-company infrastructure: every change
needs a clear owner, a small blast radius, typed contracts, auditable
behavior, and verification evidence."* The eight sub-decisions above lock
the architecture. This section codifies the operational, security, and
compliance commitments that turn that architecture into a service an
enterprise buyer (and an auditor) can rely on.

### EQR-1 — Service Level Objectives (codified, gated in CI)

D6 listed eight V1 targets. They are committed SLOs, not aspirations.
Encoded in `tests/load/orchestrator.k6.ts` (M-060g) and asserted nightly.
SLO breach → release-block label on the PR + automatic page to the
on-call rotation per `docs/RUNBOOK.md`.

| SLI                                           | SLO (V1)              | Error budget (28-day)        |
| --------------------------------------------- | --------------------- | ---------------------------- |
| `POST /v1/tasks` 2xx rate                     | ≥ 99.9%               | 40m 19s of unavailability    |
| `POST /v1/tasks` P95 latency                  | < 250 ms              | n/a (latency, not error)     |
| `GET /v1/tasks` 2xx rate                      | ≥ 99.95%              | 20m of unavailability        |
| Task `ready → claimed` P95                    | < 2 s                 | latency SLI                  |
| Slack approval round-trip (post → click → resume) | < 60 s P95         | latency SLI; degraded if Slack down (D5d) |
| Audit-chain integrity verification on task events | 100%               | zero tolerance (invariant #3) |
| ROI rollup endpoint P95 latency               | < 800 ms              | latency SLI                  |
| Cross-SDK wire parity (ts ↔ py)               | 100%                  | zero tolerance (invariant #7) |

SLO targets are reviewed quarterly. Tightening requires a follow-on ADR;
loosening requires explicit operator sign-off and customer comms if any
SLO is published in a customer contract.

### EQR-2 — Observability spec

Inherits the existing OKORO stack: Pino structured logs, Prometheus
metrics, OpenTelemetry traces (per root CLAUDE.md stack reality). New
emissions added by M-060b/d/f:

**Metrics** (Prometheus; principalId is a label on every series):

- `okoro_orchestrator_tasks_created_total{project,team,kind,roi_kind,risk_tier}` (counter)
- `okoro_orchestrator_tasks_claimed_total{project,team,kind}` (counter)
- `okoro_orchestrator_task_state_transition_total{from,to,project,team}` (counter)
- `okoro_orchestrator_task_duration_seconds{project,team,kind,outcome}` (histogram; buckets aligned to SLO table)
- `okoro_orchestrator_awaiting_approval_seconds{project,team}` (histogram)
- `okoro_orchestrator_slack_post_total{result}` (counter; result ∈ ok|throttled|failed)
- `okoro_orchestrator_slack_callback_total{result}` (counter; result ∈ ok|hmac_invalid|kms_invalid|stale_nonce|unknown_task)
- `okoro_orchestrator_roi_actuals_total{kind,outcome}` (counter)
- `okoro_orchestrator_dlq_depth{queue}` (gauge)

**Structured log fields** (Pino; redaction list in
`apps/api/src/common/observability/`):

- Every log entry carries `principalId`, `taskId` (where applicable),
  `correlationId`, `kind`, `riskTier`.
- Redacted: `payload.*` raw values for `riskTier ∈ {write, admin}`
  (keep keys + hashes, drop values — same pattern as ADR-0006 audit
  redactability).

**Traces** (OpenTelemetry):

- Root span: HTTP request → controller.
- Child spans: state-machine transition, policy-engine eval, outbox
  enqueue, Slack post, audit-chain append.
- `taskId` and `correlationId` propagated as span attributes; trace
  exemplars attached to the latency histograms.

**Alerts** (per `docs/RUNBOOK.md` escalation criteria):

- `OrchestratorTaskCreateErrorRateHigh` — page-on-call when 5xx rate
  > 0.5% for 5m.
- `OrchestratorApprovalBacklog` — page-on-call when
  `awaiting_approval_seconds` P95 > 300s sustained 15m (D5d backstop;
  Slack-down chaos test).
- `OrchestratorAuditChainBreak` — **wake-the-house** alert; any
  audit-chain verification failure on a task event (invariant #3).
- `OrchestratorSlackCallbackForgeryAttempts` — security alert when
  `result=kms_invalid` rate > 0/min for 5m.

### EQR-3 — Failure-mode analysis (FMEA-lite) and rollback

| Failure                                | Detection                                    | Blast radius                  | Mitigation                                                                          | Rollback                              |
| -------------------------------------- | -------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------- |
| Slack provider outage                  | `slack_post_total{result=failed}` rises      | approval round-trip degrades  | Outbox retries with exponential backoff; tasks remain `awaiting_approval` (D5d)     | Operator may bulk-approve via dashboard fallback (M-060f) |
| Forged Slack interactivity payload     | `slack_callback_total{result=kms_invalid}`   | one task                      | KMS signature mismatch → 401 + audit event `intent.approval.forgery_attempt`        | Rotate KMS key per ADR-0011           |
| Orchestrator DB primary failure        | Prisma client errors + DB monitoring         | full surface unavailable      | RTO ≤ 5m via existing Postgres failover; `/v1/verify` is on the same instance       | Standard DB rollback                  |
| Outbox queue backlog                   | `dlq_depth` rises                            | event-driven side effects lag | BullMQ drainer + DLQ replay tool                                                    | Per existing outbox runbook (ADR-0007)|
| Audit-chain hash mismatch on task event | `OrchestratorAuditChainBreak` alert         | trust integrity               | Halt task ingestion; investigate via `@okoro/audit-verifier`; replay from snapshot  | **No silent recovery** (invariant #3) |
| ROI cost-model misconfiguration        | dashboard shows obvious skew                 | reporting accuracy only       | Cost model overridable via `SystemConfig` row (D7b)                                 | Revert SystemConfig row               |
| Consumer DoSes orchestrator with tasks | Per-principal rate limiting (existing throttle) | bounded per principal      | `@nestjs/throttler` config matches FREE/paid tier limits per OD-006                 | Block principalId via existing tooling|
| Schema migration applies wrong         | Migration immutability check fails           | release-blocked               | `pnpm check:migrations` prevents merge                                              | No deploy occurs                      |

**Rollback for the M-060 release itself**: orchestrator endpoints are
behind feature flag `OKORO_ORCHESTRATOR_ENABLED`. Flag-off disables
`POST /v1/tasks` (returns 501); consumers fall back to internal
orchestration (D8 seam). Audit events already written remain valid
(invariant #3). No data destruction on rollback.

### EQR-4 — Wire-level versioning policy

Task envelope schema (D4) and ROI taxonomy (D7) are public contracts
consumed by `@okoro/sdk-ts`, `@okoro/sdk-py`, and ComplianceKit. The
versioning rules:

1. **Additive changes only** within a major version. Allowed: adding
   optional fields, adding new `kind` literals, adding new `RoiSub`
   literals (each project's manifest declares which subs it uses).
2. **Removing or renaming** a field, kind, or sub-type is a **breaking
   change** — requires a major-version bump on `@okoro/sdk-*` and a
   ≥ 90-day deprecation window with `Deprecation` HTTP header on the
   old surface (per CLAUDE.md invariant #7).
3. **Risk-tier semantics are stable across minors.** Reclassifying
   `read → write` for an existing `kind` is breaking.
4. **OpenAPI parity gate** (`pnpm check:openapi-zod`) blocks any
   schema change that isn't reflected in the OpenAPI spec.
5. **Cross-SDK parity** (M-060c acceptance) blocks wire payload drift
   between TS and Py SDKs.

### EQR-5 — Security review gates (CLAUDE.md mandate)

Per root CLAUDE.md: *"Crypto, auth, billing, policy, audit, and
tenant-boundary changes require paired tests in the same change."*
Applied to M-060:

- **M-060b** crypto + audit-chain integration → paired specs required:
  `task.audit-chain.integrity.spec.ts`,
  `task.kms-signature.spec.ts`,
  `task.tenant-isolation.spec.ts` (principalId leakage between tenants).
- **M-060d** Slack HMAC + KMS button-payload signing → paired specs:
  `slack.hmac.spec.ts`, `slack.kms-signature.spec.ts`,
  `slack.replay-attack.spec.ts`, `slack.forged-payload.spec.ts`.
- **Threat-model delta** appended to `docs/THREAT_MODEL.md` in the
  M-060b PR. New STRIDE entries:
  - **Spoofing**: forged Slack approval (D5c mitigation: KMS signature
    on payload).
  - **Tampering**: task event audit-chain mismatch (D2 mitigation: chain
    verifier extended to orchestrator events).
  - **Repudiation**: task creator denies authorship (D2 mitigation:
    `agentId`-signed creation event).
  - **Info disclosure**: cross-tenant task list (D1 + invariant #5
    mitigation: principalId on every query).
  - **DoS**: task-create floods (existing throttler + per-principal
    rate limits per OD-006).
  - **Elevation of privilege**: Slack user clicks approval for task in
    another principalId (D5b mitigation: Slack-identity-to-principalId
    binding required before click counts).
- **KMS key inventory** updated in `docs/SECURITY.md`: orchestrator
  uses the existing audit-signer key family per ADR-0011 (no new key
  family added in V1; see OD-019(a) for the related decision on
  separate intent-signer key).
- **Penetration test scope**: orchestrator endpoints added to the
  next external pen-test SOW. Auth bypass + cross-tenant + Slack
  callback forgery are explicit test cases.

### EQR-6 — Compliance evidence binding

OKORO's value prop includes auditable agent behavior. The orchestrator
**produces evidence**, doesn't just consume it:

- **SOC 2 CC6 (logical access)**: orchestrator approval state machine
  (D3) is direct evidence of "privileged actions require approval."
  Export via `GET /v1/audit/events?taskId=…&decision=APPROVED|REJECTED`.
- **SOC 2 CC7 (system operations)**: SLO dashboards (EQR-1) + alert
  history (EQR-2) feed CC7.2 (monitoring) and CC7.4 (external comm).
- **SOC 2 CC8 (change management)**: every task with
  `complianceArtifact: true` (D8 threshold rule) lands on the signed
  audit chain (D2) and can be exported as immutable evidence.
- **GDPR Art. 17 (right to erasure)**: task records carry redactable
  fields per ADR-0006; redaction nulls the raw values, signed-hash
  proof of historical existence remains.
- **Audit retention**: task records inherit `AuditEvent` retention
  per OD-004 (default: 7 years). Task records **outside** the audit
  chain (claim metadata, transient state) follow a shorter retention
  in OD-023 (to be filed; default: 90 days).
- **ComplianceKit dogfood story**: CK can export its own OKORO-routed
  task history as SOC 2 evidence for *its* customers, using the
  existing `@okoro/verifier-rp` package. First case: M-060e ships.

### EQR-7 — High-availability and disaster-recovery posture

Inherits the existing API HA/DR per `docs/ARCHITECTURE.md`:

- **Active-passive Postgres** (Railway-managed, existing); orchestrator
  tables added to the existing failover scope. RTO ≤ 5m, RPO ≤ 30s.
- **Redis/BullMQ** for task-claim queues; cluster mode in production,
  same as existing outbox queue.
- **Stateless API pods**; orchestrator state lives in Postgres + Redis,
  no per-pod task state.
- **Slack adapter degraded mode** (D5d): if Slack is down, orchestrator
  continues; approval backlog drains on Slack recovery. The DLQ replay
  tool surfaces tasks whose Slack post failed repeatedly so an operator
  can choose dashboard-fallback approval (M-060f tile includes this
  surface).
- **Multi-region**: V1 is single-region (matches existing
  `/v1/verify`). Multi-region is a separate follow-on ADR; data
  residency for EU customers is OPERATOR-INPUT-NEEDED at that ADR
  (current decision: EU data residency follows the API's choice, which
  is currently single-region US per existing infra).
- **Backup verification**: task table included in the nightly backup
  + monthly restore drill per existing runbook.

### EQR-8 — Pricing, billing, and customer-facing posture

The orchestrator is a **paid feature** above the FREE trial tier. Per
ADR-0014 (locked OD-003 pricing):

- **FREE tier**: orchestrator disabled by feature flag at the
  principal-config level (not at the code level). Returns 402 + clear
  upsell message on `POST /v1/tasks` for FREE principals.
- **Developer ($49/mo)**: 1,000 orchestrator tasks/month included;
  overage at $0.005/task.
- **Team ($299/mo)**: 25,000 tasks/month + Slack integration enabled.
- **Scale ($1,499/mo)**: 250,000 tasks/month + ROI rollup endpoint +
  cross-project handoff.
- **Enterprise**: bespoke; includes per-org SLA contract + custom cost
  model (D7b) + multi-region option.
- **Stripe metering** for overage: `okoro_orchestrator_task_count` per
  principalId per billing period. Recording is non-blocking on the
  hot path (matches existing `/v1/verify` pattern; CLAUDE.md "must
  never block the verify hot path" generalizes here).
- **Public discovery**: orchestrator pricing surfaced via
  `/.well-known/pricing.json` extension (additive, per invariant #7).
- **Customer comms**: V1 announcement requires the existing release
  checklist (`docs/PRODUCTION_CHECKLIST.md`) + changelog entry +
  in-app banner for paid principals. **Pricing locked in OD-020-PRICE
  (to be filed if operator wants different per-tier numbers than the
  starter table above)**; defaults proposed here are starter values
  derived from existing OD-003 unit economics.

### EQR-9 — Operational runbook (stub + ownership)

Per docs/CLAUDE.md: *"Runbooks need exact commands, expected output
shape, rollback steps, and escalation criteria."* Stub created at
`docs/runbooks/orchestrator.md` (M-060h) covering:

- Healthcheck commands (curl + expected JSON).
- Task-stuck-in-state diagnostic flow.
- Slack adapter outage response (auto-degrades per D5d; how to verify).
- Audit-chain break response (page-the-house; chain verifier rerun).
- Bulk-approve flow (when Slack is down for hours; uses M-060f
  dashboard tile).
- DLQ replay procedure.
- Feature-flag flip procedure (`OKORO_ORCHESTRATOR_ENABLED` off/on).
- Escalation: page-on-call (PD service: orchestrator-primary) → eng
  manager → operator (Erwin).

**Ownership**: orchestrator service is owned by the platform team
(currently single-operator; flagged for hire if growth justifies).
On-call rotation joins the existing API on-call.

### EQR-10 — Definition of "done" (release gates)

Before flipping `OKORO_ORCHESTRATOR_ENABLED` to default-on in
production:

- [ ] All M-060a–h modules shipped + green on `pnpm check`.
- [ ] EQR-1 SLOs measured + held in M-060g for ≥ 7 days of staging
      traffic at production-like load (M-060e CK dogfood = real load).
- [ ] EQR-2 dashboards + alerts wired to PagerDuty.
- [ ] EQR-3 rollback procedure rehearsed at least once.
- [ ] EQR-5 security review gates passed: paired specs green,
      threat-model delta merged, KMS inventory updated, pen-test
      coverage on next SOW.
- [ ] EQR-6 SOC 2 control mapping reviewed by compliance owner
      (operator until hired).
- [ ] EQR-8 pricing locked in `apps/api/src/modules/billing/plans.ts`
      and surfaced via `/.well-known/pricing.json`.
- [ ] EQR-9 runbook completed beyond stub; on-call has practiced.
- [ ] Customer comms drafted + reviewed.
- [ ] ComplianceKit (M-060e) running ≥ 7 days in CK staging with no
      orchestrator-side incidents AND CK's <45-min vault SLA
      preserved (D8 invariant non-regression).

Any unchecked item blocks GA. The gate is the gate.

## Open follow-ups (do not block this ADR)

- Where does the orchestrator's "task type registry" live? Suggestion:
  per-handler-package convention (CK declares `ck.evidence.refresh` in
  its own code, OKORO sees only the kind string + schema URL). Defer
  to M-060b implementation. (D6 formalizes this as the
  `ProjectManifest` contract.)
- Should `intent-manifest` (ADR-0016/0017) bind to orchestrator tasks?
  Likely yes — every task that mutates external state could declare
  intent, and the existing intent-manifest signing (D5c reuses the
  KMS key) makes the binding cheap. Defer to a follow-on ADR after
  M-060b ships.
- Cross-project ROI portfolio dashboard (single view across
  OKORO + CK + Klytics + …). Defer to post-V1 dashboard work; M-060f
  ships the per-principal/per-project tile that this view aggregates.
- Capability-language for D6 (free-form strings vs. controlled
  vocabulary). Start free-form; promote frequent strings to a typed
  enum as patterns emerge.
- Per-role human cost overrides (D7b) — V1 ships a single
  `hourlyRateUsd`; per-role rates (eng vs. ops vs. exec) follow when
  the operator has data to justify the split.

---

**Next operator action**: review D1–D7, then either reply `accept
defaults` (and a follow-on session files OD-020 + M-060 + flips this
ADR to `proposed`), or annotate per-row overrides inline. The
highest-leverage operator contribution is **D7a** — the actual
sub-type taxonomy for ROI activities, since that's what your OKORO +
ComplianceKit + future-project executive narrative will be built
from.
