---
title: OKORO — Public-Company Readiness
audience: every contributor; the operator most of all
last-reviewed: 2026-05-08
status: source-of-truth — v1
---

# 05 — Public-Company Readiness

> The disciplines that take OKORO from "well-run private company" to
> "S-1-ready private company." Adopt the institutional muscle that
> compounds today; defer the disciplines that only make sense with a
> reporting cadence we don't yet have.
>
> This is not aspirational. The patterns here are how OKORO operates
> *now*, not how it will operate someday. The gap between current
> practice and this document is a gap to close in this quarter.

---

## 1. Thesis

A company that becomes publicly traded in 24-36 months will be audited
on the operating model it had in the years before. The S-1 reviewer
asks not "are you SOX-compliant *now*?" but "show us the change
management trail from two years ago." The institutional disciplines
must therefore be installed *before* they are required, on the
schedule of compounding return — not on the schedule of regulatory
deadline.

The disciplines that compound:

1. **Disclosure controls** — every public claim is sourced and
   defensible.
2. **Segregation of duties** — Author and Approver are different
   identities for every change.
3. **Change management** — every production change is traceable from
   ticket through review through deploy through audit event.
4. **Forward-looking statement discipline** — speculation is bracketed,
   defaults are historical/factual.
5. **Materiality framework** — what rises to disclosure has a
   consistent rubric.
6. **Perpetually-current data room** — the artifacts a buyer or
   investor would need are current today, not assembled at the
   eleventh hour.
7. **Board-quality artifact discipline** — every monthly report could
   be a board pack with light editing.
8. **MD&A-quality writing** — sober, footnoted, defensible voice
   becomes the house default.

The disciplines that **don't** compound and shouldn't be retrofitted
prematurely:

- Quarterly earnings guidance (no public revenue at this stage).
- Formal earnings call (premature).
- Investor day theatrics.
- Annual report production overhead.

The principle: install the *muscle* (sourcing, change management,
segregation of duties, materiality discipline, MD&A voice) without
installing the *cadence* (quarterly guidance, earnings call) until
the cadence creates value.

---

## 2. Disclosure controls

### 2.1 The rule

Every public claim OKORO makes — about latency, scale, customers,
compliance status, financial position, capability, roadmap — is:

1. **Sourced.** A specific artifact (CI run, Stripe export, customer
   contract, regulatory letter) backs the claim.
2. **Approved.** The relevant department (per
   `01_DEPARTMENT_CHARTERS.md`) has approved the claim before
   publication.
3. **Versioned.** The artifact in which the claim ships is saved with
   a date and a version. Subsequent corrections are published as
   corrections, not silent re-edits.

### 2.2 What counts as "public"

- Marketing site content.
- Docs site content.
- Sales decks (any deck that leaves the company).
- Investor decks and updates.
- Customer contracts (the claims in the contract).
- Public benchmarks, blog posts, conference talks, podcast appearances.
- Analyst briefings.
- Job postings (yes — claims about technology stack, scale, customer
  count in JDs are subject to the same discipline).
- GitHub READMEs in public repos.

### 2.3 The control

- For Eng / Security / Compliance / Finance claims: sourced via the
  owning department.
- For aggregate claims that span departments (e.g. "verifies per
  month"): the source is reconciled across the owning departments
  before publication.
- A claim with no source is removed before the artifact ships. This
  is non-negotiable; "we always say something like this" is not a
  source.

### 2.4 Drift detection

A monthly review by IR pulls every published claim from the last 30
days, walks the source, confirms the source still supports the claim.
Drift is logged and corrected in the next publication cycle.

---

## 3. Segregation of duties

### 3.1 The rule

For any single piece of work, the Author and the Approver are
different identities.

### 3.2 What counts as "different identity"

- Two different humans.
- A human and a Claude session.
- Two different Claude sessions (different `sid`s).

What does **not** count:

- The same human approving their own work.
- A Claude session approving a PR opened by the same Claude session.
- The operator approving the operator's own work (this is the most
  common temptation in a small company; the SoD discipline is
  precisely to resist it).

### 3.3 What this protects

