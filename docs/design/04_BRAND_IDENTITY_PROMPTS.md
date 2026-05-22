---
title: OKORO — Brand Identity Design Prompts
audience: image-gen tools, identity designers, in-repo prompts for SVG generation
last-reviewed: 2026-05-08
prerequisites: read `docs/design/00_BRAND_FOUNDATION.md` first
---

# 04 — Brand Identity Prompts

The mark, wordmark, and identity system. This is the layer most
prone to drift if not anchored. The brand-identity track has three
tools where prompts matter:

1. **AI image-gen tools** (Midjourney, Ideogram, DALL-E 3, Recraft) —
   useful for *exploration* of mark concepts, never for shipping
   production assets.
2. **Identity designer (human)** — the only acceptable shipping path
   for the final mark. AI-generated logos read as AI-generated, and
   OKORO cannot afford that on a security product.
3. **In-repo SVG generation** — for the wordmark variants, favicon,
   and the supporting visual system (the OKORO mark as ASCII-style
   pattern, layer-stack diagrams, etc.).

## What the identity must do

1. Read as **infrastructure**, not consumer software. Closer to
   Cloudflare's mark or HashiCorp's marks than to a consumer-AI logo.
2. Carry **the Switzerland thesis** visually — neutral, balanced,
   un-vendor-coded.
3. Look correct at **16px favicon, 64px nav, and 256px deck slide**.
4. Be **monochrome-first** — must work in pure slate-900 / slate-50
   before any color is applied.
5. Avoid every visual cliché OKORO lives next to: shield, lock,
   keyhole, fingerprint, eye, blockchain links, neural-net nodes.
   These are over-mined and under-thought.

## What we already have, and what we don't

Until the identity ships:
- The **wordmark "OKORO"** is set in Inter 700, tracking-tight,
  `okoro-500` color. This is the placeholder.
- There is **no logomark yet**. Surfaces use the wordmark only.
- The **favicon** is a 32×32 SVG of the wordmark "A" cropped to a
  rounded square in `okoro-500`. Placeholder.

The identity work below replaces all three.

---

## A. AI image-gen prompts (exploration only — not for shipping)

Use these in Midjourney v6+, Ideogram, DALL-E 3, or Recraft to
generate concept directions you can show a designer or use as input
for vector tracing. **Do not ship a raster output as a logo.**

### A.1 Mark exploration — the "neutral cipher"

```
A flat vector logomark for an enterprise security infrastructure brand
called OKORO. The mark expresses cryptographic neutrality — a balanced
geometric form constructed from two interlocking primitives that
together form a third, distinct shape. Inspired by the visual logic
of HashiCorp marks and the Möbius-strip discipline of OpenAI's logo,
but without copying either. The mark must read as infrastructure, not
consumer software. Single solid color, no gradients, no shading, no
3D depth. Pure geometric construction on a white background. No text,
no wordmark, no shield, no lock, no keyhole, no fingerprint, no eye,
no neural-net nodes, no blockchain links. Square aspect ratio.
Vector-clean line weight. --style raw --ar 1:1 --v 6
```

### A.2 Mark exploration — the "verifier glyph"

```
A flat vector logomark expressing the concept of "verification by
two parties without revealing the secret." Two abstract geometric
forms — one closed (the held key), one open (the offered claim) —
that together complete a third shape (the verified result) only when
combined. Solid black on white. No literal keys, no padlocks, no
checkmarks. Inspired by the visual restraint of Stripe's M-mark and
Cloudflare's discrete cloud, but distinct from both. Vector clean.
--style raw --ar 1:1 --v 6
```

### A.3 Mark exploration — the "switzerland mark"

```
A flat vector logomark for OKORO, a neutral verification layer for
AI agents. The mark expresses neutrality through perfect bilateral
symmetry — left and right halves identical, neither side dominant.
Constructed from straight lines and 90-degree angles only. Reads as
the punctuation mark for an entire category. Solid slate-900 on
white. No serifs, no decorative elements, no gradients. Inspired by
the discipline of Bauhaus marks. --style raw --ar 1:1 --v 6
```

