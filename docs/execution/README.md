---
title: AEGIS — Execution Operating System
audience: every contributor — operator, staff engineer, contractor, every Claude session, every future hire
last-reviewed: 2026-05-08
status: source-of-truth
---

# AEGIS Execution Operating System

The institutional contract that turns parallel work into a public-company-
grade business. Layered on top of `CLAUDE.md` (architectural invariants),
`WORK_BOARD.md` (claim protocol), `docs/SPRINT_PROTOCOL.md` (parallel-
session discipline), `docs/SESSION_HANDOFF.md` (delivery log), and
`docs/design/` (visual contract).

## What this folder is for

AEGIS is being built today as if it will be a publicly traded company in
24-36 months. Every contributor — human or AI agent — ships work that must
clear a bar set in three places at once:

1. **Now.** Code compiles, tests pass, the customer can integrate.
2. **At Series A diligence.** Every architectural decision has an ADR,
   every change has an audit trail, every claim has a source.
3. **At S-1 / IPO readiness.** Disclosure controls work, segregation of
   duties holds, MD&A-quality writing is the house style, the data room
   is perpetually current — not assembled the week before.

This folder is the operating system for clearing all three bars at once,
without slowing down. It does not replace the existing protocols — it
binds them into a single execution model.

## The 4 axes

Every piece of work at AEGIS is described by four coordinates:

```
DEPARTMENT      ×    AGENT ROLE     ×    TASK STAGE       ×    QUALITY GATE
(who owns it)        (who does it)       (where it is)         (when it ships)
```

- **Department** — the functional area accountable for the outcome
  (Engineering, Product, Design, Security, Compliance, GTM, Customer
  Success, Finance, Legal, People, Investor Relations, Standards).
- **Agent** — the role of the contributor doing the work in this slice
  (Architect, Implementer, Reviewer, Security, Designer, Documenter,
  Compliance, IR). Both human and Claude sessions occupy these roles;
  the role is what matters, not the medium.
- **Task stage** — where the work is in its lifecycle (Intake → Discovery
  → Thinking → Planning → Implementing → Reviewing → Shipping → Postmortem).
- **Quality gate** — what bar the deliverable clears at this stage
  (Code, Security, Design, Documentation, Compliance, Investor-grade
  narrative). Different stages clear different gates.

The ergonomics:

- A single sentence describes any unit of work: *"Engineering, Implementer,
  Implementing-stage, Code+Security gates."*
- A reviewer asking "did we do this right?" can check each axis
  independently and arrive at a yes/no without judgment calls.
- A new contributor onboarding doesn't need to learn the whole company —
  they need to learn their department's charter, their assigned role's
  brief, and the lifecycle stages they touch.

## Files in this folder

| File | What it does | Read when… |
|---|---|---|
| `00_OPERATING_SYSTEM.md` | The master doc. The thesis, the 4 axes, how the design library plugs in, the contract. | Onboarding. |
| `01_DEPARTMENT_CHARTERS.md` | One charter per department. Mission, scope, out-of-scope, RACI, quality bar, owned docs, handoffs. | Joining or staffing a department. |
| `02_AGENT_ROLES.md` | Per-agent role briefs (Architect, Implementer, Reviewer, etc.). Context bundle, tool allowlist, handoff points, success criteria, escalation. | Claiming a module on `WORK_BOARD.md` or starting a new Claude session. |
| `03_TASK_LIFECYCLE.md` | The 8-stage scaffolded thinking → planning → implementing → review → ship → postmortem flow. Required artifacts, sign-offs, time budgets. | Starting any task. |
| `04_QUALITY_GATES.md` | The FAANG/IPO bar. Code, security, design, docs, compliance, investor-grade. Acceptance criteria + how to check each. | Before requesting review and before merging. |
| `05_PUBLIC_COMPANY_READINESS.md` | What the IPO bar changes today: disclosure controls, segregation of duties, change management, MD&A writing, materiality, data room. | When making any decision that creates a permanent record. |
| `06_INTEGRATION_MAP.md` | The bridge — how the design library, CLAUDE.md, WORK_BOARD, ADRs, SESSION_HANDOFF, and the OS docs intersect. Ownership matrix per surface. | When confused about which doc governs what. |

## Read order (first time)

1. `CLAUDE.md` — the architectural contract.
2. `docs/execution/00_OPERATING_SYSTEM.md` — the thesis.
3. `docs/execution/03_TASK_LIFECYCLE.md` — the universal flow you'll
   touch most often.
4. `docs/execution/02_AGENT_ROLES.md` § the role you're filling now.
5. `docs/execution/01_DEPARTMENT_CHARTERS.md` § your department.
6. `docs/execution/04_QUALITY_GATES.md` — what your work must clear.
7. `docs/execution/05_PUBLIC_COMPANY_READINESS.md` — at least skim;
   it will change how you write commit messages and ADRs.
8. `docs/execution/06_INTEGRATION_MAP.md` — reference, not narrative.

If you only have 30 minutes, read 00, 03, and the row in 01 for your
department.

## When this OS contradicts another doc

The hierarchy:

1. `CLAUDE.md` (architectural invariants) — supreme.
2. `docs/SECURITY.md` (security invariants like denial precedence) —
   binding, override-requires-ADR.
3. This OS folder — binding for execution discipline.
4. `docs/design/00_BRAND_FOUNDATION.md` — binding for visual surfaces.
5. Surface-specific docs (`docs/design/01_*` etc., `docs/spec/*`) —
   binding within their scope.
6. Sprint-specific protocols — binding for the active sprint.

If a higher-priority doc contradicts a lower one, fix the lower one
and propagate. If you find a contradiction between docs of equal
priority, that's an ADR.

## How this folder updates

This is a **living contract.** Charters and role briefs change as the
business changes. But it changes through the same process anything else
does:

- Trivial fix (typo, link, formatting): direct edit, note in
  `SESSION_HANDOFF.md`, no review required.
- Substantive change (charter scope, role responsibilities, quality bar):
  ADR in `docs/decisions/`, review by the affected department's owner,
  then merge. The ADR title pattern: `ADR-NNNN: change to OS § <section>`.
- Lifecycle-stage change (new gate, new artifact required): ADR plus a
  short migration note explaining what in-flight work needs to be brought
  to the new bar.

The OS is versioned at the file level. The README is **v1**.
