---
title: CERNIQ — Marketing Site Design Prompts
audience: design AI tools, contract designers, in-repo Cursor sessions
last-reviewed: 2026-05-08
prerequisites: read `docs/design/00_BRAND_FOUNDATION.md` first — every prompt below assumes it
---

# 01 — Marketing Site Prompts

The marketing site is the first surface a CTO, security lead, or developer
sees. It must in <8 seconds communicate: _what CERNIQ is_, _why it isn't a
competitor to Auth0/Stripe ACP_, and _what a 30-line integration looks like_.

## Information architecture (the same across all prompt flavors)

```
/                        Hero • The problem • How it works • Live integration • Security model • Pricing • Footer
/security                Threat model, denial precedence, audit chain, key handling, SOC2 status, compliance mapping
/how-it-works            The 4-layer stack, request lifecycle diagram, BATE explainer, integration patterns
/pricing                 4 tiers, free → enterprise; trial mechanics; what hits which gate
/customers               Logo cloud + 2-3 case studies (placeholder until shipped)
/docs                    External link (or rendered subdomain) — see 03_DOCS_SITE_PROMPTS.md
/blog                    Engineering blog — security postmortems, protocol commentary, BATE deep-dives
/about                   Switzerland thesis, team, hiring, principles
/legal/{tos,privacy,dpa} Legalware — footer
```

The hero, /security, and /how-it-works are launch-blocking. Everything else
can ship over the following 30 days.

---

## A. AI UI tool prompts (V0, Lovable, Bolt)

These prompts emit React + Tailwind + (optionally) shadcn. Paste the
prompt into the tool, accept the result, then refine. They assume the
tool can read MDX or similar; tweak the framing if not.

### A.1 Hero section

```
Build a marketing hero section for CERNIQ — a neutral verification, policy,
and attestation layer for AI agents. Stack: Next.js App Router + Tailwind
+ shadcn/ui.

Follow the CERNIQ Brand Foundation v1 (slate neutrals + cerniq-500 #06B6D4
brand, Inter + JetBrains Mono, Cloudflare/Auth0 visual lane, security-
forward but developer-first, no gradients on text, no stock photos, no
mascots, motion confirms not entertains).

Layout (desktop ≥1024px):
- 12-column grid, 1280px max-width, 64px outer padding
- Left column (cols 1–6): copy + CTAs
- Right column (cols 7–12): a live code sample (see below)
- 96px top padding, 128px bottom padding
- Background: slate-50 with a faint 24px-grid pattern at 4% opacity
- A subtle radial gradient anchored top-right at cerniq-100 → transparent

Copy:
- Eyebrow (text-xs all-caps tracking-wider cerniq-700): "Verification layer"
- H1 (text-6xl tracking-tight font-bold slate-900):
  "Sign every agent action.\nVerify in 80ms.\nHold zero keys."
  (preserve the line breaks; each line is a separate <span> with
  block display)
- Lede (text-lg slate-600, max-width 540px):
  "CERNIQ is the neutral cryptographic gate for AI agents.
  Public-key registry, signed audit chain, policy-bound scopes —
  drop-in SDK for any agent runtime."
- Two CTAs:
  1) Primary: "Read the quickstart" — cerniq-500 bg, white text, ArrowRight icon
  2) Secondary: "View on GitHub" — slate-200 border, GitHub icon
- Below CTAs (32px gap), three small stats in a row:
  · "<80ms p99 verify"
  · "Ed25519, public-key only"
  · "MIT-licensed SDK"
  Each: text-sm slate-500, with a small Lucide icon (Zap, KeyRound, Github)
  in cerniq-500.

Right column code sample:
- Wrapped in a Card with rounded-lg, slate-200 border
- Header strip: filename "agent.ts" left, language label "TypeScript"
  right, both text-xs all-caps tracking-wider slate-500
- Code (JetBrains Mono 14px line-height 24px):

    import { Cerniq } from "@cerniq/sdk";

    const cerniq = new Cerniq({ apiKey: process.env.CERNIQ_KEY });

    // Register an agent (one-time)
    const agent = await cerniq.agents.create({
      runtime: "anthropic",
      model:   "claude-opus-4-5",
    });

    // Sign + verify on every outbound action
    const signed = agent.sign(payload);
    const result = await cerniq.verify(signed);

    if (!result.valid) {
      throw new Error(result.reason); // e.g. SCOPE_NOT_GRANTED
    }

- Highlight lines 9–12 with a 3px cerniq-500 left border
- The tokens "cerniq.verify" and "agent.sign" must render in cerniq-500
  bold-italic
- A copy button (top-right of card) using Lucide ClipboardCopy icon

Mobile (<1024px):
- Stack vertically, code sample below copy
- Hero H1 drops to text-5xl
- Lede stays the same
- Outer padding 16px

Accessibility:
- H1 is a real <h1>, not a styled <div>
- CTAs are <a> with proper href and aria-label
- Code sample has role="region" with aria-label="Integration example"
- All animations honor prefers-reduced-motion

Output a single React component file, default-exported, no comments
beyond what's structurally necessary.
```

