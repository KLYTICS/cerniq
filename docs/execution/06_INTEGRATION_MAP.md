---
title: OKORO — Integration Map
audience: every contributor confused about which doc governs what
last-reviewed: 2026-05-08
status: source-of-truth — v1
---

# 06 — Integration Map

> The bridge document. Shows how the design library, the execution OS,
> CLAUDE.md, the WORK_BOARD, ADRs, and SESSION_HANDOFF intersect. Use
> this when you know what you're trying to do but don't know which doc
> to consult — or when you've consulted three docs and they seem to
> overlap.

---

## 1. The doc map

```
                        ┌─────────────────┐
                        │   CLAUDE.md     │   architectural invariants
                        │  (the contract) │   (supreme; override = ADR)
                        └────────┬────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
       ┌────────▼─────────┐  ┌───▼────────┐  ┌────▼──────────┐
       │  docs/SECURITY.md│  │ docs/      │  │ docs/spec/    │
       │  + threat model  │  │ ARCHITECTURE│  │ 01_MASTER     │
       │  (Security veto) │  │ (Eng owns)  │  │ (Product owns)│
       └────────┬─────────┘  └───┬─────────┘  └────┬──────────┘
                │                │                │
                └────────────────┼────────────────┘
                                 │
                        ┌────────▼────────────┐
                        │  docs/execution/    │
                        │  (this folder)      │
                        │  ─ 4-axis OS        │
                        │  ─ dept charters    │
                        │  ─ agent roles      │
                        │  ─ task lifecycle   │
                        │  ─ quality gates    │
                        │  ─ public-co bar    │
                        └────────┬────────────┘
                                 │
        ┌────────────────────────┼─────────────────────────┐
        │                        │                         │
┌───────▼───────────┐  ┌─────────▼──────────┐  ┌──────────▼────────┐
│  docs/design/     │  │  WORK_BOARD.md     │  │  docs/decisions/  │
│  ─ brand          │  │  ─ claim protocol  │  │  ─ ADRs           │
│  ─ surfaces       │  │  ─ status flips    │  │  ─ proposals/     │
│  (Design owns)    │  │  (all use)         │  │  (Architect uses) │
└───────────────────┘  └────────────────────┘  └───────────────────┘
                                 │
                        ┌────────▼─────────────┐
                        │ docs/SESSION_HANDOFF │
                        │ ─ delivery log       │
                        │ ─ context for next   │
                        │   session            │
                        └──────────────────────┘
```

The doc map is hierarchical. Higher docs supersede lower in conflicts.
The execution OS in this folder sits *below* CLAUDE.md and the
canonical specs (it cannot override invariants), and *above* the
day-to-day artifacts (it governs how they get produced).

---

## 2. Per-surface ownership matrix

Every product surface OKORO ships maps to a department owner, an
agent role typically performing the work, and the canonical doc(s)
that govern it.

| Surface | Department owner | Typical agent role | Governing docs |
|---|---|---|---|
| `apps/api` (verify path) | Engineering + Security | Architect → Implementer → Reviewer → Security | CLAUDE.md, SECURITY.md, ARCHITECTURE.md, ADRs |
| `apps/api` (audit chain) | Engineering + Security | Same as above + Compliance | CLAUDE.md, IMMUTABILITY.md, ADR-0005, ADR-0006 |
| `apps/api` (policy engine) | Engineering | Architect → Implementer → Reviewer | CLAUDE.md, ARCHITECTURE.md |
| `apps/api` (BATE) | Engineering + Product + Security | Architect → Implementer → Reviewer → Security | BATE_ALGORITHM.md, ARCHITECTURE.md |
| `apps/api` (billing/plans) | Engineering + Product + Finance | Architect → Implementer → Reviewer | spec/04_COMMERCIAL_STRATEGY.md, plans.ts |
| `apps/dashboard` | Engineering + Design | Designer + Implementer → Reviewer | docs/design/02_DASHBOARD_PROMPTS.md, brand foundation |
| `apps/marketing` | Design + GTM + Engineering | Designer → Implementer → Documenter → Reviewer (multi-role) | docs/design/01_MARKETING_SITE_PROMPTS.md, brand foundation |
| `apps/docs` | Engineering + Documenter + Design | Documenter → Designer → Implementer | docs/design/03_DOCS_SITE_PROMPTS.md, brand foundation |
| `packages/sdk-ts` | Engineering + Standards | Architect → Implementer → Reviewer → Security | CLAUDE.md, ARCHITECTURE.md, OpenAPI spec |
| `packages/sdk-py` | Engineering + Standards | Same as sdk-ts | Same as sdk-ts |
| `packages/types` | Engineering | Architect → Implementer → Reviewer | spec/OKORO_API_SPEC.yaml |
| `packages/ui-brand` | Design + Engineering | Designer → Implementer → Reviewer | docs/design/04_BRAND_IDENTITY_PROMPTS.md |
| `workers/cf-verify` | Engineering + Security | Architect → Implementer → Reviewer → Security | CLAUDE.md inv-2 (portable verify path) |
| Threat model | Security | Architect → Security | THREAT_MODEL_v2.md |
| Compliance posture | Compliance + Security | Compliance | COMPLIANCE.md, audit_2026q2/ |
| Pitch deck (investor) | IR + Operator | IR + Documenter + Designer | docs/design/05_PITCH_DECK_PROMPTS.md, public-co bar |
| Pitch deck (enterprise) | GTM + Customer Success | Documenter + Designer | docs/design/05_PITCH_DECK_PROMPTS.md |
| Customer integration runbook | Customer Success + Engineering | Documenter | docs/INTEGRATION_GUIDE_*.md |
| Monthly board update | IR + Operator | IR | execution/05_PUBLIC_COMPANY_READINESS.md § 8 |
| Customer contract | Legal + GTM | Legal | docs/legal/ (when canonicalized) |
| Privacy policy / ToS | Legal + Compliance | Legal + Documenter | docs/legal/ |
| Data room artifact | Per-source-doc owner | (varies) | execution/05 § 7 |
| Incident postmortem | Security + Engineering + Customer Success | Security + Documenter | INCIDENT_RESPONSE.md, INCIDENT_RUNBOOK.md |
| Material event log | IR + Compliance | IR | execution/05 § 6 |

