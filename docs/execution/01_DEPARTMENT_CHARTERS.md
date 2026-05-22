---
title: OKORO — Department Charters
audience: every contributor; mandatory reading for the row of your assigned department
last-reviewed: 2026-05-08
status: source-of-truth — v1
---

# 01 — Department Charters

> Every department at OKORO is small or notional today. The charter is
> sized to the company we are building, not to today's headcount. A
> department of one is still a department; the contributor in that role
> represents the entire function and writes its artifacts at the bar
> the function will be held to at scale.

Each charter has the same shape:

- **Mission** — one sentence, what this department exists to do.
- **In scope** — the artifacts and outcomes this department owns.
- **Out of scope** — what this department does not own (often the
  hardest line to draw).
- **RACI for cross-department work** — Responsible / Accountable /
  Consulted / Informed defaults for the work that crosses lines.
- **Quality bar** — the specific bar this department's outputs clear.
- **Owned documents** — files in the repo where this department holds
  the pen.
- **Hand-offs** — who they receive from and hand to.
- **Cadence** — what they produce on a recurring basis.

---

## 1. Engineering

**Mission.** Ship the code that runs the verification layer.

**In scope.**
- `apps/api` — the NestJS origin, the verify path, the audit module,
  the policy engine, BATE.
- `apps/dashboard` — the Next.js developer dashboard.
- `apps/marketing` — the Next.js marketing site.
- `apps/docs` — the Nextra docs site.
- `packages/sdk-ts`, `packages/sdk-py`, `packages/types`,
  `packages/ui-brand`, `packages/eslint-config`, `packages/tsconfig`.
- `workers/cf-verify` — the Cloudflare Workers edge.
- The CLI (`packages/cli` when shipped).
- Database schema (`apps/api/prisma/schema.prisma`) and migrations.
- CI/CD pipelines, build scripts, test infrastructure.
- Observability instrumentation.

**Out of scope.**
- Customer-success motion (Customer Success owns).
- Pricing decisions (Product + Finance own; Engineering implements).
- Threat-model authorship (Security owns; Engineering implements
  controls).
- Marketing copy (GTM owns; Engineering implements the layout).
- Investor-facing technical narrative (IR owns; Engineering supplies
  source numbers).

**RACI for cross-department work.**

| Work | R | A | C | I |
|---|---|---|---|---|
| API contract change | Engineering | Engineering | Product, Security, GTM | Customer Success, Compliance |
| Pricing tier code change | Engineering | Product | Finance, GTM | IR, Compliance |
| Audit log schema change | Engineering | Security | Compliance, Engineering | All |
| Public SDK breaking change | Engineering | Engineering | Product, GTM, Standards | All |
| Performance regression > 20% | Engineering | Engineering | Product | All |

**Quality bar.**
- Every public service method has a unit test or `// untestable: <reason>`.
- `noUncheckedIndexedAccess` on at the base; never softened outside the
  API workspace.
- No `any` without `// type-rationale: <reason>`.
- Cryptographic code has a paired `.spec.ts`. No exceptions.
- Errors are typed (`OkoroError` subclasses), not strings.
- No `Math.random` in production code paths (allowed in tests/seeds only).
- Lighthouse ≥95 (≥98 for docs) on every public-web surface.
- A typecheck-zero round (a sprint round with zero typecheck errors
  across `apps/api`, `apps/dashboard`, packages) is the steady state,
  not a milestone. Round 23 was the 9th consecutive zero-error round;
  this is the bar.

**Owned documents.**
- `CLAUDE.md` § stack reality, file layout, quality bar (co-owned with
  the operator).
- `docs/ARCHITECTURE.md`.
- `docs/SPEC.md`.
- `docs/TESTING_STRATEGY.md`.
- `docs/SCALING_PLAYBOOK.md`.
- `docs/MONITORING_OBSERVABILITY.md`.
- `docs/spec/03_TECHNICAL_SPEC.md`.
- All ADRs touching code (most of `docs/decisions/`).
- The Prisma schema as a contract.

**Hand-offs.**
- Receives from: Product (specs), Design (UI specs), Security (threat
  model + controls), Compliance (control mappings).
- Hands to: Customer Success (release notes, integration guides), GTM
  (technical deck slides, public benchmarks), IR (latency / scale
  numbers for board updates).