### A.2 "How it works" — the 4-layer stack section

```
Build a section titled "The 4-layer stack." Same project + brand foundation
as the hero.

Layout: full-bleed slate-50 background, 96px vertical padding, 1280px
content max-width. Single h2 above a 4-row stack diagram.

Headline (text-4xl tracking-tight slate-900): "Four layers, one verify call."
Subhead (text-lg slate-600 max-width 720px): "Each CERNIQ request runs
through identity, policy, behavioral attestation, and audit — in that
order — then returns a signed verdict."

Below the headline, render the stack as 4 stacked horizontal cards (not
columns). Each card:
- 100% width, 88px tall, rounded-lg, 1px slate-200 border, white bg
- Left side (96px wide): a layer number badge (slate-100 bg, slate-700
  text, text-2xl font-mono "01"–"04") and a Lucide icon (KeyRound,
  ShieldCheck, Activity, FileCheck respectively) at 24px cerniq-500
- Middle: layer name in text-lg font-medium slate-900, and a one-line
  description in text-sm slate-500
- Right side: a small mono code label, e.g. "POST /v1/verify",
  "GET /v1/policies/:id"

The four layers, top to bottom:
1. Agent Identity Core — "Cryptographic identity rooted in Ed25519.
   Public-key registry. Principal binding." → /v1/agents
2. Policy Engine — "Scoped permissions, spend caps, time bounds.
   Signed JWT, cached revocation." → /v1/policies
3. Behavioral Attestation Engine (BATE) — "Trust score 0-1000.
   Velocity, geographic, spend-pattern signals." → /v1/agents/:id/score
4. Audit & Compliance Rail — "Append-only, hash-chained, CERNIQ-signed.
   Exportable as NDJSON for SOC2 / FINRA evidence." → /v1/audit/export

Between cards, render a thin vertical line (1px slate-200) with a small
arrow midpoint.

Below the stack, a final row centered: "All four layers run in <80ms p99."
text-sm slate-500.

Output a single React component, default export.
```

### A.3 Security narrative section