### A.4 Texture / supporting motif — for hero backgrounds

```
A subtle technical pattern for use as a background texture on a
security-infrastructure marketing site. A faint grid of 24px squares
in a single neutral slate color at 4% opacity, with sparse
intersections marked by a 2px dot in cyan-blue (#06B6D4) at 8%
opacity. The pattern reads as "engineering grid" — restraint, system,
order. White background. Tileable. Vector. --ar 16:9 --v 6
```

### A.5 Process note for the designer

When handing exploratory image-gen outputs to your identity designer,
include this framing verbatim:

```
These are concept seeds, not direction. Use them only as one signal
among many. The Brand Foundation doc (docs/design/00_BRAND_FOUNDATION.md)
is the source of truth. The mark's job is to read as infrastructure
neutrality at 16px, 64px, and 256px. If a seed contradicts the
foundation, discard the seed.
```

---

## B. Figma AI / illustration tool prompts (for the supporting visual system)

These prompts are for Figma AI or Recraft Flow — used to generate the
*non-logo* visual elements of the identity: the diagrams, the layer
stack motif, the data-flow illustrations.

### B.1 The 4-layer stack motif (canonical brand visual)

```
Design a vector illustration of the OKORO 4-layer stack as a brand
motif. This is the most recurrent visual element across marketing,
docs, and the deck — it must be polished beyond any other diagram.

Composition:
- 4 horizontal slabs stacked vertically, each 88px tall × 480px wide,
  with 8px vertical gap between slabs
- Each slab is a rectangle with rounded-md (6px) corners, 1px slate-700
  stroke (light mode) / slate-200 (dark mode), and a 4% slate-900 fill
- Top to bottom: Identity, Policy, BATE, Audit
- On each slab: a layer name label in Inter 600 14px, slate-700 (light)
- The right edge of each slab has a small mono endpoint label
  ("/v1/agents", "/v1/policies", "/v1/agents/:id/score", "/v1/audit"),
  Inter mono 11px, slate-500
- A single vertical okoro-500 line (2px) runs through all 4 slabs at
  x=120px from left, with a 6px filled okoro-500 dot at the midpoint
  of each slab — this represents "the verify hot path" connecting all
  layers
- Below the stack, a single horizontal label in mono "<80ms p99" —
  Inter mono 13px slate-500, centered

Deliverables:
- SVG (light variant)
- SVG (dark variant — invert neutrals, keep okoro-500)
- PNG @1x, @2x, @3x for each variant
- A version with no labels for use as a hero texture
- A simplified favicon-sized version (32×32) showing only the 4
  slabs in slate-700 with the okoro-500 verify line
```

### B.2 Request lifecycle diagram

```
Design a horizontal swim-lane diagram of an OKORO verify request.
This is the centerpiece of /how-it-works on the marketing site
(see docs/design/01_MARKETING_SITE_PROMPTS.md § A.3 / B.3).

Composition:
- 5 horizontal swim lanes, each 64px tall, labeled left:
  Agent, OKORO Edge, OKORO Origin, Relying Party, Audit Sink
- Lane backgrounds alternate slate-50 and white
- 8 sequential steps shown as arrows + small annotations across the
  lanes:
  1. Agent: sign(request)
  2. → OKORO Edge: receive
  3. OKORO Edge: validate signature, fetch policy from cache
  4. (cache miss) → OKORO Origin: fetch policy + BATE
  5. → OKORO Edge: evaluate denial precedence
  6. → Relying Party: signed verdict
  7. → Audit Sink: append signed event
  8. (chain) → Audit Sink: link to prev event
- Time annotations between steps in mono ("12ms", "30ms", etc.)
- The "Edge verify" step has a callout below: "<80ms p99" in mono
  with an okoro-500 underline
- All lines slate-700 1.5px stroke, arrows 6px, no curves except where
  showing a callback (step 8)

Deliverables: SVG light + dark + PNGs.
```

### B.3 Denial precedence ladder