**Cadence.**
- Daily: `WORK_BOARD.md` claim/release activity + `SESSION_HANDOFF.md`
  entries.
- Weekly: round summary in `SESSION_HANDOFF.md` (a "round" is the
  OKORO sprint unit; see Round 23 entry for the canonical shape).
- Per-shipped-feature: ADR if architectural; release notes; postmortem
  within 14 days.
- Monthly: an engineering metrics roll-up (typecheck-zero streak, lead
  time, review coverage, parity-test count) into the operator update.

---

## 2. Product

**Mission.** Decide what to build, in what order, for which customer
problem.

**In scope.**
- Roadmap (the canonical 6/12-month view).
- Persona definitions and ICP.
- Feature specs (the "what" and "why," not the "how").
- Pricing tier definition (working with Finance and Compliance).
- Customer interviews and synthesis.
- Win/loss analysis.
- Beta program design and gating decisions.

**Out of scope.**
- Technical implementation choices (Engineering owns).
- Threat modeling (Security owns; Product specs feed inputs).
- Customer support and renewal motion (Customer Success owns).
- Investor narrative (IR owns; Product supplies the roadmap and the
  persona evidence).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| Roadmap quarterly refresh | Product | Operator | All | All |
| New tier definition | Product | Product | Finance, GTM, Engineering, Legal | All |
| Persona update | Product | Product | GTM, Customer Success, Design | All |
| Beta inclusion criteria | Product | Product | Customer Success, Compliance | All |
| Sunset of a feature | Product | Operator | Engineering, Customer Success, Legal | All |

**Quality bar.**
- Every spec has: customer problem, success metric, alternative-rejected
  list, dependency map, and a "what we are not doing" section. Specs
  without these are returned to the author.
- Roadmap items are tied to a measurable outcome, never to "ship X."
- Customer-interview notes are stored verbatim and tagged; synthesis
  documents are separate from raw notes.
- No roadmap promises in customer-facing artifacts without IR review.

**Owned documents.**
- `docs/spec/02_GTM_ADOPTION.md` (co-owned with GTM).
- `docs/personas/*.md` (co-owned with Design and Customer Success).
- `docs/spec/BACKLOG.md`.
- A roadmap doc (when canonicalized — currently distributed across
  `docs/spec/05_STANDARDS_ROADMAP.md` and `WORK_BOARD.md`).
- `docs/PARTNER_ONBOARDING.md` (co-owned with GTM).

**Hand-offs.**
- Receives from: Customer Success (customer signal), GTM (market signal),
  Engineering (feasibility).
- Hands to: Engineering (specs), Design (UX intent), GTM (positioning
  guidance), IR (roadmap + persona evidence).

**Cadence.**
- Weekly: customer-interview note dump + synthesis update.
- Monthly: roadmap review, ICP refresh.
- Quarterly: persona refresh, win/loss analysis.

---

## 3. Design

**Mission.** Make every OKORO surface — marketing, dashboard, docs,
identity, deck — read as enterprise infrastructure of the highest tier
without sacrificing developer-first ergonomics.

**In scope.**
- The brand foundation (`docs/design/00_BRAND_FOUNDATION.md`).
- All design surfaces (`docs/design/01_*` through `05_*`).
- The component library (`packages/ui-brand` and the in-app component
  systems in each `apps/*`).
- Logo, wordmark, identity work (with a contract identity designer for
  v1; see `04_BRAND_IDENTITY_PROMPTS.md`).
- The recurring brand visuals: 4-layer stack, denial-precedence ladder,
  request-lifecycle swim-lane.
- Accessibility floor (WCAG 2.2 AA) compliance review.
- Motion and density guidelines.

**Out of scope.**
- Marketing copy (GTM owns the words; Design owns the layout).
- Technical writing (Documentation role within Engineering owns).
- Customer success collateral (Customer Success owns; Design templates
  it).
- Frontend-engineering implementation (Engineering owns; Design
  reviews).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| Brand foundation update | Design | Operator | All | All |
| New marketing page design | Design | Design | GTM, Product | All |
| Dashboard component change | Design | Design | Engineering | Customer Success |
| Identity / mark refresh | Design | Operator | All | All |
| A11y audit | Design | Design | Engineering | All |

**Quality bar.**
- Brand foundation tokens never violated. Hardcoded hex outside the
  foundation is a stop-the-line review event.
