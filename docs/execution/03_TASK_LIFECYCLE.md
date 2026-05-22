---
title: OKORO — Task Lifecycle (scaffolded thinking → planning → implementing)
audience: every contributor; mandatory for any non-trivial task
last-reviewed: 2026-05-08
status: source-of-truth — v1
---

# 03 — Task Lifecycle

> The cognitive scaffold every task moves through. Eight stages, each
> with required inputs, deliverables, sign-offs, and time budgets. The
> scaffold exists so thinking, planning, and implementing each get
> their own dedicated phase — instead of being collapsed into "I'll
> just start coding and figure it out."

The 8 stages and their canonical names:

```
0  INTAKE         Request received, captured, classified
1  DISCOVERY      Read prior art, map the constraint surface
2  THINKING       Define the problem, enumerate options, weigh trade-offs
3  PLANNING       Write the proposal / RFC / ADR; gate decisions
4  IMPLEMENTING   Build, with parallel tracks if applicable
5  REVIEWING      Code review, security review, design review, gate-check
6  SHIPPING       Release, communicate, monitor
7  POSTMORTEM     What worked, what didn't, what to change
```

Trivial tasks (typo fixes, link updates, formatting) collapse stages
1-3 into a single sentence in the PR description. Non-trivial tasks
move through every stage explicitly.

---

## Stage 0 — Intake

**Purpose.** Convert an unstructured request into a structured one.
Refuse to start work on a request that hasn't passed Intake.

**Trigger.** A request arrives via any channel (customer Slack, GitHub
issue, operator instruction, ADR follow-up, customer-success
escalation, internal ask).

**Inputs.**
- The raw request (whatever form it arrived in).

**Activities.**
- Capture the request as a structured ticket (`WORK_BOARD.md` entry
  or GitHub issue; both shapes are acceptable).
- Classify:
  - **Department** (which charter governs this?)
  - **Trivial vs non-trivial** (does this need stages 1-3 or can they
    collapse into a one-sentence rationale?)
  - **Priority** (P0 = blocks production, P1 = blocks shipping plan,
    P2 = backlog)
  - **Origin** (customer, internal, regulator, ADR follow-up)
  - **Touch surface** (which files, which invariants, which ADRs)
- If the request implies a `CLAUDE.md` invariant violation: classify
  as **needs-Architect-stage**.
- If the request requires capabilities OKORO doesn't ship yet:
  classify as **needs-Product-evaluation**.
- If the priority is unclear, default P2 and surface for triage.

**Deliverables.**
- A `WORK_BOARD.md` entry or issue with: id, title, classification,
  paths, acceptance criteria (placeholder is okay), `STATUS: open`.
- Optional: a one-paragraph rationale linking to the source request
  for traceability.

**Sign-offs.**
- None at this stage. Capture is sufficient.

**Time budget.** <15 minutes.

**Exit gate.** A claim-able item exists with enough information that a
second contributor could pick it up cold.

**Anti-patterns.**
- Starting work on a Slack DM. Slack DMs are not tickets.
- Inflating priority. Most P0s are P1s in disguise. Calibrate.
- Skipping the path map. Knowing which files a task touches at intake
  prevents accidental cross-claim violations later.

---

## Stage 1 — Discovery

**Purpose.** Map the constraint surface before generating options.

**Trigger.** A claim is taken on a `WORK_BOARD.md` item.

**Inputs.**
- The intake ticket.
- Read access to the entire repo.

**Activities.**
- Read the relevant ADRs in `docs/decisions/`. The decisions space is
  the single most important context.
- Read the relevant chapters in `docs/spec/`, `docs/ARCHITECTURE.md`,
  `docs/SECURITY.md`.
- Read recent `SESSION_HANDOFF.md` entries for the same module.
- Read the existing tests for the module — they encode the contract.
- Read the existing implementation — even if you'll rewrite it.
- Identify dependencies and blocking work.
- Identify the customer-facing impact (will this change a public API?
  a public claim? a public surface?).
- Search the issue tracker / git log for prior attempts at the same
  problem. Failed attempts are signal.

**Deliverables.**
- A short discovery note (in the issue, the PR draft, or a scratch
  doc): "what I read, what I know now, what I don't yet know."
