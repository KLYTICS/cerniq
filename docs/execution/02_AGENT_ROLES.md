---
title: CERNIQ — Agent Role Briefs
audience: every Claude session, every human contributor; mandatory at session-start
last-reviewed: 2026-05-08
status: source-of-truth — v1
---

# 02 — Agent Role Briefs

> An "agent" in this document is the _role_ a contributor is occupying
> for a given task — not whether the contributor is human or a Claude
> session. The same person can be Architect at 9am and Reviewer at 11am
> on different tasks; the same Claude session can be Implementer for
> the duration of a claim and Reviewer when validating its own work.
>
> Roles exist to make accountability legible. A reviewer asking "who
> Architected this and who Implemented it?" gets an unambiguous answer
> from the audit trail, regardless of who held the keyboard.

---

## How to use this file

- Every session opens by reading this file's row for the role being
  occupied. The row is short by design — read it.
- A claim on `WORK_BOARD.md` declares both the module and the role
  (`claude-peers claim cerniq M-XYZ --role implementer --note "..."`).
- A handoff in `docs/SESSION_HANDOFF.md` declares the role transition
  if any (e.g. "Implementer→Reviewer for self-review on M-XYZ").
- The role brief defines the _minimum_ expectations. Departmental
  charters in `01_DEPARTMENT_CHARTERS.md` add department-specific bars.

---

## The roles

```
┌───────────────────┬─────────────────────────────────────────┐
│  Architect        │  Plans. Writes ADRs. Decides shape.     │
│  Implementer      │  Builds. Edits code. Lands PRs.         │
│  Reviewer         │  Approves. Gates merges. Bar-keeps.     │
│  Security         │  Crypto/threat-model authority.         │
│  Designer         │  Visual + UX authority.                 │
│  Documenter       │  Public-facing prose authority.         │
│  Compliance       │  Control + evidence authority.          │
│  IR               │  Investor-facing artifact authority.    │
└───────────────────┴─────────────────────────────────────────┘
```

Eight roles. A role can be held by one person, by multiple humans, or
by a sequence of Claude sessions. What does not change: the role's
responsibilities and bar.

---

## 1. Architect

**One-line.** Decides the shape of the thing before it is built.

**Context bundle (read at session start).**

- `CLAUDE.md` end-to-end.
- `docs/execution/00_OPERATING_SYSTEM.md`.
- `docs/execution/03_TASK_LIFECYCLE.md` § Thinking + Planning stages.
- `docs/ARCHITECTURE.md`.
- `docs/decisions/` index — skim the last 20 ADRs.
- The relevant department charter (`01_DEPARTMENT_CHARTERS.md`).
- The module's `WORK_BOARD.md` entry and any blocking ADRs.

**Tool allowlist.**

- Read: everything.
- Write: `docs/decisions/` (new ADRs), `docs/spec/` (extending specs),
  the module's design doc if any, `WORK_BOARD.md` (claim), `docs/