- WCAG 2.2 AA on every shipped surface (real screen-reader pass; no
  Lighthouse-only validation).
- Lighthouse ≥95 on every public-web surface.
- No stock photos, no AI-generated imagery on production surfaces, no
  mascots, no glow orbs. (See `docs/design/00_BRAND_FOUNDATION.md` § 9.)
- Every surface has a dark-mode parity (where applicable) at design
  time, even if dark ships later.
- Design changes that affect the public site go through visual-
  regression review (Percy or equivalent when wired).

**Owned documents.**
- `docs/design/**` — the entire folder.
- `packages/ui-brand/**`.
- A brand-guide PDF (when delivered by the identity designer).

**Hand-offs.**
- Receives from: Product (UX intent), GTM (campaign needs), Customer
  Success (collateral templates), Security (security-page content).
- Hands to: Engineering (DEV-mode handoff in Figma + token files), GTM
  (marketing page final), Customer Success (collateral templates).

**Cadence.**
- Weekly: design review with Engineering and Product.
- Monthly: a11y audit + a brand-drift review (any unauthorized hex or
  font appearance).
- Quarterly: surface-by-surface visual review at scale (every page,
  every state).

---

## 4. Security

**Mission.** Ensure every claim OKORO makes about cryptographic
guarantees is true, and ensure every threat that could falsify those
claims is mitigated or accepted with eyes open.

**In scope.**
- `docs/SECURITY.md`, `docs/THREAT_MODEL_v2.md`, `docs/CLI_SECURITY.md`,
  `docs/IMMUTABILITY.md`, `docs/POST_QUANTUM_ROADMAP.md`.
- The denial precedence — order, semantics, public API contract.
- Cryptographic code review for every change touching `apps/api/src/
  common/crypto/*`, `packages/sdk-*/crypto`, signing and verification
  paths.
- Audit chain integrity invariants.
- Key handling — issuance, rotation, custody (none — public-key only).
- Threat-model maintenance.
- Security review of every PR with crypto, audit, or denial-precedence
  changes.
- Bug bounty program design and triage.
- Security incident response (with Compliance).
- Penetration test coordination.

**Out of scope.**
- Compliance evidence assembly (Compliance owns; Security supplies the
  controls).
- Customer security questionnaires (Customer Success or GTM owns the
  workflow; Security supplies the answers).
- Ops-level monitoring (Engineering owns the instrumentation).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| Threat model update | Security | Security | Engineering | All |
| Denial precedence change | Security | Operator | Engineering, Product, Compliance | All |
| Crypto algorithm change | Security | Operator | Engineering, Standards, Compliance | All |
| Security incident | Security | Security | Engineering, Compliance, Legal, Customer Success | All |
| Bug bounty payout | Security | Operator | Finance, Legal | All |

**Quality bar.**
- No crypto change ships without a paired `.spec.ts` and a Security
  review approval visible in the PR.
- Threat model is updated within 14 days of any new attack surface
  going live.
- Security findings tracked with CVSS-style severity and an owner per
  finding (see `docs/audit_2026q2/FINDINGS_SUMMARY.md` for the canonical
  shape).
- Every public claim about cryptographic guarantees has a citation to
  the implementation file and the test that proves the guarantee.
- Security has veto power on any change that violates a `CLAUDE.md`
  invariant. The veto is not negotiable; the override path is an ADR
  that explicitly amends the invariant.

**Owned documents.**
- `docs/SECURITY.md`.
- `docs/THREAT_MODEL_v2.md` and predecessors.
- `docs/IMMUTABILITY.md`.
- `docs/POST_QUANTUM_ROADMAP.md`.
- `docs/audit_2026q2/*.md` (the security-facing audit slice).
- `docs/reviews/security_attack_surface.md`,
  `docs/reviews/crypto_attack_surface.md`.
- `docs/INCIDENT_RESPONSE.md`, `docs/INCIDENT_RUNBOOK.md` (co-owned
  with Engineering).
- ADRs touching crypto or denial precedence (e.g. ADR-0002, 0004,
  0005, 0010, 0013).

**Hand-offs.**
- Receives from: Engineering (PRs for review), Product (new feature
  threat-model inputs), Compliance (control mapping needs).
- Hands to: Compliance (control evidence), Customer Success (security
  questionnaire answers), GTM (security-page content), Engineering
  (control implementation specs).

