---
title: OKORO — Pitch & Sales Deck Prompts
audience: deck tools (Gamma, Pitch, Tome, Beautiful.ai), in-repo .pptx generation, designer briefs
last-reviewed: 2026-05-08
prerequisites: read `docs/design/00_BRAND_FOUNDATION.md` first; review `docs/spec/01_MASTER.md` and `docs/WEDGE_PROOF.md` for canonical positioning
---

# 05 — Pitch & Sales Deck Prompts

Two distinct decks share most slides:

1. **Investor deck** (15-18 slides) — for seed/Series A conversations.
   Strategic, market-shaped, vision-first.
2. **Enterprise sales deck** (10-12 slides) — for CISO and platform-
   eng-leader conversations. Control-shaped, compliance-shaped,
   integration-pattern-first.

The two decks share ~70% of slides; build a master deck and toggle
slides on/off per audience.

## Master slide library (used by both decks)

```
01  Cover                    — wordmark + tagline + presenter context
02  The market shift         — agents are about to outnumber humans on the wire
03  The unsolved gap         — ACP solves payments; what's left
04  OKORO in one sentence    — the verifier choke point
05  How it works             — 4-layer stack visual (the canonical motif)
06  The verify hot path      — request lifecycle diagram, <80ms p99
07  Why neutrality wins      — Switzerland thesis, anti-platform-lock
08  Security model           — non-custodial, signed audit, fixed denial
                                precedence (the ladder visual)
09  Integration pattern      — 30-line code sample, full + minimum
10  Trust score (BATE)       — the second moat — observed behavior
11  The other moats          — denial precedence as public API, audit
                                chain as forensic primitive
12  Pricing & business model — verify-volume billing, plan tiers
13  Competitive map          — Auth0, Prefactor, Entro, ACP, OKORO row
14  Traction / proof         — design partners, GitHub stars, customer
                                logos (placeholder until shipped)
15  Roadmap                  — what ships next 6/12 months
16  Team                     — operator + engineering leads
17  Ask                      — investor: amount + use of funds;
                                enterprise: pilot proposal + commercial
                                terms
18  Appendix                 — threat model, denial precedence detail,
                                BATE math, pricing tier matrix, FAQ
```

### Audience toggles

```
INVESTOR DECK:    01, 02, 03, 04, 05, 07, 10, 11, 12, 13, 14, 15, 16, 17 (variant: investor), 18 (subset)
ENTERPRISE DECK:  01, 03, 04, 05, 06, 08, 09, 10, 12 (variant: pilot), 17 (variant: pilot), 18 (subset)
```

---

## A. AI deck-tool prompts (Gamma, Pitch, Tome, Beautiful.ai)

These tools generate decks from a single prompt + outline. They produce
~80% of a deck — useful for first-draft, never for shipping. Always
hand-finalize in Figma or Keynote/PowerPoint.

### A.1 Investor deck — single Gamma prompt