A single class of failure that is responsible for a disproportionate
share of public-company audit findings: the silent introduction of
a control gap by the very person tasked with maintaining the control.
Forcing a second pair of eyes is the cheapest insurance against this
class of failure.

### 3.4 Solo-founder edge cases

When the operator is the only available human and no Claude session
is suitable as a Reviewer, the work blocks pending an available
Reviewer. The block is the discipline. Bypassing it is the audit
failure.

In practice for OKORO today: spawn a Claude session as Reviewer for
operator-authored substantive PRs. Confirmation of the SoD discipline
goes in `SESSION_HANDOFF.md`:

```
2026-05-09 (Round 24) · sid=<sid> as Reviewer · operator was Author
PR <link> approved against gates 1, 2, 4 of 04_QUALITY_GATES.md.
```

### 3.5 Production access

Production-environment access (the systems that run customer-affecting
infrastructure) is segregated from development access. The operator
holds production access today; SoD applies to it the same way:
production change → ticket → reviewed PR → deploy → audit. No
direct-to-prod edits.

---

## 4. Change management

### 4.1 The rule

Every production change is traceable from intent to deploy to audit
event.

### 4.2 The trail

```
INTENT     →  WORK_BOARD.md claim or GitHub issue
PLAN       →  ADR (if architectural) + linked plan in the issue
BUILD      →  PR with ADR reference + commit messages with OS-axis footer
REVIEW     →  PR approval by a different identity, gate-by-gate confirmation
DEPLOY     →  Tagged release, deploy log entry, monitoring confirmation
AUDIT      →  SESSION_HANDOFF.md entry, postmortem (for non-trivial)
```

Each step is durable and traceable. A reviewer six months from now can
walk the trail in either direction: from a deployed change back to the
intent, or from a stated intent forward to the resulting deploy.

### 4.3 Emergency overrides

Emergencies are real. The operator may need to ship a P0 fix without
the full trail. The override is permitted — and **immediately
followed** by:

1. The ticket created within 4 hours of the deploy.
2. The retroactive PR opened within 8 hours (preserving the diff).
3. A short postmortem in `docs/postmortems/` within 48 hours
   describing why the emergency justified the override.
4. An ADR if the override revealed a gap in the standard process.

Emergency overrides are tracked. More than 1 per month is a signal
that the standard process is too slow; that signal triggers an OS
review.

---

## 5. Forward-looking statement discipline

### 5.1 The rule

Default tone is historical or factual ("OKORO verifies in <80ms p99
over the last 30 days," "Our test suite passes with zero typecheck
errors as of round 23"). Speculation about future capability,
pricing, customer outcomes, or roadmap timing is **explicitly
bracketed**.

### 5.2 The brackets

Acceptable bracket forms:

- *"We expect to ship X by Q3 2026, subject to engineering capacity
  and customer feedback."*
- *"Pricing tiers may evolve as we learn from initial deployments."*
- *"Internal projection: at $0.002/verify and 10B daily verifications,
  $20M/day run rate. This is illustrative; actual outcomes depend on
  market adoption."*
- *"Our roadmap as of [date] includes [items]; the roadmap is reviewed
  monthly and may change."*

Unacceptable forms:

- "We will be SOC2 compliant by Q3." (Implied guarantee.)
- "Customers will save 80% on integration time." (No basis cited.)
- "OKORO is the dominant verification layer." (Speculative; remove.)

### 5.3 Why this matters

In a private company today, a misleading forward-looking statement is
a customer complaint. In a public company, it is a securities
violation. The discipline of bracketing is hard to retrofit; install
it now, in every artifact, until it becomes the default voice.

### 5.4 The exception that proves the rule

Internal artifacts can speculate freely — strategy docs, brainstorms,
scenario plans. These are clearly labeled "Internal — speculative."
The moment they become candidates for external publication, the
brackets go in.

---

## 6. Materiality framework

### 6.1 The rule

Information about OKORO is "material" if a reasonable customer,
investor, employee, or regulator would consider it important to a
decision they are making. Material information is treated with
disclosure-bar discipline; non-material information is treated with
ordinary-care discipline.

### 6.2 The rubric

A piece of information is **material** if any of the following are
true:

- It affects an existing customer's contractual rights or risks.
- It affects an existing customer's security posture (e.g. a
  vulnerability).