**Cadence.**
- Daily: PR security review (any change touching crypto, audit, denial
  precedence).
- Weekly: bug bounty triage.
- Monthly: threat model delta review.
- Quarterly: full STRIDE table refresh + external pentest cadence
  consideration.

---

## 5. Compliance & Risk

**Mission.** Map OKORO controls to the standards customers and regulators
require, keep the evidence trail current, and pre-build the institutional
muscle for SOC2 → ISO 27001 → SOX.

**In scope.**
- `docs/COMPLIANCE.md`, `docs/COMPLIANCE_BUNDLE.md`, `docs/EU_RESIDENCY.md`,
  `docs/RETENTION_POLICY.md`.
- Mapping OKORO controls to: SOC2 Trust Services Criteria, ISO 27001
  Annex A, NIST CSF, EU AI Act, GDPR / DPA, financial-services-specific
  frameworks (FRTB-style audit, FINRA, COSSEC) where customers require.
- Vendor risk management (sub-processors and their SOC2 status).
- Data Processing Agreements and standard contractual clauses.
- Disclosure controls — what claims OKORO makes externally and how
  they are sourced.
- Change management discipline (every prod change → ticket → review →
  audit event).
- Pre-IPO institutional muscle: segregation of duties, materiality
  framework, internal-audit cadence (in advance of SOX-required
  cadence).

**Out of scope.**
- Cryptographic correctness (Security owns).
- Legal contract negotiation (Legal owns; Compliance supplies the
  control framing).
- Pricing and finance-specific controls (Finance owns; Compliance
  supplies the framing for revenue recognition, etc.).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| SOC2 control mapping | Compliance | Compliance | Security, Engineering, Operator | All |
| DPA template change | Compliance | Legal | Security, Engineering | All |
| Sub-processor add | Compliance | Operator | Security, Legal, Finance | All |
| Customer compliance Q | Compliance | Compliance | Security, Customer Success | All |
| Pre-SOX gap analysis | Compliance | Operator | Finance, Legal | All |

**Quality bar.**
- Every customer-facing compliance claim has a control mapping and an
  evidence pointer. A claim of "SOC2 Type 2" without an attestation
  letter on file is a stop-the-line PR review.
- Status table in `docs/COMPLIANCE.md` is honest: "In place" / "In
  progress" / "Roadmap" — never aspirational.
- Sub-processors list is current within 30 days of any change.
- Audit evidence (the actual artifacts a SOC2 auditor would inspect)
  is collected continuously, not assembled at audit time.

**Owned documents.**
- `docs/COMPLIANCE.md`, `docs/COMPLIANCE_BUNDLE.md`.
- `docs/EU_RESIDENCY.md`, `docs/RETENTION_POLICY.md`.
- `docs/audit_2026q2/code_review.md`, `docs/audit_2026q2/landscape.md`.
- `docs/decisions/0006-audit-redactability.md` (co-owned with Security).
- The DPA, sub-processors list, and SOC2 control matrix (when
  canonicalized).

**Hand-offs.**
- Receives from: Security (control implementation status), Engineering
  (audit evidence, change tickets), Legal (contract terms), Customer
  Success (customer questionnaires).
- Hands to: Customer Success (compliance answers), GTM (compliance
  posture for marketing), Legal (control language for contracts),
  IR (compliance-readiness claims for board updates).

**Cadence.**
- Weekly: open customer questionnaires status.
- Monthly: control mapping refresh.
- Quarterly: pre-audit dry run.

---

## 6. Go-to-Market (Sales + Marketing)

**Mission.** Convert the right developers and the right enterprises
into customers, in that order, without compromising the brand.

**In scope.**
- Marketing site copy (with Design owning layout).
- Outbound and inbound pipeline.
- Pricing-page positioning (with Product owning tier definitions).
- Demand generation campaigns.
- Conference, podcast, content marketing.
- Sales motion: discovery → demo → pilot → close.
- Sales collateral, decks, one-pagers, case studies.
- Pricing communication and approvals (deal-level).
- Customer logos, case studies (with Customer Success co-owning).
- Analyst relations.
- Public benchmarks and performance claims (with Engineering verifying).

**Out of scope.**
- Customer support and onboarding (Customer Success owns).
- Pricing tier definition (Product owns).
- Investor narrative and fundraising (IR owns; GTM may supply persona
  and pipeline evidence).