```
Generate an investor deck for OKORO, a verification + behavioral
attestation infrastructure for AI agents. 15 slides. Visual lane:
Cloudflare meets Auth0 — slate neutrals (slate-50, slate-700, slate-
900) with a single cyan-blue brand accent (#06B6D4 — call it
"okoro-500"). Inter for everything except code samples (JetBrains
Mono). No mascots, no stock photos, no AI-generated imagery.

Tone: precise, builder-flavored, confident without boast. Numbers over
adjectives. State what OKORO does; skip "industry-leading" /
"revolutionary" / "next-gen."

Outline (one slide per line):

1. Cover. Title "OKORO" in Inter 700 okoro-500. Tagline
   "The verification layer for AI agents." Below: presenter
   name + title + date. Slate-50 background.

2. The market shift. Headline "By 2030, 4–40 AI agents per person."
   Subhead "Every agent action will need a verifier." Source
   citation (Crone Consulting) in mono at the bottom. A single
   chart on the right: agent-action volume projection through
   2030. No clip art.

3. The unsolved gap. Headline "ACP solved payments. Verification was
   left to implementers." A two-column comparison:
   left = "What ACP solves" (3 bullets)
   right = "What ACP doesn't solve" (4 bullets — who is the agent,
   is it authorized, is its behavior trustworthy, can the RP
   verify in <100ms).

4. OKORO in one sentence. Single sentence centered: "OKORO is the
   neutral verification, policy, and behavioral attestation layer
   between AI agents and the services they act on." Below, three
   chips: "Neutral", "Non-custodial", "Verifiable".

5. How it works. The 4-layer stack visual (Identity, Policy, BATE,
   Audit) with the verify hot path connecting them. Caption
   "<80ms p99. Public-key only. Append-only audit."

6. The verify hot path (skip in investor deck unless asked).

7. Why neutrality wins. Headline "We are the Switzerland of agent
   identity." Body: 3 reasons stacked — protocol-neutral (works
   with ACP, MCP, OAuth), vendor-neutral (works with Claude/GPT/
   Gemini/custom), model-neutral (no LLM-specific assumptions).

8. Security model. The denial precedence ladder visual on the right;
   on the left, three short claims: "We hold public keys only",
   "Audit is append-only and signed", "Denial precedence is fixed
   and public."

9. Integration pattern (skip in investor deck unless requested).

10. Trust score (BATE). Headline "Behavior is the second moat."
    Body: the trust score is built from observed agent behavior
    over time — velocity, geo, spend pattern, failed-verify rate,
    cross-RP consistency. The longer an agent operates, the more
    expensive it is to spoof. Network effects on data.

11. The other moats. Three rows:
    - "Denial precedence as public API" — RP integrations harden
      around our reason codes; switching costs grow.
    - "Audit chain as forensic primitive" — we become the system
      of record for incident postmortems.
    - "BATE as cross-tenant signal" — bad agents in one tenant
      become more expensive across all tenants.

12. Pricing & business model. 4-tier table: Free / Builder / Team /
    Enterprise with verify volume + price points (use placeholders
    if not yet finalized). Headline: "We bill on verifies, not
    seats. Usage scales with deployment depth, not headcount."

13. Competitive map. A matrix:
    rows = Auth0 for AI Agents, Prefactor, Entro Security, Stripe
    ACP, OKORO
    columns = Neutral, Non-custodial, Cross-protocol, Behavioral
    attestation, Audit-as-product
    OKORO is the only row with all 5 cells checked.

14. Traction / proof. Up to 6 logo placeholders for design partners.
    Below: GitHub stars, weekly verify volume on staging, ARR if
    any. Be honest — pre-launch numbers are pre-launch numbers.

15. Roadmap. A 12-month timeline with 4 quarter columns. Each
    column lists 3-4 capabilities. Use the docs/spec/05_STANDARDS_
    ROADMAP.md as the source.

16. Team. Founder + 2-3 key engineers. Each: name, role, one-line
    background. No LinkedIn-style hagiography.

17. Ask. Headline "Raising $XM. Use of funds:" then three buckets
    with percentages: Engineering (X%), Go-to-market (X%),
    Compliance (SOC2/ISO/EU AI Act) (X%). Below: contact email +
    next steps.

18. Appendix (1-3 slides). Threat model summary, denial precedence
    detail, BATE signal weights, pricing tier matrix, FAQ.

Use the canonical layer-stack visual on slide 5 and the denial
precedence ladder on slide 8. These are recurring brand visuals;
keep them visually consistent across slides.
```

### A.2 Enterprise sales deck — single prompt

```
Generate an enterprise sales deck for OKORO, used in CISO and platform-
engineering-leader conversations. 11 slides. Same visual lane as the
investor deck (slate + okoro-500, Inter + JetBrains Mono).

Tone: control-shaped, mapped-to-compliance, integration-pattern-first.
Numbers and concrete commitments over vision.

Outline:

1. Cover. Title "OKORO for [Customer Name]." Tagline "Verification +
   audit for your agent fleet." Presenter name + customer logo
   placeholder.

2. The unsolved gap (same as investor slide 3, but lead with the
   relevant industry — fintech / SaaS / health / commerce — and one
   concrete loss scenario for that industry).

3. OKORO in one sentence (same as investor slide 4).

4. How it works (same 4-layer stack as investor slide 5).

5. The verify hot path. The request lifecycle swim-lane diagram with
   <80ms p99 highlighted. Caption: "Your agents call our SDK. We
   return a signed verdict. The relying-party stays in control of
   the action."

6. Security model. Heavier than investor slide 8:
   - Non-custodial: "We never see your private keys."
   - Append-only audit: "Hash-chained, OKORO-signed, exportable as
     NDJSON for your SOC2 / ISO / FINRA evidence pack."
   - Denial precedence: "10 fixed reasons. Public API contract. Your
     RP code can rely on stability."
   - Multi-tenant isolation: "Queries scoped by principal at every
     layer. Cross-tenant leaks fail closed."

7. Integration pattern. The 30-line SDK example on the right; on the
   left, "Three integration shapes" — SDK direct, sidecar proxy,
   edge worker — with a 1-line trade-off summary each. Caption:
   "Most teams ship the SDK pattern in a sprint."

8. Compliance posture. A table:
   rows = SOC2 CC1.4, CC6.1, CC6.6, CC7.3, ISO 27001 A.5.15, A.8.16,
          NIST CSF PR.AC-1, PR.AC-4, EU AI Act Art. 14
   columns = Customer responsibility, OKORO contribution, Status
   OKORO contribution column lists the specific control: "Signed
   audit chain", "Non-custodial key handling", "Scoped policy
   enforcement", "Trust thresholding". Be honest — pre-SOC2 status
   says "In progress" with target date.

9. Pilot proposal. A specific 6-week pilot scope:
   - Week 1: integration with one agent flow
   - Week 2: policy + threshold tuning
   - Week 3: shadow-mode verification (logs only, no enforcement)
   - Week 4: enforcement on 10% of traffic
   - Week 5: enforcement on 100% of traffic
   - Week 6: review + production transition or end of pilot
   Include: success metrics, who's responsible for what, what we
   provide, what we need from them.

10. Pricing. Enterprise tier only — usage-based billing with custom
    verify volume, on-prem option, custom retention, SOC2 evidence
    pack, dedicated CSM. Sample pricing for 3 volume tiers.

11. Next steps. Three buckets:
    - Technical: kickoff a call with their platform engineering lead
    - Commercial: legal redlines on MSA / DPA
    - Pilot: proposed kickoff date + first checkpoint
    Contact email + calendar link.

The deck must work both in-person (presented) and as a leave-behind
PDF. Avoid animated builds; every slide should make sense as a static
PDF page.
```