```
Design the canonical denial-precedence ladder visualization. This is
the brand's signature security-narrative visual — present on
marketing /security, docs /reference/denial-precedence, and the deck.

Composition:
- 9 horizontal rows, each 56px tall, stacked vertically
- Each row: a left-aligned mono code (e.g. "AGENT_NOT_FOUND") in
  Inter mono 13px, then a vertical separator (1px slate-200), then
  the human-readable name in Inter 14px slate-700, then a right-
  aligned semantic icon (Lucide UserX, Ban, KeyOff, FileX, FileClock,
  ScanLine, Hourglass, Wallet, BarChart3, AlertTriangle)
- Row backgrounds escalate in subtle red intensity: top (most-
  restrictive) is slate-50, bottom is rose-50 — but very subtle, not
  alarming
- A vertical okoro-500 line (2px) on the left of the ladder labeled
  "Top wins — most-restrictive reason returned"
- Below the ladder, a small note: "Order is fixed. Public API
  contract. Minor version bump required to change."

The 10 reasons in fixed order (do not reorder):
1. AGENT_NOT_FOUND
2. AGENT_REVOKED
3. INVALID_SIGNATURE
4. POLICY_REVOKED
5. POLICY_EXPIRED
6. SCOPE_NOT_GRANTED
7. TRIAL_EXHAUSTED
8. SPEND_LIMIT_EXCEEDED
9. TRUST_SCORE_TOO_LOW
10. ANOMALY_FLAGGED

Note: TRIAL_EXHAUSTED was added 2026-05-05 per ADR-0014, bringing the
canonical chain to 10 reasons. PLAN_LIMIT_EXCEEDED is a separate
pre-algorithm billing gate that fires before this chain — render it
visually distinct (above the ladder, with a divider), not as part of
the 10.

Deliverables: SVG light + dark + PNGs.
```

---

## C. Identity designer brief (long-form)

This is the brief for a contract identity designer. The mark, wordmark,
and the supporting visual system are best shipped by a senior identity
designer, not assembled from AI outputs.