- It affects financial reporting (revenue, burn, runway by >5%).
- It changes a public claim OKORO has made (compliance status,
  performance, capability).
- It affects fundraising (term-altering events, lead-investor change).
- It triggers a regulatory reporting obligation (data breach,
  AI-act-categorized incident).
- It is a hire / departure of someone in a covered role (operator,
  founders, named customer-facing leads).

A piece of information is **non-material** if it is none of those
things. Non-material does not mean unimportant — it means "ordinary
care, not disclosure-bar care."

### 6.3 What changes with material information

- It is captured in writing within 24 hours of being known.
- It is shared with the parties it affects within the contractually
  required window (or 7 days if no contractual window applies).
- It is logged in the data room (`docs/data_room/material_events/`
  when canonicalized).
- It is referenced in the next monthly board update.
- For investor-facing material events: the response is coordinated
  via IR, with Legal review.

### 6.4 The control

A monthly materiality review (driven by IR) walks the prior 30 days
of significant events and confirms the material ones were captured
and surfaced. Missed material events are themselves logged and
postmortem'd.

---

## 7. The data room

### 7.1 The rule

The data room is perpetually current. Every artifact a Series A
diligence partner or S-1 reviewer would request can be served today,
without revision.

### 7.2 The shape

```
docs/data_room/
├── README.md                  — index and access policy
├── corporate/
│   ├── formation_documents/
│   ├── cap_table_current.pdf
│   ├── cap_table_history/
│   ├── stockholder_agreements/
│   └── board_minutes/
├── financial/
│   ├── monthly_close/         — by month
│   ├── revenue_recognition_policy.md
│   ├── budget_actual_current.xlsx
│   └── tax_filings/
├── customers/
│   ├── customer_list_active.md  — anonymized for general access
│   ├── customer_contracts/      — restricted
│   ├── churn_analysis_current.md
│   └── case_studies/
├── product/
│   ├── architecture_current.md  — symlink to docs/ARCHITECTURE.md
│   ├── roadmap_current.md
│   ├── ip_inventory/
│   └── open_source_audit.md
├── security/
│   ├── threat_model_current.md  — symlink to docs/THREAT_MODEL_v2.md
│   ├── pen_test_results/
│   ├── vulnerability_disclosures/
│   └── incident_log_redacted.md
├── compliance/
│   ├── soc2_status.md           — symlink to relevant chapter
│   ├── soc2_evidence/           — restricted
│   ├── dpas_signed/
│   └── sub_processors_current.md
├── legal/
│   ├── tos_current.md
│   ├── privacy_policy_current.md
│   ├── contracts_template/
│   ├── ip_assignments/
│   └── trademark_filings/
├── people/
│   ├── employee_list_current.md
│   ├── equity_grants_current.md
│   ├── employment_agreements/
│   └── contractor_agreements/
├── investor/
│   ├── deck_current.pdf
│   ├── deck_history/
│   ├── board_updates/           — monthly
│   ├── kpi_dashboard_current.md
│   └── strategic_partner_memos/
└── material_events/
    └── (chronological log)
```

The "_current" suffix is the conceptual handle. In practice these are
symlinks or canonical references to the source-of-truth document
maintained in the relevant department.

### 7.3 Access

- Public access: README and customer-list (anonymized).
- Investor access: investor/, strategic partner memos.
- Acquirer access: full data room under NDA.
- OKORO contributor access: everything except customer-restricted
  contracts.

### 7.4 Maintenance

- Monthly: IR-led data-room review. Every doc with staleness > 30
  days is surfaced and re-owned.
- Per-shipped-feature: the artifact updates in product/ and security/.
- Per-month-close: the artifact updates in financial/.
- Per-monthly board update: the artifact lands in investor/board_updates/.

### 7.5 The discipline

The data room is the most visible artifact of public-company readiness.
A buyer arriving with a 200-item due-diligence checklist gets through
it in days, not months, because the answers are pre-staged. A Series A
investor signing a term sheet on Friday gets confirmation the
following Wednesday because the data room is ready.