### A.3 Tome / Beautiful.ai-specific note

These tools auto-generate visuals when you describe slide content.
Important constraints to add to either prompt above:

```
Visual constraints (override any tool defaults):
- No stock imagery, no AI-generated photos, no isometric scenes,
  no 3D renders.
- Use exclusively: typography, geometric diagrams, simple bar/line
  charts, code samples (mono).
- No animated builds, no slide transitions other than instant cut.
- No drop shadows on text, no gradient text, no neon.
- All headlines: Inter 700 tracking-tight, slate-900 on slate-50.
- Single brand accent: #06B6D4. Use sparingly — primary CTA, recurring
  motif elements, key callouts only.
```

---

## B. Figma deck design prompt

For the polished, ship-quality version of the deck. Use this with a
designer or as a Figma AI prompt for an in-Figma deck.

```
Design a master deck file for OKORO in Figma. 18 slides at 16:9
(1920×1080). Two views: investor (14 slides selected) and enterprise
(10 slides selected) — built as Figma sections so the final PDFs are
exported per-audience.

Visual system:
- Apply OKORO Brand Foundation v1 tokens via Figma variables.
- Light mode is the default for printed/PDF leave-behinds; dark mode
  variant for in-person presentation in dimmed rooms (build both;
  dark uses slate-950 bg with the same okoro accent).
- Master template: 64px outer margin, 12-column grid, 1280px content
  area, slide title in text-3xl, slide caption in text-base slate-600.
  Slide number bottom-right in mono slate-500.

Recurring visual elements (build as components first):
- 4-layer stack motif (per docs/design/04_BRAND_IDENTITY_PROMPTS.md
  § B.1)
- Denial precedence ladder (per § B.3)
- Request lifecycle swim-lane (per § B.2)
- Code-sample slide layout (single mono code block on slate-900 bg
  with the OKORO-call bold-italic treatment)

Slide-specific design notes:

01 Cover — wordmark centered, tagline below in Inter 400 28px slate-
   600. Date + presenter name bottom-left in mono slate-500. No
   imagery.

02 Market shift — single Recharts-style line chart projecting agent-
   action volume 2025–2030. okoro-500 line on slate-200 axes. Source
   citation bottom-left.

03 Unsolved gap — split slide. Left col headline + 3 bullets on what
   ACP solves; right col headline + 4 bullets on the gaps. Right-
   col bullets visually de-emphasized (slate-400 background) until
   the closing bullet which is okoro-500 highlighted: "Verification."

04 One sentence — centered single sentence, text-5xl, max-width 80%
   slide width. Three chip badges below.

05 4-layer stack — the canonical visual centered, no other content.

06 Verify hot path — the swim-lane diagram, full slide.

07 Switzerland — "Switzerland" headline left, three illustrated rows
   right showing protocol/vendor/model neutrality. Use simple
   geometric icons, not flag imagery.

08 Security model — denial precedence ladder right, three claim
   blocks left.

09 Integration pattern — single mono code block centered, ~30 lines
   visible, the OKORO-specific calls bold-italicized in okoro-500.

10 BATE — a circular gauge graphic showing 0–1000 trust score with
   labeled bands; below, 5 input signal bars.

11 Other moats — three horizontal rows, each with icon + headline +
   one-line description.

12 Pricing — 4-column tier table; recommended tier highlighted with
   okoro-500 border + "Recommended" pill.

13 Competitive map — 5×5 matrix with checkmark / dash / hollow circle
   markers. OKORO row visually distinguished with okoro-500 row
   background tint.

14 Traction — logo grid (6 placeholders) + 3 stat blocks below.

15 Roadmap — 4-column timeline. Each column: quarter label, 3-4
   capabilities. Q1 highlighted as "current."

16 Team — 4-up grid of name + role + one-line bio. No headshots
   required for v1.

17 Ask (investor) — "Raising $XM" big headline; 3-bucket use-of-funds
   donut chart; contact info.

17 Ask (enterprise) — pilot proposal Gantt with 6 weeks, 5 phases;
   commercial and next-step bullets.

18 Appendix — 3 sub-slides: threat model summary, denial precedence
   detail, BATE math.

Build as Figma slides with auto-layout. Export to PDF for each audience
view. Include dev-mode notes for any animated build (there should be
~zero — keep static).
```