```
Build a "Security model" section.

Layout: split, 12-column grid, 96px vertical padding, slate-50 bg.
Left (cols 1–5): a sticky-on-scroll headline + sub.
Right (cols 6–12): four stacked feature blocks.

Left headline: "We hold public keys.\nThat is the entire database."
(text-4xl tracking-tight slate-900, two lines).
Sub: "Every other claim follows from this." (text-lg slate-500.)

Right blocks — each is a card with rounded-lg, white bg, 1px slate-200
border, 24px padding, 16px gap between cards:

Block 1 — "Non-custodial by design."
  Body: "CERNIQ issues an Ed25519 keypair. The private key is generated
  client-side and stored on the agent host. We register only the public
  key. A breach of CERNIQ does not compromise an agent."
  Footer link: "Read ADR-0002 →" (cerniq-600, text-sm)

Block 2 — "Append-only, signed audit."
  Body: "Every decision writes a hash-chained event. Each event signs
  the previous event's signature. Tampering is detectable in O(n) and
  is enforced as a unit test in CI."
  Footer link: "audit-chain.util.spec.ts →"

Block 3 — "Fixed denial precedence."
  Body: "Nine reasons, ordered most-restrictive first. Relying parties
  always receive the same reason for the same failure. Public API
  contract; minor version bump required to change."
  Footer: a small horizontal flow showing the 10 reasons as text-xs
  badges, separated by chevron icons:
  AGENT_NOT_FOUND → AGENT_REVOKED → INVALID_SIGNATURE → POLICY_REVOKED
  → POLICY_EXPIRED → SCOPE_NOT_GRANTED → TRIAL_EXHAUSTED →
  SPEND_LIMIT_EXCEEDED → TRUST_SCORE_TOO_LOW → ANOMALY_FLAGGED

Block 4 — "Multi-tenant isolation by principal."
  Body: "Every query carries a principalId. Cross-principal data leaks
  fail closed at the service layer. Verified in fuzz tests and
  property-based tests."
  Footer link: "View threat model →"

All Lucide icons: Lock, FileSignature, ListChecks, Users — at 20px
cerniq-500, top-left of each card.

Output one React component.
```

### A.4 Pricing section

```
Build a pricing section. Four tiers, single row on desktop, stacked on
mobile.

Tiers (anchor card 3 as the recommended one — slight cerniq-500
border, "Recommended" pill at top):

IMPORTANT: tier names, prices, and verify-volume gates are not finalized
(BLOCKED ON OPERATOR per CLAUDE.md). Render the cards with placeholder
shapes below; pricing will be backfilled from
docs/spec/04_COMMERCIAL_STRATEGY.md and packages/types/src/pricing.ts
when those land.

1. Free — "$0" — "[N] verifies/mo, [N] agent(s), community support" — CTA "Start free"
2. [TIER 2 NAME] — "$[X]/mo" — "[N] verifies/mo, [N] agents, email support, audit export" — CTA "Start trial"
3. [TIER 3 NAME] — "$[X]/mo" — "[N] verifies/mo, unlimited agents, SSO, [retention], [SLA]" — CTA "Start trial" (RECOMMENDED)
4. Enterprise — "Custom" — "Custom verify volume, on-prem option, custom retention, SOC2 evidence pack, dedicated CSM" — CTA "Contact sales"

When prompting V0/Lovable/Bolt, include the "// FIXME: pricing pending"
comment in the rendered output so reviewers see the placeholder.

Each card:
- white bg, rounded-lg, 1px slate-200 border, 32px padding, 320px height
- Tier name (text-lg font-medium), price (text-3xl font-bold slate-900,
  with /mo in text-sm slate-500), 4–5 feature bullets with Lucide Check
  icon at 16px cerniq-500.
- Recommended card has cerniq-500 1px border, cerniq-50/40 bg tint, and a
  pill at top center: "Recommended" (text-xs all-caps cerniq-700 on cerniq-100).

Above the cards, an h2: "Pricing that scales with verifies, not seats."
Below the cards, a single line in text-sm slate-500: "All tiers are
pre-billed at a TRIAL_EXHAUSTED gate that fires before the standard
denial precedence — see /security#denial-precedence."

Output one React component.
```

### A.5 Footer