This is achievable today — at OKORO's current scale — at low cost.
Achieving it at the scale of "company that just signed its 200th
customer" is much harder. Install the muscle now.

---

## 8. Board-quality artifact discipline

### 8.1 The rule

Every monthly artifact intended for the operator and (eventual) board
is written at board-quality from the first version. No "rough draft"
that gets polished for the board view; the working artifact is the
board view.

### 8.2 What "board-quality" means

- Sourced — every number cites its source.
- Sober — no marketing voice, no hype, no defensiveness.
- Comprehensive — covers wins, losses, blockers, asks, plan vs actual.
- Forward-looking with brackets — speculation is bracketed.
- Action-oriented — the artifact ends with what the operator and
  (eventual) board are being asked to do, decide, or know.
- Reproducible — the artifact at version N is preserved; version N+1
  diffs against it.

### 8.3 The monthly board update template

```
# Operator & Board Update — <Month YYYY>

## Headline (one paragraph)

The most important fact of the month, with source.

## Numbers

| Metric | Value | Source | M/M | Y/Y |
|---|---|---|---|---|
| Verifies / month | <n> | <source> | <Δ> | <Δ> |
| Active customers | <n> | <source> | <Δ> | <Δ>  |
| ARR (run-rate) | $<n> | <source> | <Δ> | <Δ> |
| Burn (net) | $<n> | <source> | <Δ> | <Δ> |
| Runway (months) | <n> | <derived> | <Δ> | <Δ> |
| Headcount | <n> | <source> | <Δ> | <Δ> |
| p99 verify latency | <n>ms | <source> | <Δ> | <Δ> |
| Audit chain integrity | green/amber/red | <source> | — | — |
| SOC2 status | <status> | <source> | — | — |
| Open P0 incidents | <n> | <source> | — | — |

(Each ↑/↓ is shown with sign and percent. Each row's "source" is a
clickable link in the digital version.)

## What we shipped

Bulleted list of features merged. Each line links to the ADR or PR.

## What we did not ship (and why)

Bulleted list. Honest.

## Material events

Anything from § 6.2 that occurred. Each item with date.

## Asks

Specific decisions the operator (or board, when applicable) is being
asked to make. Each ask has: what, why, options, recommended option,
deadline.

## Speculative outlook (bracketed)

Forward-looking commentary, explicitly labeled.

## Appendices

Detailed metric drill-downs, customer-by-customer health, etc.
```

### 8.4 Cadence

- 7 days after month close: monthly update goes out.
- Quarterly: a more substantial review with year-to-date and
  forward 12-month framing.
- Annually: a "state of OKORO" comprehensive update.

---

## 9. MD&A-quality writing

### 9.1 The rule

The voice of every artifact that could plausibly be read by a
regulator, investor, or auditor is the voice of an SEC filing's
"Management's Discussion and Analysis" section: sober, sourced,
defensive about claims, forthright about risks.

### 9.2 Voice characteristics

- **Footnoted.** Every numerical or factual claim has a citation.
- **Risk-acknowledging.** When describing a strength, the
  countervailing risk is also named.
- **Comparative.** Period-over-period and year-over-year framing,
  not point-in-time.
- **Plain.** No jargon when a plain word works. No marketing
  superlatives.
- **Honest.** When something underperformed expectations, the
  artifact says so.

### 9.3 Two examples

**Marketing voice (acceptable for marketing surface, not for board):**

> OKORO delivers blazing-fast verification with industry-leading
> security. Every agent transaction is sealed in our tamper-proof
> audit chain.

**MD&A voice (the bar for board / investor / regulator artifacts):**

> OKORO verified [X] agent actions in April 2026 with a p99 latency
> of 71ms (Datadog, dashboard <link>). The audit chain remained
> hash-chain-intact across all events (see audit-chain integrity
> test, run [link]). Latency has held within ±5% of target over the
> last six months; we expect this to remain stable through the
> Cloudflare-Workers edge migration in Q2, though we have not yet
> validated edge-region-specific latency under production load.

### 9.4 Where each voice belongs