---

## 3. Per-task gate routing

For any task, what gates apply (from `04_QUALITY_GATES.md`)?

| Task type | Code | Security | Design | Docs | Compliance | Narrative |
|---|---|---|---|---|---|---|
| Bug fix in apps/api | ● | ● | | ● | | ● |
| New crypto code | ● | ● | | ● | ● | ● |
| New denial reason | ● | ● | | ● | ● | ● |
| Audit chain change | ● | ● | | ● | ● | ● |
| Dashboard UI feature | ● | ● | ● | ● | | ● |
| Marketing page | | | ● | ● | ● | ● |
| Docs page (concept) | | | | ● | | ● |
| API ref update | | | | ● | | ● |
| Brand foundation change | | | ● | | | ● |
| Identity (logo) refresh | | | ● | | | ● |
| Pricing change (code) | ● | | | ● | ● | ● |
| Pricing change (page) | | | ● | ● | ● | ● |
| New customer contract | | | | | ● | ● |
| New sub-processor | | ● | | ● | ● | ● |
| Compliance claim | | ● | | ● | ● | ● |
| Investor deck | | | ● | ● | ● | ● |
| Board update | | | | ● | ● | ● |
| Threat model update | | ● | | ● | ● | ● |
| Incident postmortem | | ● | | ● | ● | ● |
| Customer-facing release note | ● | ● | | ● | ● | ● |
| Internal SESSION_HANDOFF entry | | | | | | ● |
| ADR (architectural) | | (if relevant) | | | | ● |
| ADR (security/audit) | | ● | | | ● | ● |

Use this table to size review rigor. A change that lights up Code +
Security + Design + Docs gates is a substantial review (1-3 hours);
a change that lights up only Code is a fast review (15-30 minutes).

---

## 4. Per-task agent role routing

For any task type, what agent roles touch it (in lifecycle order)?

| Task | Lifecycle (typical role chain) |
|---|---|
| Trivial bug fix | Implementer → Reviewer |
| Non-trivial bug fix | Implementer → Reviewer (+ Security if invariant-touching) |
| New feature, small | Architect → Implementer → Reviewer (+ Documenter if customer-facing) |
| New feature, architectural | Architect → (multiple) Implementers → Reviewer → Security → Compliance → Documenter → Reviewer-of-docs |
| Crypto change | Architect → Security → Implementer → Reviewer → Security (final approval) |
| Threat model update | Security (single role; Reviewer is Architect or Operator) |
| Marketing page | Documenter → Designer → Implementer → Reviewer (multi-role: Design + GTM + Compliance + IR if claim-bearing) |
| Docs page | Documenter → Reviewer (Documenter or Engineer) → Designer (visual only) |
| Brand foundation change | Designer (Architect for the visual decision) → Reviewer (Operator + Engineering) |
| Identity / logo | Designer (with external designer) → Operator approves → Implementer wires |
| Pricing change | Architect (decides) → Implementer (code) → Designer (page) → Documenter (announcement) → Compliance → IR → Reviewer chain |
| Customer onboarding | Customer Success (lead) → Documenter (runbook) → Engineer (technical support) |
| Monthly board update | IR (lead) → Compliance (review) → Operator (approves) |
| Incident | Security (lead, with Engineering) → Customer Success (comms) → Documenter (postmortem) → Operator (approves customer-facing) → Compliance (logs) |