SESSION_HANDOFF.md` (handoff entries).
- Forbidden without role transition: editing implementation code in
  `apps/`, `packages/`, `workers/`. Architects propose; Implementers
  build. The transition is explicit.

**Mandatory deliverables for non-trivial work.**

- An ADR in `docs/decisions/` titled `NNNN-<short-slug>.md`,
  following the canonical template (`docs/decisions/0000-template.md`).
  Includes: context, decision, consequences (positive + negative + neutral),
  alternatives considered (with rejection reasons), references.
- A pre-mortem section: "this could go wrong if… and we'll detect it by…"
- A migration / rollback plan if the decision changes anything in
  production.
- A list of `CLAUDE.md` invariants the work either reinforces or
  challenges. If any are challenged, the ADR is the override path —
  but the override requires Operator + Security + (if relevant)
  Compliance approval.

**Success criteria.**

- The Implementer who picks up the work can build it without
  re-deciding any architectural question.
- The Reviewer can gate the result against the ADR — does the
  implementation match the decision?
- Six months from now, a new contributor reads the ADR and knows why
  the choice was made.

**Escalation paths.**

- If a decision touches a `CLAUDE.md` invariant: stop, write the ADR,
  request Operator + Security review before proceeding.
- If a decision affects the public API: stop, write the ADR, tag
  Engineering + Standards + GTM (because public-API changes affect
  customers and integrations).
- If a decision touches denial precedence or audit chain: stop, write
  the ADR, Security has veto.

**Anti-patterns.**

- Implementing while Architecting. The decision is unstable until the
  ADR is written; building on unstable decisions creates rework.
- Writing the ADR after the fact. Backfilled ADRs are documented
  decisions, not made decisions. They have less authority and are
  treated with suspicion in audit.
- "Skipping the ADR for a small thing." Most invariant violations
  start as small things.

---

## 2. Implementer

**One-line.** Builds the thing the Architect specified.

**Context bundle.**

- `CLAUDE.md`.
- `docs/execution/00_OPERATING_SYSTEM.md`.
- `docs/execution/03_TASK_LIFECYCLE.md` § Implementing stage.
- `docs/execution/04_QUALITY_GATES.md`.
- The ADR(s) that govern the work.
- The module's `WORK_BOARD.md` entry.
- The relevant test files for the module — read the existing test
  shape before writing new code.
- Recent `docs/SESSION_HANDOFF.md` entries that touch the same module.
- The `docs/design/` files relevant to any UI surface.

**Tool allowlist.**

- Read: everything.
- Write: code in the modules claimed on `WORK_BOARD.md`, tests for
  those modules, the affected `docs/` if scope-appropriate (e.g.
  release notes, integration guides for the feature), `WORK_BOARD.md`
  (status flips), `docs/SESSION_HANDOFF.md` (delivery entries).
- Forbidden: writing ADRs (Architect role), changing other modules
  (claim those modules first or message the holder), editing
  `CLAUDE.md` or `docs/SECURITY.md` (Operator + Security own).

**Mandatory deliverables.**

- Code that compiles, typechecks strict, lints clean, and clears the
  test bar (see `04_QUALITY_GATES.md`).
- Tests covering the new behavior. Crypto code requires a paired
  `.spec.ts`.
- A PR description that:
  - Cites the ADR being implemented.
  - Lists the `CLAUDE.md` invariants the work touches and how each
    is preserved.
  - Includes the OS-axis footer (see
    `00_OPERATING_SYSTEM.md` § 3.2).
  - Includes a "What changed" and "What did not change" section.
- A `SESSION_HANDOFF.md` entry following the canonical shape (the
  Round 23 entry is the reference example).

**Success criteria.**

- A Reviewer can approve the PR against the gates in
  `04_QUALITY_GATES.md` without asking implementation-detail questions.
- Tests caught the bug you might have introduced; you didn't catch them
  manually.
- The next session can pick up the next module on the dependency graph
  without context loss.

**Escalation paths.**

- If the ADR is ambiguous: stop, request Architect clarification via
  `claude-peers msg <holder> "..."` or open an issue. Do NOT guess.
- If implementation reveals the ADR is wrong: stop, write a follow-up
  ADR proposing the change. Do NOT silently deviate.
- If you discover a `CLAUDE.md` invariant violation in adjacent code:
  stop, surface it, do not auto-fix.

**Anti-patterns.**

- Editing files outside the module claim. Even a "tiny" edit to a file
  in another module breaks the parallel-session contract.
- Skipping tests because "it's obvious." The bar is the test, not the
  obviousness.
- Fabricating data to make a test pass. The fabrication will surface
  later, in a worse place. (See `CLAUDE.md` invariant 4.)
- Adding `any` without `// type-rationale:`. Reviewers will block the
  PR; just write the rationale.

---

## 3. Reviewer

**One-line.** Approves merges. The bar.

**Context bundle.**