| Surface | Voice |
|---|---|
| Marketing site | Marketing voice (still: precise, sourced, no superlatives) |
| Docs site | Documentation voice — terse, imperative, exact |
| Customer email | Marketing voice (when announcing); MD&A voice (when reporting) |
| Sales deck | Marketing voice with MD&A-grade backing in appendix |
| Investor deck | MD&A voice |
| Monthly board update | MD&A voice |
| ADR | Engineering voice — terse, complete, alternatives-aware |
| Customer postmortem | MD&A voice |
| Internal Slack | Whatever voice you like (no gate) |

---

## 10. The implementation gap

### 10.1 Where OKORO is today

- Sourcing: strong on engineering metrics (CI tracks them); weak on
  customer claims and pricing claims (drift risk).
- Segregation of duties: in flight. Round 23 of `SESSION_HANDOFF.md`
  shows the operator + Claude-session-as-Reviewer pattern in active
  use; this is the pattern to formalize.
- Change management: strong on the engineering trail (claims,
  PRs, audit events); weak on the production-deploy trail
  (`docs/RELEASE_PROCESS.md` is canonical but not always observed
  for trivial deploys).
- Forward-looking discipline: weak. Several docs make implied
  guarantees that should be bracketed.
- Materiality: not yet formally instantiated. No materiality log
  exists.
- Data room: distributed across `docs/`. Not yet a single
  canonical index.
- Board-quality artifacts: monthly update is informal and ad hoc.
- MD&A voice: present in some surfaces (`docs/SECURITY.md`,
  audit_2026q2/) and absent in others (some of `docs/spec/`).

### 10.2 The 90-day plan to close the gap

- **Days 1-7:** Establish the data-room directory structure under
  `docs/data_room/` with symlinks to existing canonical docs.
  Identify gaps. (Owner: IR role; one operator session.)
- **Days 8-21:** Run a sourcing audit on every customer-facing
  claim across marketing, docs, and the existing pitch deck. Add
  source links or bracket appropriately. (Owner: GTM + IR.)
- **Days 22-35:** Formalize the monthly board update template; ship
  the first proper version for the prior month. (Owner: IR.)
- **Days 36-49:** Establish the materiality log. Backfill the prior
  90 days where applicable. (Owner: IR + Compliance.)
- **Days 50-63:** Run an MD&A-voice audit on every doc in the data
  room. Rewrite the worst-offender 20% to MD&A standard. (Owner:
  Documenter + IR.)
- **Days 64-77:** Codify the SoD pattern (operator + Claude-session-
  as-Reviewer) in a clear ADR. Make it the default for every
  substantive PR. (Owner: Architect.)
- **Days 78-90:** Run a tabletop exercise: simulate a Series A
  diligence request. Find what's missing or stale. Fix what's
  fixable. Plan what's not. (Owner: Operator + IR.)

This is real work, not paper. It is also work that compounds: every
month past day 90, the data room and the disciplines stay current
through the regular monthly cadence, and the gap closes asymptotically.

---

## 11. Why bother now

The most common objection to this document: "we're too small for
this." The response: companies that scale past 50 employees without
this discipline pay an order of magnitude more to retrofit it than
to install it. The retrofit project is the one that delays Series A,
that fails an acquirer's diligence, that becomes the IPO-blocking
project the year before listing.

The discipline installed at OKORO's current scale costs maybe 10% of
contributor time. Installed at 50 employees, the same discipline
costs a $500k retrofit project. Installed under acquisition pressure
or under SEC scrutiny, the cost is incalculable.

This OS chapter is the cheapest insurance the company can buy. The
premium is paying attention.

---

## Related documents

- `00_OPERATING_SYSTEM.md` — the master.
- `04_QUALITY_GATES.md` § Gate 5 (Compliance) and Gate 6 (Narrative)
  are the per-artifact instantiation of these disciplines.
- `01_DEPARTMENT_CHARTERS.md` § IR — the role that owns most of this.
- `docs/COMPLIANCE.md` — the customer-facing compliance posture.
- `docs/RELEASE_PROCESS.md` — the change-management trail in detail.
- `CLAUDE.md` — the architectural invariants this layer presumes.