- Compliance-claim accuracy (Compliance owns; GTM repeats only what
  Compliance has approved).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| Marketing campaign | GTM | GTM | Design, Product | All |
| Public benchmark claim | GTM | Operator | Engineering, Security | All |
| Sales deck change | GTM | GTM | Product, Design, IR | All |
| Pricing-page wording | GTM | GTM | Product, Finance | All |
| Public case study | GTM | GTM | Customer Success, Legal | All |

**Quality bar.**
- No public claim about latency, scale, or capability ships without
  Engineering verification and Security review (for security claims).
- No marketing copy paraphrases technical specifics ("80ms," "Ed25519,"
  the 10 denial reasons) — these are quoted from canonical sources or
  not at all.
- No marketing imagery violates `docs/design/00_BRAND_FOUNDATION.md`.
- Every campaign has a measurable goal and a postmortem within 14 days
  of campaign close.
- Customer logos and quotes are only published with written customer
  approval (Legal verifies).

**Owned documents.**
- `docs/spec/02_GTM_ADOPTION.md` (co-owned with Product).
- The marketing site content (layout owned by Design, copy by GTM).
- Pricing-page wording.
- The sales deck (the enterprise variant in
  `docs/design/05_PITCH_DECK_PROMPTS.md` is the canonical structure;
  GTM owns the per-customer fills).
- The blog and changelog narrative voice (with Engineering owning
  technical truth).

**Hand-offs.**
- Receives from: Product (positioning, persona), Design (visual surfaces),
  Engineering (verified benchmarks), Customer Success (case-study
  candidates), Compliance (approved compliance claims).
- Hands to: Customer Success (qualified pipeline), IR (pipeline metrics
  for board updates).

**Cadence.**
- Weekly: pipeline review.
- Monthly: campaign performance review.
- Quarterly: positioning audit, persona refresh contribution.

---

## 7. Customer Success / Solutions

**Mission.** Take a customer from "signed contract" to "production
deployment that creates measurable value," and keep them there.

**In scope.**
- Onboarding (the 6-week pilot + production transition flow).
- Integration patterns and templates (`docs/INTEGRATION_GUIDE_*` and
  `docs/INDUSTRY_QUICKSTARTS.md`).
- Customer health scoring.
- Renewals and expansion (with GTM in lock-step).
- Customer support — tickets, SLAs.
- Customer-facing release notes (the parsed/curated version, not the
  raw `SESSION_HANDOFF.md`).
- Customer questionnaires (security, compliance — escalating to
  Security and Compliance for answer authority).
- Quarterly business reviews.
- Customer feedback synthesis (with Product).

**Out of scope.**
- Selling the next contract (GTM owns the commercial motion).
- Pricing exceptions (Finance + Operator approve; Customer Success
  proposes).
- Roadmap commitments to customers (Product approves; Customer Success
  may not promise unilaterally).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| Customer onboarding | CS | CS | Engineering | All |
| SLA breach | CS | CS | Engineering, Operator | All |
| Customer churn | CS | CS | GTM, Product | All |
| Roadmap commitment to customer | CS | Product | GTM, Operator | All |
| Customer security questionnaire | CS | Security | Compliance, GTM | All |

**Quality bar.**
- Every customer has an integration runbook by week 2 of pilot.
- Every customer has a named owner (a human contact) within Customer
  Success, even if the role is filled by the operator at small scale.
- Customer health scores are objective, not narrative — derived from
  verify volume trend, denial rate trend, support ticket count, last
  business review date.
- A customer commitment in writing (email, Slack, contract amendment)
  is reflected in `WORK_BOARD.md` within 7 days. No verbal-only
  commitments.

**Owned documents.**
- `docs/INTEGRATION_GUIDE_*.md`.
- `docs/INDUSTRY_QUICKSTARTS.md`.
- `docs/PARTNER_ONBOARDING.md` (co-owned with Product).
- `docs/PLUGIN_AUTHORS.md`.
- `docs/BETA_ONBOARDING_RUNBOOK.md`.
- `docs/RUNBOOK.md` (the customer-facing runbook).
- Customer-facing release notes (template at
  `docs/RELEASE_NOTES_TEMPLATE.md`).

**Hand-offs.**
- Receives from: GTM (signed customer), Engineering (release notes
  raw), Product (customer-impact analysis on roadmap items).