- A list of questions for the operator or other roles, if any.
- An updated `WORK_BOARD.md` entry if the scope changed.

**Sign-offs.**
- None required, but if Discovery surfaces an architectural question,
  the work pauses pending Architect engagement.

**Time budget.** 15 minutes for trivial; 1-3 hours for non-trivial.

**Exit gate.** You can answer "what does the system look like today?"
without checking again.

**Anti-patterns.**
- Skipping Discovery to "save time." Time saved here is time burned in
  Implementing as you discover the constraint you missed.
- Treating Discovery as research-only. The deliverable is structured
  notes, not a closed-tab list.
- Not asking questions. Discovery is when questions are cheap. By
  Implementing, they're expensive.

---

## Stage 2 — Thinking

**Purpose.** Define the problem and enumerate options before settling
on one.

**Trigger.** Discovery is complete.

**Inputs.**
- The Discovery output.
- The intake ticket.

**Activities.**
- **Problem definition.** State the problem in one paragraph. Not the
  solution — the problem. Include: who experiences the pain, what
  they observe, what the cost is.
- **Constraint enumeration.** List the hard constraints (`CLAUDE.md`
  invariants, ADRs, API contracts, customer commitments) and the
  soft ones (latency budgets, dependency choices, team familiarity).
- **Option enumeration.** Generate at least three options. The first
  two are usually the obvious ones; the third is where the interesting
  ideas come from. If you can only generate two, you have not thought
  hard enough.
- **Pre-mortem.** For the leading candidate option: "this fails six
  months from now if…" — list the failure modes.
- **Trade-off table.** Each option × each evaluation criterion (effort,
  risk, reversibility, latency impact, security impact, customer
  impact, dependency creation).

**Deliverables.**
- A thinking doc — could be a short scratch in the PR description for
  trivial work, or a proper RFC under `docs/decisions/proposals/` for
  non-trivial work. Includes problem, constraints, options, trade-off
  table, pre-mortem, recommendation.
- A list of the `CLAUDE.md` invariants the work touches.

**Sign-offs.**
- For non-trivial work, the Architect role is in this stage. The
  operator may be consulted; Security must be consulted if the work
  touches crypto, audit chain, or denial precedence.

**Time budget.** 30 minutes for medium; 1-2 days for major
architectural work.

**Exit gate.** A reader of the thinking doc agrees that the
recommendation is the best of the enumerated options, given the
constraints.

**Anti-patterns.**
- Single-option proposals. If you only consider one option, you are
  not thinking; you are advocating.
- Skipping the pre-mortem. Pre-mortems prevent more bugs than tests.
- Stopping at "the obvious option." The obvious option is sometimes
  right, but you only know that after considering the alternatives.

---

## Stage 3 — Planning

**Purpose.** Convert the thinking output into a concrete plan with a
durable artifact.

**Trigger.** Thinking is complete and the recommended option is
selected.

**Inputs.**
- The thinking doc.

**Activities.**
- For architectural work: write an ADR following
  `docs/decisions/0000-template.md`. Include: context, decision,
  consequences (positive, negative, neutral), alternatives considered
  with rejection reasons, references, migration plan if relevant,
  rollback plan.
- For non-architectural work that is still non-trivial: write a short
  plan in the issue or the PR description. Include: scope, sequence
  of changes, test plan, rollback plan.
- For trivial work: a one-sentence plan in the PR description suffices.
- Update `WORK_BOARD.md` with the refined acceptance criteria.
- Identify parallel tracks: which parts of this work can be claimed by
  different sessions and shipped concurrently? Each parallel track is
  a sub-claim with its own paths.
- Map dependencies between tracks. Which track must finish first?

**Deliverables.**
- The ADR (for architectural work) or a plan document (for non-
  architectural).
- Updated `WORK_BOARD.md` entries — possibly multiple, one per
  parallel track.
- A test plan: what tests will exist when this is done? What test
  coverage delta will the work produce?
- A rollback plan: if this ships and is wrong, how do we back it out?

**Sign-offs.**
- Architect role on the ADR.
- For ADRs touching invariants: Operator + Security (and Compliance
  if relevant).