```
Build the marketing footer. Stack:
- 5-column grid on desktop: brand block + 4 link columns (Product, Developers,
  Security, Company)
- Each column: text-xs all-caps tracking-wider slate-500 header, then
  text-sm slate-700 links, 12px gap
- Below the columns, a single horizontal divider (1px slate-200), then a
  bottom row: CERNIQ wordmark left, copyright + status pill right.

Status pill: "All systems operational" with a 6px filled emerald-500 dot,
text-xs slate-500. Links to status.cerniq.dev (placeholder).

Links by column:
- Product: How it works, Security, Pricing, Changelog, Roadmap
- Developers: Quickstart, API reference, SDKs, CLI, Examples, GitHub
- Security: Threat model, Denial precedence, Audit chain, Compliance,
  Bug bounty, security@cerniq.dev
- Company: About, Blog, Customers, Careers, Legal, Contact

Brand block (left, span 1 col):
- Wordmark "CERNIQ" (Inter 700 tracking-tight cerniq-500 text-xl)
- One-liner below: "The verification layer for AI agents." (text-sm slate-500)
- Three small social icons (GitHub, X, LinkedIn) in slate-400, 16px

96px top padding, 48px bottom padding, slate-50 bg.

Output a single React component.
```

---

## B. Figma AI / Figma Make prompts

Figma prompts are visual-first. Keep them short, layout-anchored, and
reference-pinned. These produce frames you can hand to a designer or
ship directly.

### B.1 Marketing landing page — full layout

```
Design a marketing landing page for CERNIQ, an AI-agent verification &
attestation infrastructure product. Audience: developers and enterprise
security buyers, developer-first hierarchy. Visual lane: Cloudflare meets
Auth0 — neutral slate palette with a single cyan-blue accent (#06B6D4),
Inter for everything except code, JetBrains Mono for code, no
illustrations of people, no gradients on text.

Page structure (top to bottom):
1. Sticky top nav, 64px tall, white bg with 1px slate-200 bottom border.
   Wordmark left, links center (Product, How it works, Security, Pricing,
   Docs, Blog), two right-aligned actions (Sign in link + "Start free"
   primary button).
2. Hero section, 720px tall, slate-50 bg with a faint 24px grid pattern
   at 4% opacity. Two-column: left = headline / lede / CTAs / stat
   row; right = a code sample card with copy button. See CERNIQ Brand
   Foundation §10 for code sample treatment.
3. Logo cloud strip, 96px tall, white bg, 6 customer/partner logos in
   grayscale at 50% opacity, label "Trusted by" eyebrow above.
4. "How it works" section — 4 horizontal stacked cards representing the
   CERNIQ layer stack (Identity, Policy, BATE, Audit). Each card has a
   layer number, icon, name, one-line description, mono endpoint label.
5. Live-integration section — a wider code sample (full integration in
   ~30 lines) on left, a vertical timeline on right showing what each
   line triggers in the CERNIQ pipeline.
6. Security model section — split layout, sticky headline left, four
   feature cards right (non-custodial, signed audit, denial precedence,
   tenant isolation).
7. Quote block — single dev/security quote in text-2xl slate-700, with
   attribution including company name + role.
8. Pricing section — 4 tiers, recommended tier highlighted with cerniq-500
   border.
9. Final CTA band — slate-900 bg, white text, single h2 "Drop CERNIQ into
   your stack in 10 minutes." with two CTAs.
10. Footer — 5-column links, brand block, status pill.

Use the CERNIQ Brand Foundation tokens (color §4, type §5, spacing §6,
component intent §11). Light mode only for v1. Output the design as a
single 1440px-wide Figma frame with auto-layout on every section, plus
a 375px-wide mobile companion frame.
```

### B.2 Security page