---

## C. Designer brief (for a senior deck designer)

```
PROJECT: OKORO Master Deck v1 (investor + enterprise variants)
ENGAGEMENT: ~3-4 weeks
DELIVERABLE FORMAT: Figma master deck + investor PDF + enterprise PDF +
.pptx export + Keynote variant

CONTEXT: OKORO is a neutral verification + attestation infrastructure
for AI agents. Read `docs/spec/01_MASTER.md`, `docs/WEDGE_PROOF.md`,
and `docs/design/00_BRAND_FOUNDATION.md` before starting.

DELIVERABLES:
1. Master deck in Figma — 18 slides with audience-toggle sections
2. Investor variant (14 slides) — exported to PDF + .pptx
3. Enterprise variant (10 slides) — exported to PDF + .pptx
4. Speaker notes for every slide — what the presenter says, what to
   skip if time-pressed
5. Customer-name swap macro — every customer-facing slide has a single
   variable for [Customer Name] so the deck is reusable
6. Two appendix decks: investor data-room appendix (financials,
   metrics), enterprise compliance appendix (control mapping)

IN SCOPE for v1:
- The 18-slide master + variants
- The recurring brand visuals (4-layer stack, denial-precedence ladder,
  request-lifecycle swim-lane) — these may be lifted from the
  marketing/docs designs if they exist; otherwise design fresh

OUT OF SCOPE:
- Animated builds — keep static, with ~zero transitions
- Demo-day variant (post-launch consideration)
- Localized translations

INPUTS:
- Brand Foundation, Master Spec, WEDGE_PROOF, COMPLIANCE_BUNDLE,
  COMMERCIAL_STRATEGY, STANDARDS_ROADMAP — all in /docs/
- The marketing/docs visual elements if shipped — re-use, don't
  redesign

REFERENCES:
- Stripe's Series F deck (publicly available) — slide rhythm, restraint
- Cloudflare's investor relations deck — security narrative cadence
- Linear's series A deck (the "operating system for product
  development" one) — typographic discipline

ANTI-REFERENCES:
- Crypto/web3 decks
- AI consumer-product decks (no "agentic future" rhetoric)
- Clip-art-heavy enterprise decks of the 2010s

HARD CONSTRAINTS:
- 16:9, 1920×1080 master frame size
- Slate + okoro-500 only; no other accent colors
- Inter + JetBrains Mono only
- Every slide must legible as a printed PDF page (no rely on motion)
- Speaker notes for every slide — required, not optional

PROCESS:
- Week 1: master template + recurring visuals + 4 most-critical slides
  (01, 04, 05, 08)
- Week 2: remaining slides
- Week 3: speaker notes + variants split + .pptx export polishing
- Week 4: revisions + final delivery

SUCCESS METRIC:
- Investor deck: founder presents in a 15-minute call without flipping
  back to demos or external explanations. Ends with the investor
  asking the right next-step question.
- Enterprise deck: a CISO can read it as a leave-behind in 12 minutes
  and know whether to schedule a technical deep-dive. If they need to
  call us to clarify what we do, the deck failed.

BUDGET: [fill in — for context, decks at this register typically run
USD 8-15k for a senior independent or 18-30k for a small studio]
PRIMARY POINT OF CONTACT: [fill in]
```

---

## D. Cursor / Claude Code in-repo prompts (for .pptx generation via the pptx skill)

The repo has a `pptx` skill (in `~/.claude/skills/pptx/SKILL.md` per
the available-skills list). Use it for first-draft .pptx generation
that you then refine in Keynote/PowerPoint.