- For ADRs touching public API: Engineering + Standards + GTM aware.

**Time budget.** 1-2 hours for ADR; 30 minutes for plan; 5 minutes
for trivial.

**Exit gate.** A different contributor could pick up the work and
implement it without re-deciding any architectural question.

**Anti-patterns.**
- Implementing while Planning. Plans get worse when written under
  the pressure of an in-progress implementation.
- ADRs that are trivially short ("we'll use Postgres because it's
  what we know"). The shape of the ADR — context, decision,
  consequences, alternatives — is the discipline. Even if the
  decision is short, the structure is enforced.
- No test plan. The test plan is part of the planning, not part of
  the implementing.

---

## Stage 4 — Implementing

**Purpose.** Build the thing.

**Trigger.** Planning is complete and a claim is held on
`WORK_BOARD.md`.

**Inputs.**
- The plan / ADR.
- Code, tests, the existing module.

**Activities.**
- Write tests first when the change is testable behavior. Crypto code
  has a paired `.spec.ts`, no exception.
- Write the implementation.
- Verify with the local test suite.
- Update affected docs if scope-appropriate (release notes, integration
  guides, API reference if the public API changed).
- Commit in coherent, atomic steps. Commit messages reference the ADR
  and the OS-axis (see `00_OPERATING_SYSTEM.md` § 3.2).
- Open a draft PR early; iterate in the PR rather than locally for too
  long. Reviewer can give early feedback on direction.

**Deliverables.**
- A PR with: code, tests, doc updates, the OS-axis footer in commit
  messages, a PR description that:
  - Cites the ADR.
  - Lists `CLAUDE.md` invariants touched and how each is preserved.
  - Includes "What changed" and "What did not change."
  - Includes a rollback plan link (the one from Planning).
  - Includes a test plan checklist with each item ticked.
- A `SESSION_HANDOFF.md` entry that summarizes the work, the test
  results, and the state of the module after merge.

**Sign-offs.**
- The Implementer self-reviews against `04_QUALITY_GATES.md` before
  marking the PR ready.

**Time budget.** Variable. For each estimated hour of implementation,
budget 30 minutes for tests and 15 minutes for doc updates.

**Exit gate.** The PR is in a state where a Reviewer can pick it up.

**Anti-patterns.**
- Writing tests after the implementation, or not at all. Untested
  behavior is broken behavior waiting to be observed.
- "I'll write the doc later." Later does not exist. The doc is part
  of the implementation. (See `02_AGENT_ROLES.md` § Documenter for the
  7-day window after merge — that's the absolute outer bound.)
- Editing files outside the claimed module. If the implementation
  reveals a needed change in another module, claim that module too,
  or message its holder. Never silently cross-edit.
- Skipping the test plan checklist. The PR description's test plan
  is the explicit promise the Implementer is making about what was
  verified.

---

## Stage 5 — Reviewing

**Purpose.** Gate the merge against the bar.

**Trigger.** The PR is marked ready for review.

**Inputs.**
- The PR diff.
- The ADR / plan.
- `04_QUALITY_GATES.md`.

**Activities.**
- Read the ADR / plan first. Establish what the implementation is
  supposed to do.
- Read the PR description. The Implementer's claims about what the
  work does, what it doesn't do, and what invariants it preserves.
- Read the diff. Every line.
- Run the tests locally for non-trivial work.
- Walk the gates in `04_QUALITY_GATES.md`. Each gate gets an explicit
  pass/fail in PR comments.
- For changes touching invariants: confirm the invariant is preserved.
  If unsure, tag Security or Compliance.
- For changes touching public API: confirm the change is documented
  and customer-communicated.

**Deliverables.**
- Approval, request-for-changes, or block, with reasoning.
- Gate-by-gate confirmation in PR comments.
- For Architectural changes: explicit confirmation that the
  implementation matches the ADR.

**Sign-offs.**
- The Reviewer is a different identity from the Author. (See
  `02_AGENT_ROLES.md` § Multi-role sessions for the SoD discipline.)
- Security review required for any change touching crypto, audit
  chain, denial precedence.
- Compliance review required for any change touching control claims.
- Design review required for any change to a visual surface.

**Time budget.** 15-30 minutes for trivial; 1-3 hours for non-trivial;
half a day for substantial architectural change.

**Exit gate.** All gates pass; an Approver other than the Author has
clicked Approve.

**Anti-patterns.**
- "LGTM" without gate-by-gate confirmation. The audit trail needs
  reasoning, not just approval.
- Approving without running tests for non-trivial change.
- Self-approving in a multi-contributor team. (Solo founders may
  legitimately self-approve trivial work; for non-trivial, claim a
  Claude session as Reviewer.)
- Reviewing without reading the ADR. The ADR is the contract; the
  review is "did the implementation match the contract?"

---

## Stage 6 — Shipping

**Purpose.** Move the work from merged to live, communicated, and
monitored.

**Trigger.** The PR is merged to `main`.

**Inputs.**
- The merged code.
- Release notes draft.

**Activities.**
- Deploy via the release process (`docs/RELEASE_PROCESS.md`). For
  non-trivial: stage → canary → production. For trivial: direct
  production via the standard pipeline.
- Tag the release. Git tag follows semver; breaking changes bump
  major.
- Publish release notes — for customer-facing changes, run them
  through GTM and Customer Success before publication.
- Announce internally (the channel where the rest of the team learns
  about ships).
- Announce externally as appropriate (changelog, social, customer
  emails — only if the release is customer-facing and the GTM /
  Customer Success motion is set).
- Set up monitoring for the new code. Confirm the relevant alerts
  fire correctly. New SLO if applicable.
- Update `WORK_BOARD.md` to `STATUS: landed`.

**Deliverables.**
- Production deployment.
- Release notes (internal + external as applicable).
- Monitoring confirmation.
- `WORK_BOARD.md` `STATUS: landed`.
- A `SESSION_HANDOFF.md` entry confirming the ship.

**Sign-offs.**
- For production deploys: the Reviewer who approved the PR is a
  different identity from the deploy actor.
- For customer-facing changes: GTM and Customer Success have approved
  the release notes.

**Time budget.** 15 minutes for trivial; 1-2 hours for non-trivial;
half a day for major release with comms.

**Exit gate.** The change is live, the customer knows about it (if
relevant), and monitoring is watching it.

**Anti-patterns.**
- Skipping the canary. The canary is the discipline that catches the
  bug your tests didn't.
- Shipping without release notes. Release notes are part of the ship.
- "I'll announce it later." Customer comms have a half-life; later
  becomes never.
- Skipping monitoring confirmation. Production is observed; if it
  isn't, you don't know it's working.

---

## Stage 7 — Postmortem

**Purpose.** Learn from what shipped. Apply the learning. Update the
OS if needed.

**Trigger.** 14 days after Shipping for non-trivial work; immediately
for incidents.

**Inputs.**
- The shipped feature in production for 14 days (or the incident).
- Metrics: usage, errors, customer feedback.
- The original problem statement and success metric.

**Activities.**
- Compare actual outcome to predicted outcome.
- Identify what worked.
- Identify what didn't (the failure modes from the Thinking-stage
  pre-mortem — did any fire? did any fire that you didn't predict?).
- Identify what to change in the OS itself: did a stage's deliverable
  fail to catch a bug? Should the gate change? Should a new ADR
  amend an existing pattern?
- For incidents: full `docs/INCIDENT_RUNBOOK.md` flow. Postmortem
  shipped within 72 hours of resolution.

**Deliverables.**
- A short postmortem doc — could be a section in the existing ADR
  ("Outcome" added at the bottom) or a new file under
  `docs/postmortems/`. Includes: predicted vs. actual, what worked,
  what didn't, action items, OS-update proposals.
- Action items added to `WORK_BOARD.md` if applicable.
- For incidents: the customer-facing postmortem (if customer-impacting),
  reviewed by GTM and Legal, published per `docs/INCIDENT_RESPONSE.md`.

**Sign-offs.**
- Architect on the action items.
- Operator on any OS-update proposal.

**Time budget.** 30 minutes for shipped feature; 2-3 hours for
incident postmortem.

**Exit gate.** The learning is captured in a durable artifact and
linked from the original ADR / ticket. The action items are claimable
work.

**Anti-patterns.**
- Skipping postmortems on successful work. Successes have lessons
  too — what did we predict correctly that we should keep doing?
- Blameful postmortems. The culture is blameless; the artifact is
  the system, not the individual.
- Postmortems that don't change anything. If a postmortem produces no
  action items, either the work was perfect (rare) or the postmortem
  was shallow.

---

## Lifecycle for the most common work shapes

### Bug fix

```
Intake (5min) → Discovery (15min, find the reproduction)
  → Thinking (15min, identify the cause not just the symptom)
  → Planning (5min, decide whether the fix is a one-line or a refactor)
  → Implementing (varies, with regression test)
  → Reviewing (15min)
  → Shipping (15min)
  → Postmortem (skip if trivial; required if customer-facing)
```

### New feature, small

```
Intake (10min) → Discovery (1h)
  → Thinking (1h, three options)
  → Planning (30min, plan doc not full ADR)
  → Implementing (variable)
  → Reviewing (1h)
  → Shipping (1h)
  → Postmortem (30min at 14d)
```

### New feature, architectural

```
Intake (15min) → Discovery (3h)
  → Thinking (1d, RFC under docs/decisions/proposals/)
  → Planning (1d, ADR + parallel-track decomposition)
  → Implementing (multiple parallel claims, days/weeks)
  → Reviewing (multi-pass; Security + Compliance + Architect)
  → Shipping (with canary, comms, monitoring)
  → Postmortem (3h at 14d, with action items)
```

### Incident

```
Detection → Triage → Mitigation → Resolution
  → Customer comms (per docs/INCIDENT_RESPONSE.md)
  → Postmortem (within 72h of resolution)
  → Action items into WORK_BOARD.md
  → OS update if root cause was OS-shaped
```

### Public-facing artifact (deck, page, blog post)

```
Intake (5min, classify the audience and scope)
  → Discovery (30min, prior art and competitive scan)
  → Thinking (1h, key messages and structure)
  → Planning (30min, outline, sources for every claim)
  → Implementing (variable)
  → Reviewing (multi-role: Documenter + Design + GTM + Compliance + IR
    as applicable)
  → Shipping (publish, archive the version in the data room)
  → Postmortem (track engagement; for investor docs, track which
    questions came up that weren't anticipated)
```

---

## Escalation between stages

A task may bounce backward in the lifecycle — from Implementing back
to Thinking, for example, if implementation reveals the plan was
wrong. The discipline is:

- The bounce is **explicit**. A note in the issue or PR: "Bouncing
  back to Thinking — the spend-cap caching strategy in ADR-0027 is
  wrong, see comment thread." Do not silently change direction.
- The original ADR is **amended or superseded**, not silently ignored.
- The work re-enters the lifecycle at the appropriate stage and walks
  forward from there.
- The bounce is **a postmortem-stage learning** for the OS: what could
  Discovery or Thinking have caught earlier?

---

## Time budgets summary

| Stage | Trivial | Medium | Architectural |
|---|---|---|---|
| 0 Intake | <5min | 10min | 15min |
| 1 Discovery | 15min | 1h | 3h |
| 2 Thinking | 5min | 1h | 1d |
| 3 Planning | 5min | 30min | 1d |
| 4 Implementing | varies | varies | days/weeks |
| 5 Reviewing | 15min | 1h | 3h |
| 6 Shipping | 15min | 1h | half-day |
| 7 Postmortem | skip | 30min | 3h |

If your stage is taking dramatically longer than the budget, you are
either operating at the wrong granularity (the work is bigger than
classified) or skipping discovery (you're discovering during
Implementing, which is the most expensive place to discover).

---

## Related documents

- `00_OPERATING_SYSTEM.md` — the master.
- `02_AGENT_ROLES.md` — who does what at which stage.
- `04_QUALITY_GATES.md` — what each stage's deliverable must satisfy.
- `docs/SPRINT_PROTOCOL.md` — how parallel sessions coordinate.
- `docs/INCIDENT_RUNBOOK.md` — the incident-specific lifecycle.
- `docs/RELEASE_PROCESS.md` — the Shipping stage in detail.
- `docs/RELEASE_NOTES_TEMPLATE.md` — the customer-facing artifact shape.