```
PROJECT: OKORO Brand Identity v1
ENGAGEMENT: ~6-8 weeks, mark + wordmark + system
DELIVERABLE FORMAT: Master Figma file + SVG + PNG (favicon, social,
print) + a 12-page brand-guide PDF

CONTEXT:
OKORO is the neutral verification, policy enforcement, and behavioral
attestation layer between AI agents and the services they act on.
We are the "Switzerland of agent identity" — protocol-, vendor-, and
model-neutral. We hold only public keys. We sign only what we observed.
Read `docs/spec/01_MASTER.md` and `docs/design/00_BRAND_FOUNDATION.md`
before starting.

THE IDENTITY MUST DO:
1. Read as infrastructure (Cloudflare/HashiCorp register), not
   consumer-AI (no glow orbs, no anthropomorphic figures, no neon).
2. Carry the Switzerland thesis visually — symmetry, balance,
   neutrality without sterility.
3. Work at 16px (favicon), 64px (nav), 256px (deck), and 4ft (booth
   banner — for future).
4. Survive monochrome (slate-900 on slate-50, and inverse) before any
   color application.
5. Not lean on the worn category clichés: shield, lock, keyhole,
   fingerprint, eye, neural-net nodes, blockchain chains. We have
   already seen them. They are off-limits.

DELIVERABLES:
1. Logomark (the symbol alone) — vector master, with construction grid
2. Wordmark "OKORO" — custom-drawn, not pulled from a typeface;
   tracking, x-height, terminals all considered
3. Combination mark (logomark + wordmark, multiple lockups)
4. Color application — using the Brand Foundation §4 palette only.
   Okoro-500 is the brand's only accent; mark must work without it
   first, and then with it as a single-color application.
5. Clearspace, minimum-size rules, exclusion zones
6. Favicon (16, 32, 192, 512), apple-touch-icon, safari-pinned-tab,
   open-graph image, twitter-card image
7. Brand-guide PDF — 12 pages: mark anatomy, wordmark anatomy, color,
   typography (lifted from Brand Foundation §5, no rework), motion,
   imagery, voice, do/don't, application examples
8. Application examples in the guide: dashboard nav, marketing hero,
   docs header, deck title slide, GitHub social card, conference
   booth banner, T-shirt, sticker

OUT OF SCOPE for v1:
- Animated mark (post-launch consideration)
- Sub-brand identities (e.g. OKORO for Fintech) — not designed yet
- Iconography library — Lucide covers v1; a custom icon set may follow

REFERENCES (study, do not copy):
- HashiCorp suite (Vault, Consul, Terraform) — restraint, geometric
  discipline, infra-grade register
- Cloudflare's word + cloud mark — wordmark drawing quality
- Stripe's M — mark as compressed expression of brand thesis
- OpenAI's blossom — single mark carrying broad meaning
- Bauhaus identity work — geometric construction, grid logic

ANTI-REFERENCES:
- Any consumer AI brand mark of the past 3 years (orb, gradient,
  blob, "magic" sparkle)
- Crypto/web3 marks (chain links, abstract Ξ-style geometry)
- Security-industry clichés (shields, locks, keyholes, fingerprints,
  eyes)

CONSTRAINTS ON THE WORDMARK:
- All-caps "OKORO" is preferred — reads more institutional.
  Lowercase variant must also be drawn for documentation contexts.
- The wordmark must not depend on the logomark to be legible — they
  must work independently.
- Letterforms should reference the precision of Inter (the brand's
  body face) without being a direct lift from it. Custom is required.

PROCESS:
- Week 1: discovery + reference review + initial mark sketches
  (3-5 directions in low fidelity)
- Week 2: live review, narrow to 2 directions
- Week 3: refinement of 2 directions
- Week 4: final selection + wordmark drawing
- Week 5: combination mark + lockups + color application
- Week 6: brand guide assembly + favicon/social/print outputs
- Week 7-8: revisions, final delivery

PRESENT WORK AS:
- Each round: vector master, application mockups (favicon, nav,
  deck slide, conference banner), monochrome test, 16px legibility test
- Final: a single Figma file with all artwork + a navigable brand
  guide PDF + the asset zip

SUCCESS METRIC:
A senior security engineer at a Fortune 500 sees the mark in the wild
(GitHub README badge, conference talk slide, RFC author bio) and
recognizes it as infrastructure-grade. If they think "AI-generated" or
"consumer," the work failed.

BUDGET: [fill in — for context, identity at this register typically
runs USD 35–75k for a senior independent or 80–150k for a small studio]
PRIMARY POINT OF CONTACT: [fill in]
```

---

## D. Cursor / Claude Code in-repo prompts (for the supporting visual system, not the mark)

Use these only for the system around the mark: SVG icon generation,
favicon assembly, OG-image rendering, social-card templates. The mark
itself is the designer's deliverable; we wire it in.

### D.1 Wordmark + favicon SVG components

```
Goal: ship the placeholder wordmark and favicon as SVG components in
packages/ui-brand (a new package), and consume them across apps/
dashboard, apps/marketing, apps/docs.

Read first:
- docs/design/00_BRAND_FOUNDATION.md
- docs/design/04_BRAND_IDENTITY_PROMPTS.md (this file)

Tasks:
1. Create packages/ui-brand as a workspace package.
2. Add Wordmark.tsx — renders "OKORO" in Inter 700 tracking-tight
   okoro-500. Props: size ('sm'|'md'|'lg'), monochrome (boolean),
   inverted (boolean for dark surfaces).
3. Add Mark.tsx — renders the placeholder logomark, which until the
   identity ships is the 4-layer stack visualization (4 small
   horizontal slabs with the okoro-500 vertical verify line). When the
   real mark arrives, this file is the only place to update.
4. Add Logo.tsx — combination mark (Mark + Wordmark) with the standard
   lockup.
5. Add a /brand directory at the package root with the SVG sources for
   each.
6. Generate /favicons/ via a build script: 16, 32, 192, 512 PNG +
   favicon.ico + apple-touch-icon + safari-pinned-tab + maskable icon
   (for PWA support).
7. Wire packages/ui-brand into apps/dashboard, apps/marketing, apps/docs.
   Replace any existing inline wordmarks with <Wordmark /> imports.
8. Update WORK_BOARD.md and docs/SESSION_HANDOFF.md.

Constraint: when the real mark ships, only Mark.tsx and the SVGs in
/brand should change. The exported API surface (props, sizes,
combination lockup) must remain stable.

Quality: SVGs lint clean (no fill="#000000" hardcodes — use
currentColor or token-bound CSS vars), all components default to
currentColor for monochrome use.
```

