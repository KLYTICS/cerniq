---
title: CERNIQ — Master Operating System
audience: every contributor
last-reviewed: 2026-05-08
status: source-of-truth — v1
---

# 00 — Master Operating System

> The thesis: CERNIQ executes today as if every artifact will be read by
> a Series A diligence partner, an S-1 reviewer, and a forensic auditor
> in the same week. Not because we are about to be reviewed. Because the
> companies that survive that review are the ones that built the muscle
> from day one.

---

## 1. The thesis in one paragraph

CERNIQ is a verification, policy enforcement, and behavioral attestation
infrastructure for AI agents (read `docs/spec/01_MASTER.md`). The
product makes a single substantive claim — _"every agent action is
verifiable by a third party because the audit chain is signed and the
public-key registry is the only thing we hold."_ That claim is only
credible if the company shipping it operates with the same discipline.
Every commit, every ADR, every roadmap doc, every customer conversation,
every investor update is therefore held to the same bar: defensible,
sourced, signed, and reviewable. This document is the operating system
that makes that bar achievable without slowing down.

---

## 2. The non-negotiables (the public-company contract)

These are inherited from `CLAUDE.md` and extended with the institutional
disciplines that make CERNIQ a credible enterprise vendor and, in 24-36
months, a public company candidate.

### 2.1 Architectural invariants (from CLAUDE.md)

Reproduced here for emphasis. Violating any of these is a stop-the-line
event, regardless of who is asking and how urgent the request.

1. **Private keys never enter CERNIQ.** Public-key registry only.
2. **Verify hot path is portable.** No framework imports in the verify
   path; the path must Cloudflare-Workers cleanly.
3. **Audit log is append-only and signed.** Hash-chained, no UPDATE,
   no DELETE.
4. **No silent failures, no fabricated data.** Surface every downstream
   failure in the response and the audit log.
5. **Multi-tenant isolation by `principalId` on every query.** No
   cross-principal leaks.
6. **Denial precedence is fixed.** 10 reasons (post-ADR-0014) plus the
   pre-algorithm `PLAN_LIMIT_EXCEEDED` gate. Order is a public API contract.

### 2.2 Institutional invariants (added by this OS)

7. **Every architectural decision has an ADR.** No exceptions. Decisions
   without an ADR are reversible-by-default and may be undone by the
   next session.
8. **Every change is traceable.** Commit → PR → review → audit event.
   Nothing reaches `main` without leaving a record that survives
   personnel changes.
9. **Numbers cited to source.** Every metric, every claim of latency,
   every customer count, every revenue figure links to its source of
   truth (a CI run, a Stripe export, a customer contract). If a number
   is in a doc without a source, it is treated as fabricated.