### D.1 Generate the investor deck .pptx

```
Goal: produce apps/decks/investor/OKORO_Investor_Deck_v1.pptx from
the slide library defined in docs/design/05_PITCH_DECK_PROMPTS.md.

Read first:
- ~/.claude/skills/pptx/SKILL.md (mandatory before any pptx work)
- docs/design/00_BRAND_FOUNDATION.md
- docs/design/05_PITCH_DECK_PROMPTS.md (this file)
- docs/spec/01_MASTER.md (the canonical product positioning)
- docs/WEDGE_PROOF.md (the canonical strategic narrative)

Tasks:
1. Use the pptx skill's recommended library (python-pptx as the skill
   suggests) to programmatically generate the deck.
2. Define slide masters: 16:9, 1920×1080, slate-50 light master + a
   slate-950 dark master.
3. Embed Inter and JetBrains Mono as fonts in the .pptx.
4. Generate the 14 investor slides per the audience toggle.
5. For each slide, also write speaker notes per the brief in § C.
6. Save the master Figma export references in
   apps/decks/assets/ — engineering pulls the SVGs for the
   recurring brand visuals (4-layer stack, denial-precedence ladder,
   request-lifecycle swim-lane). If those don't exist yet, generate
   placeholders programmatically and tag them in a // FIXME for the
   designer pass.
7. Add a Makefile target `make deck-investor` that runs the script.
8. Update SESSION_HANDOFF.md.

Constraint: do not invent traction numbers. If a slide needs data
that doesn't exist yet, leave a clearly-marked placeholder
"[TRACTION-DATA-PENDING]" and add a // OPERATOR-INPUT-NEEDED comment
in the script.
```

### D.2 Generate the enterprise deck .pptx

```
Goal: produce apps/decks/enterprise/OKORO_Enterprise_Deck_v1.pptx.

Read first: same as D.1.

Tasks: same approach as D.1, but with the 10-slide enterprise variant.

Special handling:
- Slide 1 cover: include a [Customer Name] placeholder. The script
  takes a --customer flag and substitutes the name + logo path before
  rendering.
- Slide 8 compliance posture: the table content comes from
  docs/COMPLIANCE_BUNDLE.md. Parse the markdown table and generate
  the .pptx table programmatically; do not hand-author content that
  could drift.
- Slide 9 pilot proposal: the 6-week Gantt chart is rendered via
  matplotlib and embedded as a PNG. The phase definitions come from
  docs/BETA_ONBOARDING_RUNBOOK.md.

Add a Makefile target `make deck-enterprise CUSTOMER=AcmeCorp`.

Update SESSION_HANDOFF.md.
```

### D.3 Recurring-visual SVG renderer

```
Goal: a script that renders the 3 recurring brand visuals (4-layer
stack, denial-precedence ladder, request-lifecycle swim-lane) as SVGs
that the marketing site, docs, and decks all consume from one source.

Read first:
- docs/design/04_BRAND_IDENTITY_PROMPTS.md § B.1, B.2, B.3

Tasks:
1. Create packages/ui-brand/visuals/ (extending the package created
   in 04 § D.1).
2. Add 3 React components that render the visuals as SVG with
   props for theme (light/dark) and density (compact/standard).
3. Add a render script that exports each visual at its canonical
   sizes to packages/ui-brand/visuals/exports/ as both SVG and PNG.
4. apps/marketing, apps/docs, and apps/decks (when scaffolded)
   import from packages/ui-brand/visuals/ — never recreate.
5. Update SESSION_HANDOFF.md.
```

---

## How to use the four flavors together — deck edition

For a deck, the right sequence is unusual:

1. **D.1 / D.2 first**: ship a programmatic .pptx draft using the
   pptx skill. This forces the content to be canonical (pulled from
   the docs) and locks the slide library.
2. **A**: re-prompt one of the deck tools (Gamma/Pitch/Tome) with the
   draft outline as a sanity check. If the tool's output is *worse*
   than the programmatic draft, you've validated the draft. If it's
   better in a specific way, lift that into the next pass.
3. **C**: hand the locked content + the draft .pptx to a deck
   designer for the polish pass. The designer's job is visual
   consistency, hierarchy, and motion choreography — not content.
4. **B**: not strictly needed if (C) is done, but useful if (C) is
   not engaged — Figma AI can polish the master deck file as a
   stopgap.

The least-good path is Tome/Pitch/Gamma → ship. AI deck tools
generate adequate first drafts; they ship visibly AI-generated
final decks. OKORO cannot afford that on an enterprise sales call.