```
Design /security — the page that converts a CISO into a buyer.

Visual register: heavier, more documentation-like than the homepage.
Reads as "this is a control we'd actually evaluate." Use CERNIQ Brand
Foundation, light mode.

Sections:
1. Hero — text-only, 480px tall: "Security is the product." Below it,
   a single paragraph framing why the rest of the page exists.
2. Threat model summary — pulled from `docs/THREAT_MODEL_v2.md` § STRIDE
   table. Render the 31 threats as a compact table: ID, category,
   threat, mitigation, status. Use a status badge (Mitigated, Tracked,
   Out of scope).
3. Denial precedence ladder — a visual ladder of the 10 reasons in fixed
   order, each rendered as a card with: code, name, when-it-fires,
   what-the-RP-shows-the-user. The ladder is the brand's signature
   security visual — make it the most polished element on the page.
4. Audit chain explainer — left: prose; right: a diagram of three
   chained events with arrows showing prev_sig flowing into next event,
   plus a hash-mismatch highlighted in danger color.
5. Key handling — three columns: "We never see private keys", "Public
   keys are stored encrypted at rest", "Rotation is one CLI call".
6. Compliance posture — a table mapping CERNIQ controls to SOC2 CC#,
   ISO 27001 A#, NIST CSF, EU AI Act. Status column: In place /
   In progress / Roadmap. Be honest — pre-launch, most cells are
   "In progress."
7. Reporting + bug bounty — small section with security@cerniq.dev,
   GPG key fingerprint placeholder, response SLA.
8. Footer — same as homepage.

Light mode only. 1440px desktop frame + 375px mobile.
```

### B.3 How-it-works deep-dive

```
Design /how-it-works — the page a senior developer reads after the hero.

Sections:
1. Hero — "Verify, in detail." text-only, slate-50 bg, 360px tall.
2. The request lifecycle diagram — a horizontal swim-lane diagram
   showing 5 actors (Agent, CERNIQ Edge, CERNIQ Origin, Relying Party,
   Audit Sink) and the 8 sequential steps of a verify call, with
   timing annotations (e.g. "12ms" between agent and edge, "30ms"
   for policy lookup, etc.). This is the page's centerpiece — make
   it the most considered diagram in the entire system.
3. Layer-by-layer breakdown — long-form sections for each of the 4
   layers, each with: one-line summary, a code sample showing the
   relevant SDK call, a diagram showing the data shape, and a list
   of denial reasons that originate at that layer.
4. Integration patterns — 3 collapsible cards: SDK pattern, sidecar
   pattern, edge proxy pattern. Each shows a diagram + 1-paragraph
   trade-off summary + link to a docs example.
5. BATE explainer — a half-page block with the trust score gauge
   (0–1000), the 5 input signals as labeled bars, and the formula
   in mono (cite docs/BATE_ALGORITHM.md).
6. CTA band — "Ready to verify your first call?" with quickstart CTA.

Light mode only. 1440px desktop + 375px mobile.
```

---

## C. Designer brief (long-form, for a contract designer or agency)

Use this verbatim when handing off to a human. Trim to fit your engagement
contract.