10. **No single contributor ships unilaterally to production.**
    Segregation of duties — author and approver are different people
    (or different sessions, when humans aren't available). Emergency
    overrides require a documented postmortem within 48 hours.
11. **Forward-looking statements are bracketed.** When a doc speculates
    about future capability, pricing, customer outcomes, or roadmap
    timing, it labels the speculation explicitly. Default tone is
    historical/factual.
12. **The data room is perpetually current, not eleventh-hour.** Every
    doc that would appear in a Series A or S-1 data room is kept in a
    state where it could be shared today without revision.

The first six invariants protect the customer. The next six protect the
company.

---

## 3. The 4 axes

Every unit of work at CERNIQ resolves to a 4-tuple. The axes are
orthogonal — a person can change roles without changing departments,
move a task across stages without changing roles, etc.

```
                                        TASK STAGE
                                     ┌──────────────┐
                                     │  Intake      │
                                     │  Discovery   │
                                     │  Thinking    │
                                     │  Planning    │
                                     │  Implementing│
                                     │  Reviewing   │
                                     │  Shipping    │
                                     │  Postmortem  │
                                     └──────────────┘

  DEPARTMENT                                                AGENT ROLE
┌──────────────┐                                          ┌──────────────┐
│  Engineering │                                          │  Architect   │
│  Product     │                                          │  Implementer │
│  Design      │     ◄──── one task is one cell ────►     │  Reviewer    │
│  Security    │                                          │  Security    │
│  Compliance  │                                          │  Designer    │
│  GTM         │                                          │  Documenter  │
│  Cust. Succ. │                                          │  Compliance  │
│  Finance     │                                          │  IR          │
│  Legal       │                                          └──────────────┘
│  People      │
│  IR          │                          QUALITY GATE (per-stage)
│  Standards   │                                          ┌──────────────┐
└──────────────┘                                          │  Code        │
                                                          │  Security    │
                                                          │  Design      │
                                                          │  Docs        │
                                                          │  Compliance  │
                                                          │  Narrative   │
                                                          └──────────────┘
```

### 3.1 Why 4 axes and not 3 or 5

Three axes (department × stage × gate) was the prior model in
`SPRINT_PROTOCOL.md`. It's enough to get parallel work to ship without
collision. It is not enough for IPO-grade auditability. Adding the agent
role makes accountability legible: a reviewer can ask "who Architected
this and who Implemented it?" and get an unambiguous answer, even when
the same human did both.

Five axes (adding e.g. priority) was tried and dropped. Priority is a
property of the cell, not an axis — it gets recorded on the
`WORK_BOARD.md` claim, not in this matrix.

### 3.2 The 4-tuple in a commit message

Every non-trivial commit ends with a 4-tuple footer:

```
git commit -m "feat(verify): add anomaly bypass for trusted RPs

Implements proposal in docs/decisions/0027-trusted-rp-anomaly-bypass.md.
Verified against CLAUDE.md invariants 1, 5, 6.

OS-axis: Engineering / Implementer / Implementing / Code+Security"
```

Yes, that footer is verbose. Yes, it shows up in `git blame` forever.
That is the point — the artifact is auditable from the commit log alone.

---

## 4. How the design library plugs in

The design library at `docs/design/` is one tributary into this OS, not
an island. The integration model:

- Every design surface (`01_MARKETING_SITE_PROMPTS.md` through
  `05_PITCH_DECK_PROMPTS.md`) maps to a department owner (mostly Design,
  but Marketing surfaces co-own with GTM, the dashboard co-owns with
  Engineering, the deck co-owns with IR, the security page co-owns with
  Security and Compliance).
- Every prompt within those files maps to an agent role (the "Cursor
  in-repo" prompts are Implementer briefs; the "designer brief" sections
  are Architect-to-external-Architect handoffs; the AI-tool prompts are
  Designer briefs at the prototype stage).
- Every design surface ships through the same 8-stage lifecycle as code.
  Designs go through Reviewing (visual + a11y review) and Postmortem
  (did the surface drive the metric it was scoped to?) the same way
  code does.
- The design quality gates are the same gates documented in
  `04_QUALITY_GATES.md` — there is no "design quality" tier separate
  from code quality. The brand foundation is a SOX-equivalent control:
  it is the immutable spec the visual surfaces conform to, and changes
  require an ADR.

`06_INTEGRATION_MAP.md` is the per-surface ownership and routing matrix.

---

## 5. The Claude session as a first-class operator

CERNIQ is built by parallel sessions. Some are humans at keyboards. Many
are Claude sessions, claimed via `claude-peers` per `WORK_BOARD.md`.
This OS treats both as first-class operators. The same charters apply,
the same gates apply, the same audit trail applies.

What does change between humans and AI sessions:

- **Session continuity.** A human's working memory persists across
  weeks; a Claude session's does not. Every Claude session opens with
  `CLAUDE.md` → its assigned role brief from `02_AGENT_ROLES.md` → the
  module's `WORK_BOARD.md` entry → recent `SESSION_HANDOFF.md` entries.
  Closing the session writes a `SESSION_HANDOFF.md` entry with enough
  context that the next session — possibly weeks later, possibly a
  different model — can pick up cleanly.
- **Tool allowlists.** Humans have implicit access to everything; Claude
  sessions are role-scoped. An Implementer-role Claude session can edit
  code in the modules it claimed; a Reviewer-role session reads only.
  See `02_AGENT_ROLES.md` for the per-role tool list.
- **Hand-offs across models.** When a session escalates (e.g. a
  Sonnet-class Implementer hits a non-trivial architectural question),
  the escalation note in `SESSION_HANDOFF.md` is structured so an
  Opus-class Architect can pick up without context loss. The structure
  is in `03_TASK_LIFECYCLE.md` § escalation.

This is what "agentic engineering at IPO scale" means in practice: the
roles are constant, the audit trail is constant, the quality gates are
constant. The medium varies.

---

## 6. The contract every contributor signs

By committing code, opening a PR, or shipping any artifact under this
repo, you affirm:

1. You have read `CLAUDE.md` and the relevant chapter of this OS.
2. Your work clears the gates in `04_QUALITY_GATES.md` for its stage.
3. Numbers in your work are sourced; if you state a fact, you can cite it.
4. You have not bypassed segregation of duties — your author is not your
   approver.
5. If you discovered a violation of `CLAUDE.md` invariants, you stopped
   and surfaced it before continuing.
6. You wrote your `SESSION_HANDOFF.md` entry, or you are the human who
   reviewed and merged the entry written by a Claude session.

The contract is implicit but binding. There is no signature ceremony.
The audit trail enforces it.

---

## 7. What doesn't change at IPO scale

Some things public companies do that do not apply to CERNIQ today and
should not be retrofitted prematurely:

- **Quarterly guidance** — pre-revenue, pre-Series-A, premature.
- **Earnings calls** — N/A. Do not write monthly all-hands updates as
  if they were earnings calls.
- **Annual report production process** — adopt the _artifacts_ (SOX-
  mappable change management, MD&A-quality writing) without adopting
  the _cadence_ until the cadence makes sense.
- **Investor day** — N/A. A focused founder/operator-to-investor update
  monthly is sufficient.

The principle: adopt institutional disciplines that pay off compounding
returns now (audit trail, ADRs, sourced numbers, segregation of duties)
and defer the disciplines that are reporting-cycle-driven (quarterly
guidance, formal investor day, earnings call) until they create value.

---

## 8. What this is and isn't

This OS **is**:

- A coordination layer for parallel sessions.
- A bar for what shipping looks like.
- A contract for what every artifact must satisfy.
- The thing that makes the company auditable in 24 months without a
  retrofit project.

This OS **is not**:

- A bureaucracy. If a step in `03_TASK_LIFECYCLE.md` does not pay off
  its cost, propose an ADR removing it.
- A replacement for thinking. The lifecycle scaffolds thinking; it does
  not substitute for it.
- A shield against accountability. The audit trail makes individual
  contribution legible. That is intentional.
- An immutable text. It changes through ADRs like everything else.

---

## 9. The first cut of metrics that prove this is working

A working OS produces a working business. We measure the OS itself by:

- **ADR coverage.** Every architectural decision has an ADR within 7
  days of being made. Target: 95%.
- **Source-link density.** Every number in a customer-facing doc has a
  source. Target: 100% in customer-facing, 90% in internal.
- **Postmortem completion.** Every shipped feature has a postmortem
  within 14 days. Target: 90%.
- **Lead time, claim → ship.** Median time from `WORK_BOARD.md` claim
  to merge. Target: <72h for P0, <14d for P1.
- **Review coverage.** PRs merged with at least one author-different
  approval. Target: 100% (no exceptions for trivial; trivial is the
  category most prone to invariant violation).
- **Cross-module parity test growth.** Tests that catch silent drift
  between sources of truth (see `SESSION_HANDOFF.md` round 23 for the
  pattern). Target: every duplicated source of truth has a parity
  test within 30 days of duplication being detected.

These metrics roll into the monthly operator update (see
`05_PUBLIC_COMPANY_READINESS.md` § monthly cadence).

---

## 10. Where to go from here

- New contributor: continue with `02_AGENT_ROLES.md` then your
  department's charter in `01_DEPARTMENT_CHARTERS.md`.
- Starting a task: `03_TASK_LIFECYCLE.md` end-to-end.
- Pre-merge check: `04_QUALITY_GATES.md`.
- Writing anything that will end up in a data room: skim
  `05_PUBLIC_COMPANY_READINESS.md` before you write the first sentence.
- Confused which doc governs your situation: `06_INTEGRATION_MAP.md`.