- Hands to: Product (synthesized feedback), GTM (renewal/expansion
  signals, case-study candidates), Engineering (high-priority issues,
  customer-driven feature requests with quantified pain).

**Cadence.**
- Daily: support queue triage.
- Weekly: customer health score review, churn-risk escalation.
- Monthly: customer feedback synthesis.
- Quarterly: business reviews with each top-decile customer.

---

## 8. Finance & Operations

**Mission.** Ensure OKORO knows its numbers, spends them well, and
reports them in a form a public company would recognize.

**In scope.**
- Revenue recognition (subscription + verify-volume billing).
- Pricing tier financial modeling.
- Burn, runway, monthly close.
- Vendor management (cloud, observability, SaaS subscriptions).
- Budget and spend approvals.
- Cost-of-goods modeling (per-verify cost economics — critical to
  OKORO's pricing thesis).
- Financial reporting cadence (monthly, quarterly).
- Pre-Series A and pre-IPO institutional muscle: revenue-recognition
  policies, capitalization table hygiene, audit-trail for every
  financial movement, vendor SOC2 collection.

**Out of scope.**
- Fundraising motion (Operator + IR own).
- Pricing positioning (GTM owns; Finance models).
- Compliance attestations (Compliance owns).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| Monthly close | Finance | Finance | Operator | All |
| Pricing model change | Finance | Operator | Product, GTM | All |
| Vendor onboarding | Finance | Operator | Compliance, Security, Legal | All |
| Annual budget | Finance | Operator | All | All |
| Revenue recognition policy | Finance | Operator | Legal, Compliance | All |

**Quality bar.**
- Numbers in the operator update reconcile to source systems (Stripe,
  bank, ledger) within 48 hours of close.
- Vendor sub-processor list (financial side) reconciles to Compliance's
  list. No vendor unknown to one side and known to the other.
- Per-verify cost economics modeled monthly; public pricing tiers
  validated against the model quarterly.
- Cap table is in writing and reconciled to legal source documents.

**Owned documents.**
- `docs/spec/04_COMMERCIAL_STRATEGY.md` (co-owned with Product).
- A revenue-recognition policy doc (when canonicalized).
- A vendor list (when canonicalized).
- A monthly close doc.

**Hand-offs.**
- Receives from: GTM (deal contracts, ARR signal), Engineering (cost
  signal — cloud spend, infra utilization), Customer Success (renewals,
  churn).
- Hands to: IR (board-pack financials), Operator (runway view).

**Cadence.**
- Daily: cash position.
- Weekly: pipeline → forecast.
- Monthly: close + operator update financial section.
- Quarterly: budget vs actual + reforecast.

---

## 9. Legal

**Mission.** Make sure OKORO can do business everywhere it sells, owns
what it builds, and is contractually defensible in every commitment.

**In scope.**
- Customer contracts (MSA, DPA, order forms).
- Vendor contracts.
- Employee and contractor agreements.
- IP ownership and assignment.
- Terms of Service, Privacy Policy, Acceptable Use.
- Open-source license review (the SDK is MIT — confirm; dependencies
  audited).
- Trademark filings (OKORO, the logomark when delivered).
- Regulatory engagement (EU AI Act, US sectoral regulators where
  applicable).
- M&A document hygiene (no deal-breakers in standard agreements).

**Out of scope.**
- Compliance attestations (Compliance owns; Legal references).
- Contract pricing terms (Finance + GTM own; Legal redlines language).
- Customer questionnaire technical answers (Security + Compliance own).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| Customer redline | Legal | Legal | GTM, Compliance | All |
| New ToS / Privacy version | Legal | Operator | Compliance, Security | All |
| Open-source license addition | Legal | Engineering | Legal | All |
| Trademark filing | Legal | Operator | Design | All |
| Regulator inquiry | Legal | Operator | Compliance, Security, GTM | All |

**Quality bar.**
- Customer contracts use the standard templates unless an exception
  is logged in a contract-exception register.
- Every contract amendment is filed within 7 days of execution.
- Open-source dependencies have a license that is compatible with
  OKORO distribution (the SDK is MIT; copyleft is forbidden in
  packages we distribute).
- IP assignments from contractors are signed before contractor commits
  to the repo. No exceptions; this is a S-1 diligence killer if it
  drifts.

**Owned documents.**
- `docs/legal/*` (when canonicalized — currently distributed).
- ToS, Privacy Policy, AUP (footer-linked from marketing site).
- Contract templates (MSA, DPA, order form).
- A contract-exception register.

**Hand-offs.**
- Receives from: GTM (deals to redline), Compliance (control language
  to embed in DPA), Engineering (open-source dependency additions to
  approve).
- Hands to: GTM (approved contracts), IR (clean cap table, contract
  defensibility), Operator (regulator-facing language).

**Cadence.**
- As-needed (deal volume).
- Weekly: redline queue triage.
- Quarterly: contract template review.

---

## 10. People & Culture

**Mission.** Hire the right people, give them the conditions to do the
best work of their careers, and operate at IPO bar without IPO overhead.

**In scope.**
- Hiring funnel design and execution.
- Onboarding (technical and cultural).
- Performance and growth conversations.
- Compensation framework.
- Equity grants administration (in close partnership with Legal and
  Finance).
- Cultural artifacts (the way we work; this OS is part of the artifact
  set).
- Conflict resolution and escalation.
- Hiring quality bar — not headcount target.

**Out of scope.**
- Department-specific technical evaluation (each department owns the
  technical bar; People owns the cultural bar and the process).
- Compensation philosophy decisions (Operator owns; People implements).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| New role open | People | Department head | Operator, Finance | All |
| Performance review cycle | People | Operator | All | All |
| Comp adjustment | People | Operator | Finance, Legal | All |
| Equity grant | People | Operator | Legal, Finance | All |
| Termination | People | Operator | Legal | All |

**Quality bar.**
- Every hire has at least one rigorous technical loop AND at least one
  values/cultural conversation. No hire bypasses either.
- Equity grants are processed within 30 days of start date — period.
  This is a S-1 diligence item.
- Performance feedback is in writing, given at least quarterly, and
  filed.
- Every employee has the role brief from `02_AGENT_ROLES.md` for the
  role they fill, plus their department's charter, in their onboarding
  packet.

**Owned documents.**
- An onboarding packet (canonical when first hire ships).
- Comp framework doc.
- A role-architecture doc (mapping `02_AGENT_ROLES.md` to actual job
  titles).
- Hiring scorecards.

**Hand-offs.**
- Receives from: department heads (role definition), Finance (budget),
  Legal (employment templates).
- Hands to: department heads (signed offers), Finance (payroll, equity
  records), Legal (signed agreements), IR (headcount for board).

**Cadence.**
- Weekly: hiring funnel review.
- Quarterly: performance reviews, comp benchmarking.
- Annual: comp refresh, hiring plan.

---

## 11. Investor Relations & Strategy

**Mission.** Maintain the investor-facing narrative, the data room,
and the board-quality artifact discipline. Drive fundraising,
strategic partnerships, and (eventually) M&A and IPO readiness.

**In scope.**
- The investor deck (the canonical structure in
  `docs/design/05_PITCH_DECK_PROMPTS.md`; IR owns the per-round content).
- The board update (monthly).
- The data room (perpetually current; see
  `05_PUBLIC_COMPANY_READINESS.md`).
- KPI dashboards for investor consumption.
- Cap table hygiene (with Finance and Legal).
- Series planning, runway communication, dilution modeling.
- Strategic partnership scouting and evaluation (e.g. Stripe ACP,
  Auth0 bridge, MCP standards body).
- M&A readiness (in either direction — buying or being bought).
- IPO readiness milestones.

**Out of scope.**
- Customer-facing communication (GTM, Customer Success).
- Day-to-day product decisions (Product, Engineering, Operator).
- Compliance attestations (Compliance owns; IR consumes).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| Board update | IR | Operator | Each dept (data) | Investors, employees (subset) |
| Fundraising round | IR | Operator | Legal, Finance, Compliance | All |
| Investor deck refresh | IR | Operator | Product, GTM, Design | All |
| Strategic partnership eval | IR | Operator | Engineering, Security, Legal | All |
| Pre-IPO institutional gap fix | IR | Operator | All | All |

**Quality bar.**
- Every claim in an investor artifact has a source. The source is
  reproducible (a CI run, a Stripe export, a customer email).
- Forward-looking statements are explicitly bracketed and footnoted.
- Investor decks are not "edited" between sends — each send is a
  versioned artifact saved to the data room.
- Monthly board update is delivered within 7 days of month close.
- Data room is reviewed monthly; staleness > 30 days on any document
  is a stop-the-line.

**Owned documents.**
- The investor deck (canonical).
- The monthly board update.
- The data room (the index and the discipline; individual artifacts
  are owned by their source departments).
- A KPI dashboard (when canonicalized).
- Strategic-partner one-pagers.

**Hand-offs.**
- Receives from: every department (the source numbers and narratives).
- Hands to: investors, board, prospective acquirers/acquirees, public
  markets eventually.

**Cadence.**
- Monthly: board update.
- Per-fundraise: deck refresh, due diligence response.
- Quarterly: data-room review, KPI dashboard refresh.
- Annual: institutional-readiness gap analysis.

---

## 12. Standards / Office of the CTO

**Mission.** Position OKORO as a contributor to and shaper of the
emerging open standards for agent identity, verification, and
attestation. Make sure OKORO does not become locked out of standards
the rest of the market converges on.

**In scope.**
- Engagement with standards bodies (W3C DID, MCP working groups,
  ACP / OpenAI Agentic Commerce, Auth0 OIDC for AI Agents, etc.).
- Authoring and publishing position papers and RFCs.
- Maintaining `docs/standards/*.md`.
- Contributing reference implementations to open-source standards.
- Watching the competitive standards landscape (Prefactor, Entro,
  Auth0, Microsoft, Google) and synthesizing for the operator and
  Product.
- Long-horizon technical strategy (post-quantum migration, edge-
  verify, post-ACP positioning).

**Out of scope.**
- Day-to-day engineering choices (Engineering owns).
- Customer-facing technical pitches (GTM owns; Standards supplies the
  narrative).

**RACI.**

| Work | R | A | C | I |
|---|---|---|---|---|
| Standards-body submission | Standards | Operator | Engineering, Security, Legal | All |
| Open-source reference impl | Standards | Engineering | Security | All |
| Position paper | Standards | Operator | All | All |
| Competitive landscape memo | Standards | Standards | Product, GTM | All |

**Quality bar.**
- Every submission to a standards body is reviewed by Security and
  Legal before submission.
- Open-source contributions never reveal proprietary OKORO
  implementation details that Compliance has flagged as confidential.
- Position papers cite their sources; no claims unsupported by
  references.

**Owned documents.**
- `docs/standards/*.md`.
- `docs/OKORO_AS_BACKBONE.md` (co-owned with Product).
- `docs/decisions/` ADRs that touch protocol choices (e.g. ADR-0008
  MCP-as-control-plane, ADR-0009 Auth0 bridge, ADR-0013 PQ hybrid).
- Position papers (when published).

**Hand-offs.**
- Receives from: Engineering (implementation truth), Product (use cases
  to advocate), Security (constraints to respect).
- Hands to: GTM (narrative for technical sales), IR (positioning for
  investors), Engineering (standards-driven implementation requirements).

**Cadence.**
- Per-standards-cycle (varies by body).
- Quarterly: competitive landscape memo.
- Annual: position paper and conference talk plan.

---

## RACI quick-reference

| Department | Receives from | Hands to (most often) |
|---|---|---|
| Engineering | Product, Design, Security, Compliance | Customer Success, GTM, IR |
| Product | Customer Success, GTM, Engineering | Engineering, Design, GTM, IR |
| Design | Product, GTM, Customer Success, Security | Engineering, GTM, Customer Success |
| Security | Engineering, Product, Compliance | Compliance, Customer Success, GTM, Engineering |
| Compliance | Security, Engineering, Legal, Customer Success | Customer Success, GTM, Legal, IR |
| GTM | Product, Design, Engineering, Customer Success, Compliance | Customer Success, IR |
| Customer Success | GTM, Engineering, Product | Product, GTM, Engineering |
| Finance | GTM, Engineering, Customer Success | IR, Operator |
| Legal | GTM, Compliance, Engineering | GTM, IR, Operator |
| People | Department heads, Finance, Legal | Department heads, Finance, Legal, IR |
| IR | Every department | Investors, Board, Operator |
| Standards | Engineering, Product, Security | GTM, IR, Engineering |

This matrix is the social graph of OKORO execution. Print it. Tape it
to the wall. When confused about who consults whom on a piece of work,
this is the answer.