```
PROJECT: CERNIQ Marketing Site v1 (launch)
CONTEXT: CERNIQ is the neutral verification, policy, and behavioral
attestation layer for AI agents. We sit between AI agents and the
services they act on. We are the "Switzerland" of agent identity —
protocol-, vendor-, and model-neutral. Read `docs/spec/01_MASTER.md`
in the repo before starting.

DELIVERABLES (v1 launch scope):
1. Homepage (/)
2. Security page (/security)
3. How-it-works page (/how-it-works)
4. Pricing page (/pricing)
5. Footer + nav components (used across all pages)
6. Final-CTA band (used across all pages)
7. 404 page
8. Open-graph + Twitter card images for each page
9. Favicon + apple-touch-icon
Each delivered as: Figma file + Figma DEV-mode-ready frames + a
README in the file pointing engineers to the right tokens.

OUT OF SCOPE for v1:
- Customer pages, blog, careers, about — placeholder routing only
- Dark mode (planned for v2; design tokens must support it but no
  dark frames required at this stage)
- Animation choreography beyond the motion principles in the
  Brand Foundation

INPUTS (all in the repo):
- `docs/design/00_BRAND_FOUNDATION.md` — the design contract. Read
  every section. Tokens are non-negotiable; layout patterns are
  guidance.
- `docs/spec/01_MASTER.md` — product positioning and the 4-layer
  stack.
- `docs/THREAT_MODEL_v2.md` — for /security page content.
- `docs/personas/developer.md` and `docs/personas/security.md` — the
  two audiences.
- `docs/BATE_ALGORITHM.md` — for the BATE visual on /how-it-works.

REFERENCE TRIANGULATION:
- Cloudflare's product pages — page rhythm, security narrative cadence,
  enterprise/dev coexistence.
- Auth0's developer site (pre-Okta merger) — code-sample treatment,
  dev/security audience hierarchy.
- Vercel's typographic discipline (in moderation — we are NOT all-black).
- Stripe's pricing page treatment — clarity, no dark patterns.

ANTI-REFERENCES (do not borrow):
- Cloudflare's orange accent
- Any AI-product site with a glowing orb mascot
- Crypto/web3 aesthetic of any kind
- Stock photography of teams, handshakes, server rooms
- Auth0's character illustrations

KEY MESSAGES (in priority order):
1. CERNIQ is non-custodial. We hold public keys only.
2. Verify in <80ms. Drop-in SDK. ~30 lines of integration.
3. Append-only, signed audit chain. SOC2-mappable.
4. Neutral — works with any LLM, any stack, any payment protocol.

HARD CONSTRAINTS:
- Cerniq-500 (#06B6D4) is the only brand accent. No purple, no orange,
  no pink anywhere on the site.
- Inter and JetBrains Mono only. No serifs, no display fonts.
- Code samples are first-class visual elements (see Brand Foundation §10).
  Treat them with the same care as the hero headline.
- Every page must support a screen reader test pass.
- Every page must score ≥95 on Lighthouse Performance, Accessibility,
  Best Practices, SEO at 1440px desktop and 375px iPhone SE.

COPY:
The repo contains canonical product copy in `docs/spec/01_MASTER.md`
and persona docs. Do not paraphrase the technical claims (e.g. "<80ms",
"Ed25519", "10 denial reasons") — the numbers and names are part of the
brand. Marketing copy may be drafted by you and reviewed by us.

PROCESS:
1. Week 1: brand-foundation alignment review (1h call). Critique my
   Brand Foundation doc; flag anything you'd change. We update the
   doc together if needed. From this point on, the doc is locked.
2. Week 2: low-fidelity wireframes for all 4 pages. Async review.
3. Week 3: high-fidelity homepage + footer + nav. Live review.
4. Week 4: high-fidelity security + how-it-works + pricing. Live review.
5. Week 5: polish, OG images, favicon, 404, dev-mode handoff.

SUCCESS METRIC:
A senior security engineer at a SOC2-bound fintech can reach the
/security page, read it in 6 minutes, and forward it to their CISO
with a single sentence of context. If they need to ask us 3+ questions
to understand what we do, the design failed.

BUDGET / TIMELINE: [fill in]
PRIMARY POINT OF CONTACT: [fill in]
```

---

## D. Cursor / Claude Code in-repo prompts

These prompts assume the agent has the CERNIQ repo open and can run pnpm,
edit files, and read `docs/`. They build the marketing site as a real
Next.js app. Tailwind + shadcn must be initialized first; the first
prompt sets that up.

### D.1 Bootstrap the marketing app