### D.2 OpenGraph + Twitter card generator

```
Goal: a build-time script that generates OG/Twitter cards for every
marketing and docs page using a single template + dynamic title.

Read first:
- docs/design/04_BRAND_IDENTITY_PROMPTS.md (this file)
- @vercel/og-image library docs

Tasks:
1. Add scripts/generate-og.ts in apps/marketing and apps/docs.
2. The template:
   - 1200×630 canvas, slate-50 bg with the §B.1 grid texture
   - Top-left: OKORO wordmark in okoro-500 (40px tall)
   - Center: page title in Inter 700 60px tracking-tight slate-900,
     wrapped to max 2 lines, max 800px wide
   - Below title: page description in Inter 400 24px slate-600, max
     2 lines
   - Bottom row: a small 4-layer-stack mark on the left, "okoro.dev"
     in mono on the right
3. The script reads each MDX/page's frontmatter (title, description)
   and renders an OG image to public/og/<slug>.png at build time.
4. Each page's <head> wires <meta property="og:image"> + Twitter card
   meta to the generated path.
5. Every page must have an OG image; fail the build if any page lacks
   one.

Tests: snapshot a generated PNG for stability; the build script fails
when frontmatter is missing.

Update SESSION_HANDOFF.md.
```

### D.3 GitHub social card

```
Goal: a single 1280×640 PNG used as the GitHub repo social card for
each OKORO public repo.

Tasks:
1. Add scripts/generate-github-social.ts at the repo root.
2. The card:
   - slate-950 bg
   - Center-left: OKORO wordmark in okoro-300 (lighter ramp for dark
     surface), 56px tall
   - Below wordmark: repo name in Inter mono 32px slate-200
   - Below repo name: the repo's tagline (from package.json description)
     in Inter 400 24px slate-400, max 2 lines
   - Center-right: the 4-layer stack mark in slate-700 with okoro-300
     verify line, 240px tall
   - Bottom-left: "github.com/okoro" in Inter mono 16px slate-500
3. Run the script for every public package and write to .github/social/.
4. Add a Makefile target `make social` that re-runs the script.

Update SESSION_HANDOFF.md.
```

---

## How to use the four flavors together — identity edition

Identity is the single track where flavors are NOT interchangeable:

- **A (image-gen)**: exploration only. Use for at most a 2-day
  exploratory phase before brief-out. Never ship a logo from this.
- **B (Figma AI / Recraft)**: ship the supporting visual system
  (the diagrams, the OG-image template, the layer-stack motif).
  Acceptable as the final pipeline for these.
- **C (designer brief)**: the only acceptable path for the mark,
  wordmark, and brand guide. Anything else cheapens the brand.
- **D (in-repo)**: ships the engineering wiring around the
  designer's work. Build it now with placeholders so the day the
  designer ships, integration is mechanical.

Sequence:
1. Now: ship D (placeholder wordmark + favicons + OG generator) so
   the rest of the launch can proceed.
2. Now: ship B (4-layer stack motif, denial-precedence ladder,
   request-lifecycle diagram) — these are needed across marketing
   and docs and are independent of the mark.
3. Day-of-engagement: hand C to the identity designer.
4. Day-of-mark-delivery: swap Mark.tsx and the brand SVGs in
   packages/ui-brand. Everything downstream re-renders.