The chain reads left-to-right in time. Each transition is recorded
(commits, PR comments, `SESSION_HANDOFF.md` entries).

---

## 5. Cross-doc cheatsheet — "I want to X, where do I look?"

| I want to… | Look here |
|---|---|
| Understand OKORO architectural invariants | `CLAUDE.md` |
| Understand OKORO visual identity | `docs/design/00_BRAND_FOUNDATION.md` |
| Find a claimable module | `WORK_BOARD.md` |
| Understand how to claim a module | `docs/SPRINT_PROTOCOL.md` |
| Know which department owns a piece of work | `docs/execution/01_DEPARTMENT_CHARTERS.md` |
| Know what role I'm filling on a task | `docs/execution/02_AGENT_ROLES.md` |
| Know what stage my task is in | `docs/execution/03_TASK_LIFECYCLE.md` |
| Know what gates my work must pass | `docs/execution/04_QUALITY_GATES.md` |
| Understand the IPO-bar discipline | `docs/execution/05_PUBLIC_COMPANY_READINESS.md` |
| Understand the threat model | `docs/THREAT_MODEL_v2.md` |
| Find the denial precedence | `docs/SECURITY.md` § Denial Precedence |
| Understand BATE | `docs/BATE_ALGORITHM.md` |
| Find canonical pricing | `apps/api/src/modules/billing/plans.ts` (code) + `docs/spec/04_COMMERCIAL_STRATEGY.md` (strategy) |
| Find prior architectural decisions | `docs/decisions/` |
| Find recent shipping activity | `docs/SESSION_HANDOFF.md` |
| Generate a marketing page prompt | `docs/design/01_MARKETING_SITE_PROMPTS.md` |
| Generate a dashboard page prompt | `docs/design/02_DASHBOARD_PROMPTS.md` |
| Generate a docs page prompt | `docs/design/03_DOCS_SITE_PROMPTS.md` |
| Generate identity work prompts | `docs/design/04_BRAND_IDENTITY_PROMPTS.md` |
| Generate a deck | `docs/design/05_PITCH_DECK_PROMPTS.md` |
| Read about a specific persona | `docs/personas/<persona>.md` |
| Find an integration guide | `docs/INTEGRATION_GUIDE_*.md` |
| Find a runbook for an operational task | `docs/RUNBOOK.md` or `docs/<TOPIC>_RUNBOOK.md` |
| Respond to an incident | `docs/INCIDENT_RUNBOOK.md` then `docs/INCIDENT_RESPONSE.md` |
| Hand off to the next session | append to `docs/SESSION_HANDOFF.md` |

---

## 6. The "I'm stuck — which doc?" decision tree

```
Is the question about an architectural decision or invariant?
├── YES → CLAUDE.md, then docs/decisions/, then docs/ARCHITECTURE.md
└── NO ↓

Is the question about how to claim, ship, or hand off work?
├── YES → docs/execution/03_TASK_LIFECYCLE.md, WORK_BOARD.md, SPRINT_PROTOCOL.md
└── NO ↓

Is the question about a visual or UX surface?
├── YES → docs/design/00_BRAND_FOUNDATION.md, then the surface-specific 01-05_*
└── NO ↓

Is the question about cryptographic or audit-chain correctness?
├── YES → docs/SECURITY.md, docs/IMMUTABILITY.md, threat model, the relevant ADR
└── NO ↓

Is the question about compliance, control mapping, or what we tell customers?
├── YES → docs/COMPLIANCE.md, docs/execution/05_PUBLIC_COMPANY_READINESS.md, docs/execution/04_QUALITY_GATES.md § Gate 5
└── NO ↓

Is the question about an investor or board artifact?
├── YES → docs/execution/05_PUBLIC_COMPANY_READINESS.md, docs/design/05_PITCH_DECK_PROMPTS.md
└── NO ↓

Is the question about a customer-facing artifact (release notes, integration guide, blog post)?
├── YES → docs/execution/04_QUALITY_GATES.md § Gate 4 + Gate 6, docs/design/00_BRAND_FOUNDATION.md § 2
└── NO ↓

Is the question about an existing implementation detail?
├── YES → read the code in apps/ or packages/, then check the relevant ADR
└── NO ↓

Default → docs/execution/00_OPERATING_SYSTEM.md, then ask via claude-peers msg or open an issue
```