```
Goal: scaffold a marketing site app at apps/marketing using Next.js 16
App Router, Tailwind CSS, shadcn/ui, and the CERNIQ design tokens.

Read first:
- /Users/money/Desktop/CERNIQ/CLAUDE.md
- /Users/money/Desktop/CERNIQ/docs/design/00_BRAND_FOUNDATION.md
- /Users/money/Desktop/CERNIQ/apps/dashboard/package.json (mirror Next/React versions)

Tasks:
1. Create apps/marketing/ as a pnpm workspace package, name "@cerniq/marketing".
2. Match Next 16 + React 19 versions from apps/dashboard.
3. Install tailwindcss + @tailwindcss/typography, set up tailwind.config.ts
   with the full CERNIQ color system from §13 of the foundation doc
   (slate ramp + cerniq ramp + semantic) and font stacks from §5.
4. Install shadcn/ui with the new-york style, but override its default
   `primary` color to cerniq-500 and its `radius` to 6px. Initialize only
   these components: Button, Card, Badge, Separator, Sheet (for mobile nav).
5. Add a /lib/seo.ts helper that returns a complete OpenGraph + Twitter
   card payload from a single { title, description, path } object, using
   "CERNIQ — The verification layer for AI agents" as the default suffix.
6. Add a /styles/globals.css that imports Inter (variable) and JetBrains
   Mono via next/font/google, exposes them as CSS vars, and applies the
   §6 base spacing.
7. Add a /components/marketing/ folder with: Header, Footer, FinalCta,
   CodeSample, LayerCard, FeatureCard. Each in its own file.
8. Add a /app/page.tsx that imports those components in the order
   defined in IA above (Hero, LogoCloud, HowItWorks, LiveIntegration,
   SecurityModel, Quote, Pricing, FinalCta).
9. Verify by running `pnpm --filter @cerniq/marketing dev` and confirming
   port 3001 (port 3000 is dashboard).
10. Update WORK_BOARD.md with claim entry + docs/SESSION_HANDOFF.md
    with what shipped.

Constraint: do not invent copy or pricing. All copy must come from
or extend `docs/spec/01_MASTER.md`. All pricing tiers must come from
`docs/spec/04_COMMERCIAL_STRATEGY.md`. If a tier is marked
BLOCKED ON OPERATOR, leave a placeholder + // OPERATOR-INPUT-NEEDED
comment.

Quality bar:
- No `any`. typecheck must pass with --strict.
- Lighthouse ≥95 on every category at /.
- prefers-reduced-motion respected on every animation.
```

### D.2 Build the hero in-repo

```
Goal: implement the hero section in apps/marketing/components/marketing/Hero.tsx.

Read first:
- docs/design/00_BRAND_FOUNDATION.md (§4 color, §5 type, §10 code samples,
  §11 component intent)
- docs/design/01_MARKETING_SITE_PROMPTS.md § A.1 (the layout spec)

Implement:
1. The two-column layout described in § A.1.
2. The CodeSample component should be reusable; export it from
   components/marketing/CodeSample.tsx with props { filename, language,
   code, highlightLines }.
3. The bold-italic on CERNIQ-specific calls is implemented via a custom
   `cerniqHighlight` Prism plugin or a regex-based wrapper that wraps
   `cerniq.\w+` and `agent.sign` in <span class="cerniq-call"> with the
   class styled in globals.css.
4. The grid background uses `background-image: linear-gradient(...)` —
   never an SVG asset. Pure CSS.
5. The radial gradient uses Tailwind's bg-gradient-radial via the
   tailwind-radial-gradient plugin (install it).

Tests (Jest + Testing Library):
- The hero h1 contains "Sign every agent action" in a single <h1> node.
- The CodeSample copy button copies the exact code text to the clipboard
  (mock navigator.clipboard).
- The cerniq-500 calls render with the .cerniq-call class.

Update SESSION_HANDOFF.md when done.
```

### D.3 Build /security in-repo

```
Goal: implement apps/marketing/app/security/page.tsx and its sub-components.

Read first:
- docs/design/00_BRAND_FOUNDATION.md
- docs/design/01_MARKETING_SITE_PROMPTS.md § B.2 (the security page layout)
- docs/THREAT_MODEL_v2.md (source of truth for the threat table)
- docs/SECURITY.md (denial precedence + key handling)

Implement:
1. Page structure exactly as in § B.2.
2. The threat-table data must be loaded from a typed module
   apps/marketing/data/threats.ts that exports `Threat[]`, where each
   row mirrors a row in docs/THREAT_MODEL_v2.md. Do not paraphrase —
   parse the markdown table at build time using a small Node script
   under scripts/build-threats.ts and emit threats.ts. Run the script
   in the prebuild step.
3. The denial-precedence ladder is its own component
   components/marketing/DenialLadder.tsx. The 10 reasons must come from
   packages/types — import the constant. If it doesn't exist there yet,
   add it (this is fine; the foundation says constants live in
   packages/types).
4. The audit-chain diagram is an SVG component
   components/marketing/AuditChainDiagram.tsx. Hand-coded paths, not
   an exported asset.
5. The compliance table is loaded from
   apps/marketing/data/compliance.ts. Cells with status "In progress"
   render with a warning-colored badge; "In place" with success;
   "Roadmap" with a slate badge. Be honest about the current state.

Tests:
- The threat table renders all rows from threats.ts and matches
  docs/THREAT_MODEL_v2.md count exactly.
- The denial ladder renders the 10 reasons in the exact order from
  packages/types.
- Lighthouse Accessibility ≥95.

Update SESSION_HANDOFF.md.
```