- `CLAUDE.md`.
- `docs/execution/00_OPERATING_SYSTEM.md`.
- `docs/execution/04_QUALITY_GATES.md` end-to-end (this is the
  Reviewer's principal tool).
- The ADR being implemented.
- The PR's diff.
- The PR's tests.

**Tool allowlist.**

- Read: everything.
- Write: PR comments, suggestions, the merge button.
- Forbidden: pushing commits to the PR branch. The Implementer
  remediates; the Reviewer reviews. (Exception: trivial typo fixes
  if both parties agree, recorded in PR conversation.)

**Mandatory deliverables.**

- An approval, request-for-changes, or block, with reasoning.
- A walk-through of the gates in `04_QUALITY_GATES.md`. Each gate
  receives an explicit pass/fail in the PR comments.
- For Architectural changes: explicit confirmation that the
  implementation matches the ADR.
- For changes touching `CLAUDE.md` invariants: explicit confirmation
  that the invariant is preserved or that an ADR exists overriding it.

**Success criteria.**

- A `git blame` six months from now traces a problem to either
  (a) a missing test the Reviewer should have caught, in which case
  the Reviewer process improves; or (b) a deliberate decision in an
  ADR, in which case the audit trail is intact.
- Reviewer is _not_ a rubber stamp — average review takes long enough
  to read the diff and run the tests locally.

**Escalation paths.**

- If the PR violates a `CLAUDE.md` invariant: block. Do not approve
  with comments — the bar is non-negotiable.
- If the PR is correct but the ADR is wrong: approve the PR if the
  ADR was followed; open a follow-up ADR.
- If unsure about a security implication: tag Security agent.
- If unsure about a Compliance implication: tag Compliance agent.

**Anti-patterns.**

- Approving without running tests locally for non-trivial changes.
- "LGTM" with no specific gate confirmation. The audit trail needs
  more than approval; it needs reasoning.
- Reviewing PRs you authored. Segregation of duties is non-negotiable.
  If you must (small team), surface the violation in the PR comments
  and request a second review by a Claude session before merge.

---

## 4. Security

**One-line.** The veto on cryptographic, threat-model, and denial-
precedence questions.

**Context bundle.**

- `CLAUDE.md` invariants 1, 3, 6 (private keys, audit chain, denial
  precedence).
- `docs/SECURITY.md` end-to-end.
- `docs/THREAT_MODEL_v2.md`.
- `docs/IMMUTABILITY.md`.
- `docs/audit_2026q2/FINDINGS_SUMMARY.md`.
- The ADRs the work depends on (esp. ADR-0002 non-custodial,
  ADR-0004 denial precedence, ADR-0005 audit canonicalization,
  ADR-0010 DPoP, ADR-0013 PQ hybrid).

**Tool allowlist.**

- Read: everything (especially crypto code, audit chain code, every
  PR touching either).
- Write: PR review comments and approvals/blocks; threat model
  updates; ADRs that touch security.
- Forbidden: bypassing the veto via comments. If Security blocks, the
  block stands until the override path (Operator + Security ADR) is
  followed.

**Mandatory deliverables.**

- Approval or block on every PR that touches:
  - `apps/api/src/common/crypto/*`
  - `packages/sdk-*/src/crypto*` or signing code
  - `apps/api/src/modules/audit/*`
  - any change to denial precedence reasons or order
  - threat-model-bearing surfaces (the public verify endpoint, the
    public-key registry, the audit export)
- Threat-model delta entry within 14 days of any change to the
  threat surface.
- Crypto-code review checklist completed (in PR comments):
  - Constant-time comparisons where required
  - No secret in error messages
  - Test vectors cover edge cases (empty input, max input, malformed)
  - The paired `.spec.ts` exists and runs

**Success criteria.**

- A penetration test six months from now does not find a bug Security
  should have caught at PR review.
- The audit chain remains tamper-detectable in O(n) for the lifetime
  of the company.
- Customer security questionnaires are answerable from existing docs;
  Security does not have to write a new control description on demand.

**Escalation paths.**

- If a PR violates a security invariant and the Implementer pushes
  back: escalate to the Operator. Security veto stands.
- If a customer questionnaire asks about a control that does not exist
  yet: escalate to Compliance, do NOT fabricate.
- If a vulnerability is reported externally: drive the
  `docs/INCIDENT_RESPONSE.md` process.

**Anti-patterns.**

- Approving crypto code without running the spec locally.
- Treating threat-model updates as "nice to have." They are part of the
  S-1 data room.
- Writing fixes inline in a PR review (Security should review, not
  remediate; the Implementer remediates).

---

## 5. Designer

**One-line.** The veto on visual and UX surfaces.

**Context bundle.**

- `docs/design/00_BRAND_FOUNDATION.md` end-to-end.
- The relevant `docs/design/01_*` through `05_*` for the surface.
- `01_DEPARTMENT_CHARTERS.md` § Design.
- Any prior visual work in the same surface (look at recent commits).

**Tool allowlist.**

- Read: everything visual + the surfaces under review.
- Write: design files in Figma, design assets in `packages/ui-brand`,
  PR review comments on visual changes, updates to
  `docs/design/00_BRAND_FOUNDATION.md` (this updates the foundation —
  requires an ADR).
- Forbidden: editing implementation code (Implementer's lane).
  Designers approve the visual outcome; Implementers wire it.

**Mandatory deliverables.**

- Approval or change-request on every PR that touches a visual
  surface (`apps/marketing`, `apps/dashboard`, `apps/docs`,
  `packages/ui-brand`).
- For new surfaces: a Figma frame (or the equivalent), with
  DEV-mode-ready handoff notes.
- A11y check (real screen reader pass on the surface) before approval.
- Brand-drift check: any hardcoded hex outside `00_BRAND_FOUNDATION.md`
  is blocked.

**Success criteria.**

- Public surfaces clear Lighthouse ≥95 (≥98 for docs).
- WCAG 2.2 AA holds across every shipped page.
- Brand foundation tokens are the only color source. If a violation
  ships, Designer is the role that owns the regression.
- Design surfaces feel like one product, not many. (Test: someone
  navigating from marketing → dashboard → docs sees consistent
  hierarchy, type, density.)

**Escalation paths.**

- Brand-foundation change request: write an ADR, get Operator
  approval.
- A11y regression in shipped code: file a P0, block further visual
  changes to that surface until fixed.
- Identity (logo) decisions: Operator-level decision; Designer
  proposes.

**Anti-patterns.**

- Approving visual changes without screen-reader pass.
- Letting "we'll fix it later" hardcoded hex pass review. There is no
  later — there is the next sprint, where it has multiplied.
- Designing in a vacuum from the foundation. Every visual decision
  resolves to a token reference or an ADR.

---

## 6. Documenter

**One-line.** The bar for public-facing prose.

**Context bundle.**

- `CLAUDE.md` (because docs that contradict invariants are bugs).
- `docs/personas/*.md`.
- `docs/design/03_DOCS_SITE_PROMPTS.md`.
- The technical truth being documented (read the code, not just
  the prior doc).
- The voice and tone reference (`docs/design/00_BRAND_FOUNDATION.md`
  § 2).

**Tool allowlist.**

- Read: everything.
- Write: `docs/`, `apps/docs/content/`, `apps/marketing/content/` (when
  copy is canonicalized there), README files in packages, JSDoc/
  TSDoc inline comments.
- Forbidden: changing technical truth (e.g. claiming `<80ms` when
  the code does `<120ms`). Documentation reflects truth; if truth
  is wrong, escalate to the relevant department.

**Mandatory deliverables.**

- Documentation for every shipped feature within 7 days of merge.
- Updates to affected concept pages, API reference, and integration
  guides.
- A `docs/RELEASE_NOTES_TEMPLATE.md`-shaped release note for
  customer-facing changes.
- Migration guides for any breaking change.

**Success criteria.**

- A developer in `docs/personas/developer.md`'s shoes reaches success
  using docs alone, no help required.
- Doc lints pass (markdownlint, link-checker, every code sample is
  syntactically valid and runs against the current API).
- Voice matches `00_BRAND_FOUNDATION.md` § 2 — precise, sourced,
  builder-respectful.

**Escalation paths.**

- If the technical truth is wrong: file an issue in the relevant
  module, do NOT publish docs that perpetuate the bug.
- If voice contradicts design: design wins; Documenter aligns.
- If a customer reports a docs-driven failure: P0; this is direct
  evidence of doc inadequacy.

**Anti-patterns.**

- Paraphrasing technical specifics. The 10 denial reasons, the
  `<80ms` claim, the Ed25519 algorithm — these come from canonical
  sources verbatim or not at all.
- Publishing speculative roadmap items as fact in customer-facing
  docs.
- Documentation that tells the reader what CERNIQ _will_ do; documentation
  describes what CERNIQ _does_ unless explicitly bracketed.

---

## 7. Compliance

**One-line.** Owns the control mapping, the evidence trail, and the
pre-IPO institutional muscle.

**Context bundle.**

- `01_DEPARTMENT_CHARTERS.md` § Compliance & Risk.
- `docs/COMPLIANCE.md`, `docs/COMPLIANCE_BUNDLE.md`.
- `docs/EU_RESIDENCY.md`, `docs/RETENTION_POLICY.md`.
- The status of every control claim CERNIQ makes externally.
- `05_PUBLIC_COMPANY_READINESS.md` (this OS).

**Tool allowlist.**

- Read: everything.
- Write: `docs/COMPLIANCE*`, the control mapping, sub-processor list,
  DPA template, contract-exception register.
- Forbidden: making compliance claims unsupported by evidence. The
  evidence pointer is mandatory before the claim ships externally.

**Mandatory deliverables.**

- Every customer-facing compliance claim has a control mapping and
  an evidence pointer.
- Every change to the threat surface has a corresponding control
  delta within 14 days.
- Every customer security questionnaire receives an answer derived
  from existing documented controls (Compliance writes nothing
  new; Compliance composes).
- Pre-audit dry-runs quarterly.

**Success criteria.**

- A SOC2 auditor arriving without notice can find every piece of
  required evidence in <30 minutes from the data room.
- No customer compliance claim has been overstated.
- The status table in `docs/COMPLIANCE.md` is honest at all times.

**Escalation paths.**

- If a customer claim is overstated: stop, file a correction, notify
  affected customers within 72 hours, document the correction.
- If an audit finding requires architectural change: ADR via
  Architect role.
- If a regulator engages: route to Legal + Operator.

**Anti-patterns.**

- "Aspirational" compliance status. The status field is binary at
  the granularity it presents (In place / In progress / Roadmap).
- Single-source compliance claims (a claim only in marketing copy
  with no control mapping). Every external claim has an internal
  source-of-truth.
- Last-minute audit prep. The data room is perpetually current; if
  it isn't, that's the failure to fix.

---

## 8. IR (Investor Relations)

**One-line.** Owns the narrative, the data room, and the institutional
artifacts investors and the board consume.

**Context bundle.**

- `01_DEPARTMENT_CHARTERS.md` § Investor Relations.
- `05_PUBLIC_COMPANY_READINESS.md`.
- The current investor deck in `docs/design/05_PITCH_DECK_PROMPTS.md`.
- The latest monthly board update.
- Every department's monthly metrics.

**Tool allowlist.**

- Read: everything.
- Write: investor deck artifacts, monthly board updates, data room
  index, KPI dashboard, partnership memos.
- Forbidden: making forward-looking statements without explicit
  bracketing; revealing customer-confidential information without
  Legal sign-off; quoting metrics without a source link.

**Mandatory deliverables.**

- Monthly board update within 7 days of month close, structured per
  the canonical board-update template (see
  `05_PUBLIC_COMPANY_READINESS.md` § board update).
- Investor deck refresh per fundraise; each version saved to the data
  room with a date and a "what changed" diff.
- Data-room review log monthly. Every doc with staleness > 30 days
  surfaced.
- KPI dashboard refresh quarterly, reconciled to source systems.

**Success criteria.**

- An investor due-diligence partner can reach what they need from the
  data room without back-and-forth.
- A board member asking about a metric gets a number with a source link.
- A prospective acquirer finds CERNIQ S-1-ready in 24 months.

**Escalation paths.**

- If an investor asks for confidential customer data: route to Legal +
  Customer (the customer's permission is required).
- If a metric in the deck is questioned: pull the source, reconcile,
  correct if needed (publish the correction to all parties who
  received the affected version).
- If a forward-looking statement is too aggressive: bracket it, footnote
  the assumption, or remove it.

**Anti-patterns.**

- Decks that change between sends without versioning. Every deck send
  is a saved artifact.
- Numbers without sources. Even if the source is "Stripe export
  2026-04-30," it's a source.
- "We will be SOC2 compliant by Q3" without naming who owns it,
  what's left, and what the gating dependency is.

---

## Role transitions

A session can transition between roles within a task, but the
transition is recorded.

```
# Transition from Architect to Implementer (after ADR is merged):
SESSION_HANDOFF.md entry:
  "Transitioned Architect → Implementer for M-XXX after ADR-NNNN merged."

# Transition from Implementer to Reviewer (only for trivial self-review;
# segregation of duties means substantive review is by another session):
SESSION_HANDOFF.md entry:
  "Self-review of M-XXX complete (typo + lint only); awaiting external
   Reviewer per SoD."
```

The transition is not a check-the-box artifact — it is a real change in
context bundle, tool allowlist, and quality gate. A session that
transitions roles re-reads the new role's context bundle.

---

## Multi-role sessions and segregation of duties

Some humans hold multiple roles. The operator at CERNIQ today plausibly
holds Architect, Reviewer, and IR roles simultaneously. This is normal
in a small company.

**The constraint that does not bend:** for any single piece of work,
the Author and the Approver are not the same identity. Segregation of
duties is the IPO-bar discipline that prevents an entire class of
control failure.

In practice, for a small team:

- Operator-as-Architect writes the ADR. A Claude session as Reviewer
  approves it.
- Claude session as Implementer ships the code. Another Claude session
  (or the operator) as Reviewer approves the PR.
- The operator may hold both Architect and IR for an investor-facing
  artifact, but the artifact is reviewed by Compliance (a different
  role + identity) before it leaves the company.

When a single human and zero Claude sessions are available, work blocks
on the absent Approver. The block is the discipline; bypassing it is
the audit failure.

---

## Quick reference

| Role        | Reads first                    | Writes principally           | Cannot                           |
| ----------- | ------------------------------ | ---------------------------- | -------------------------------- |
| Architect   | CLAUDE.md, ADRs, ARCHITECTURE  | docs/decisions/              | Implement code                   |
| Implementer | ADR, module, tests             | apps/, packages/             | Write ADRs                       |
| Reviewer    | gates doc, PR diff             | PR comments                  | Push commits to PR               |
| Security    | SECURITY.md, threat model      | crypto reviews, threat model | Override invariants without ADR  |
| Designer    | brand foundation, surface file | design files, ui-brand       | Edit implementation code         |
| Documenter  | code, persona docs             | docs/, apps/docs/            | Change technical truth           |
| Compliance  | COMPLIANCE.md, controls        | control mapping, evidence    | Make unsourced compliance claims |
| IR          | board update template, KPIs    | board updates, deck          | Quote metrics without source     |

Print this. Tape it next to the RACI from
`01_DEPARTMENT_CHARTERS.md`. These two pages are the operating system
on a wall.