---

## 7. The contributor's first-day path

A new contributor (or a freshly spawned Claude session) does this on
day 1, in this order. No exceptions.

```
1. Read CLAUDE.md end-to-end.                                     (45m)
2. Read docs/execution/00_OPERATING_SYSTEM.md.                    (20m)
3. Read docs/execution/01_DEPARTMENT_CHARTERS.md
   for your assigned department.                                  (15m)
4. Read docs/execution/02_AGENT_ROLES.md for your role.           (10m)
5. Skim docs/execution/03_TASK_LIFECYCLE.md.                      (15m)
6. Skim docs/execution/04_QUALITY_GATES.md for the gates that
   apply to your role.                                             (15m)
7. If your work is visual: read docs/design/00_BRAND_FOUNDATION.md. (30m)
8. Skim the last 10 entries in docs/SESSION_HANDOFF.md to
   understand current context.                                    (15m)
9. Skim WORK_BOARD.md to see open modules.                         (10m)

Total: ~3 hours. After that, claim a module and start.
```

This is structured onboarding. Skipping it costs the contributor and
the team more than the 3 hours saved — the cost shows up in their
first PR review when the gates and conventions are unfamiliar.

---

## 8. The doc-update social graph

When a doc changes, what other docs may need to follow?

```
CLAUDE.md changes
  → potentially every doc; mandatory cascade review by Operator + Security

docs/SECURITY.md changes
  → 04_QUALITY_GATES.md § Gate 2 review
  → docs/design/01_MARKETING_SITE_PROMPTS.md /security page review
  → customer notification per Compliance

ADR added/changed
  → docs/decisions/README.md index
  → if architectural: ARCHITECTURE.md potentially
  → if security: docs/SECURITY.md potentially
  → if data: schema.prisma potentially

docs/design/00_BRAND_FOUNDATION.md changes
  → 01-05_* prompt files review
  → packages/ui-brand review
  → apps/dashboard, apps/marketing, apps/docs review

docs/execution/01_DEPARTMENT_CHARTERS.md changes
  → potentially every contributor's role brief in 02_AGENT_ROLES.md
  → potentially the RACI table

WORK_BOARD.md module added
  → docs/SESSION_HANDOFF.md when claimed
  → potentially an ADR if non-trivial

apps/api/prisma/schema.prisma changes
  → packages/types may need regen
  → apps/dashboard, apps/marketing data loaders may need updates
  → docs/spec/OKORO_API_SPEC.yaml may need updates
  → migration file in apps/api/prisma/migrations/

apps/api/src/modules/billing/plans.ts changes
  → docs/spec/04_COMMERCIAL_STRATEGY.md narrative if substantive
  → cross-package parity test (the Round 23 pattern)
  → apps/dashboard /pricing fallback (if drift between prod and fallback)
  → marketing page pricing if claims change
  → /.well-known/pricing.json contract test
  → ADR if introducing a new tier or changing precedence
```

When in doubt, run a doc-impact grep before merge:

```bash
# Example: after editing CLAUDE.md, check what references the changed section
grep -r "CLAUDE.md" docs/ apps/ packages/ --include="*.md" --include="*.ts"
```

---

## 9. The single-page summary (for the wall)

```
WHO  →  Departments, with charters in 01_DEPARTMENT_CHARTERS.md
        Roles, with briefs in 02_AGENT_ROLES.md

WHAT →  CLAUDE.md = invariants
        docs/spec/01_MASTER.md = product positioning
        docs/design/00_BRAND_FOUNDATION.md = visual contract
        docs/SECURITY.md = security contract
        docs/COMPLIANCE.md = control mapping

HOW  →  03_TASK_LIFECYCLE.md (8 stages)
        04_QUALITY_GATES.md (6 gates)
        SPRINT_PROTOCOL.md (parallel sessions)
        WORK_BOARD.md (claim protocol)
        SESSION_HANDOFF.md (delivery log)

WHY  →  00_OPERATING_SYSTEM.md (the thesis)
        05_PUBLIC_COMPANY_READINESS.md (the bar)

WHEN →  Daily: claim → ship → handoff
        Weekly: round summary
        Monthly: board update, materiality review, data-room review
        Quarterly: pre-audit dry run, persona refresh, comp benchmark
        Annual: institutional-readiness gap analysis
```

This map fits on a single sheet of paper. Print it. Tape it to the
wall next to the RACI from `01_DEPARTMENT_CHARTERS.md` and the role
quick-reference from `02_AGENT_ROLES.md`.

Three pages. The whole company on three pages. That is the goal.