### D.4 Live-integration section (the one with the swim-lane diagram)

```
Goal: implement components/marketing/LiveIntegration.tsx and the request-
lifecycle diagram.

Read first:
- docs/design/00_BRAND_FOUNDATION.md (§9 diagrams)
- docs/CERNIQ_AS_BACKBONE.md § 2.3 (the canonical 20-line consumption
  pattern — use it verbatim as the code sample)

Implement:
1. Two-column layout: code sample (uses CodeSample component from D.2),
   timeline on the right.
2. Timeline component: a vertical line with 5 nodes labeled "Agent",
   "Edge verify", "Origin policy", "Relying party", "Audit sink".
   Each node has a connecting branch to a small annotation card
   describing what happens at that step (~20 words).
3. On scroll-into-view, each node fades in 80ms apart (220ms duration,
   the §8 standard easing). Honor prefers-reduced-motion.
4. The "Edge verify" node has a small badge "<80ms p99" — pull this
   string from a constants file so it stays in sync with /security
   and pricing.
5. Below the timeline, a single horizontal line: "Total wall time at
   p99: <80ms. Total signed bytes: 4 events." in text-sm slate-500.

Tests: scroll behavior + the constants are imported, not duplicated.

Update SESSION_HANDOFF.md.
```

### D.5 Pricing in-repo

```
Goal: implement apps/marketing/app/pricing/page.tsx using the canonical
pricing source.

Read first:
- docs/design/01_MARKETING_SITE_PROMPTS.md § A.4
- docs/spec/04_COMMERCIAL_STRATEGY.md (canonical pricing — if any
  tier is BLOCKED ON OPERATOR, leave a placeholder)
- apps/api/prisma/schema.prisma (for the actual plan limit constants
  shipped in code; pricing claims must reflect them)

Implement:
1. Render 4 tier cards. Source data from packages/types/src/pricing.ts.
   If that file doesn't exist, create it.
2. The TRIAL_EXHAUSTED footnote at the bottom must link to
   /security#denial-precedence and the actual ADR (docs/decisions/
   0014-trial-exhausted-precedence.md if it exists; if not, leave a
   placeholder anchor and a // FIXME: link ADR comment).
3. A small comparison table below the cards (collapsible) showing
   feature parity matrix.

Tests: every tier in packages/types/pricing.ts renders as a card; the
recommended tier is determined by an exported `RECOMMENDED_TIER`
constant, not hardcoded in the JSX.

Update SESSION_HANDOFF.md.
```

---

## How to use the four flavors together

Most teams should run them in this order:

1. **Designer brief (C)** — to a contract designer for the high-fidelity
   Figma source of truth.
2. **Figma AI (B)** — to scaffold initial frames _while_ the designer
   is engaged, so engineering isn't blocked.
3. **AI UI tools (A)** — to spike interactive prototypes for stakeholder
   review and to validate copy.
4. **Cursor in-repo (D)** — to implement the final design against the
   designer's Figma file. The prompts in (D) assume tokens already match
   the brand foundation; the designer's Figma file becomes the visual
   QA reference, not the visual source of truth (the foundation doc is).

If you only have time for one flavor: ship **D**. The marketing site
must run on real infra; AI-tool exports are a stepping stone, not a
launch artifact.
