---
title: AEGIS — Design Prompt Library
audience: every Claude session, designer, and contractor designing an AEGIS surface
last-reviewed: 2026-05-08
status: source-of-truth
---

# AEGIS Design Prompt Library

The set of prompts and briefs that take AEGIS from "shipping engineering"
to "shipping a product." Anchored to a single brand foundation; structured
so any surface (marketing, dashboard, docs, identity, deck) can be shipped
through one of four prompt flavors:

- **A. AI UI tools** (V0, Lovable, Bolt) — code-emitting prompts
- **B. Figma AI / Figma Make** — design-frame-emitting prompts
- **C. Designer brief (human)** — long-form briefs for contract designers
- **D. Cursor / Claude Code in-repo** — repo-aware prompts that produce
  real code in `apps/*`

## Files

| File | Role |
|---|---|
| `00_BRAND_FOUNDATION.md` | The upstream contract. Tokens, voice, principles. Everything below references this. |
| `01_MARKETING_SITE_PROMPTS.md` | Landing page, /security, /how-it-works, /pricing, footer. |
| `02_DASHBOARD_PROMPTS.md` | The developer dashboard at apps/dashboard — agents, policies, audit, BATE, billing. |
| `03_DOCS_SITE_PROMPTS.md` | docs.aegis.dev — quickstart, concepts, API ref, guides, integrations. |
| `04_BRAND_IDENTITY_PROMPTS.md` | Logo/wordmark/mark + the supporting visual system (recurring diagrams). |
| `05_PITCH_DECK_PROMPTS.md` | Investor + enterprise sales decks. |

## Read order (first time)

1. `00_BRAND_FOUNDATION.md` — read end-to-end. It locks tokens and voice;
   nothing in `01_*` through `05_*` makes sense without it.
2. The surface file you need.
3. The flavor section (A / B / C / D) for the prompt-target you'll use.

## Pick the right flavor

| You are... | Use |
|---|---|
| ...exploring a layout idea solo at 11pm | A (AI UI tools) |
| ...trying to ship a real Next.js page in apps/marketing | D (Cursor in-repo) |
| ...handing visual work to an agency or a senior designer | C (designer brief) |
| ...scaffolding initial design frames in Figma so engineers aren't blocked while a designer is engaged | B (Figma AI) |
| ...generating a first-draft deck for an investor call this week | A or D (deck), then refine |

## Pick the right ship order

If you're going live in the next 8 weeks, run the surfaces roughly in
parallel like this:

```
Week 1     Brand Foundation locked + identity designer kicked off (C from 04)
           Marketing Tailwind + tokens scaffolded in apps/marketing (D from 01)
           Dashboard Tailwind + tokens scaffolded in apps/dashboard (D from 02)
           Docs Nextra scaffolded at apps/docs (D from 03)

Week 2-3   Marketing homepage + /security + /how-it-works (D from 01)
           Dashboard component library + Overview + /agents (D from 02)
           Docs landing + Quickstart + first concept page (D from 03)
           Investor deck draft .pptx via pptx skill (D from 05)

Week 4-5   Marketing /pricing + footer + final-CTA polish
           Dashboard /audit + /policies + /quickstart wizard
           Docs API ref auto-generation + search wiring
           Identity designer ships drafts; supporting visual system from B (04)

Week 6     Identity designer final delivery; swap Mark.tsx in packages/ui-brand
           Decks designer polish pass (C from 05)
           Compliance + accessibility audit pass on every surface

Week 7-8   Bug-bash, performance, Lighthouse pass, accessibility pass
           Soft launch, design partner onboarding, public launch
```

Two surfaces are launch-critical and should not slip:
- Marketing /, /security, /how-it-works
- Dashboard component library, Overview, /agents, /audit

Two surfaces matter but can ship 30-60 days post-launch:
- Docs (functional MDX is enough at launch; full polish can follow)
- Decks (a programmatic v1 is fine; designer polish can come later)

One surface (identity) is the longest tail — kick it off at week 1
because shipping with placeholder marks is acceptable but living with
them long-term is not.

## Quality bar (mirrors `CLAUDE.md` § Quality bar)

Every surface ships only if it clears these gates:

- **Lighthouse** ≥95 across Performance / Accessibility / Best Practices /
  SEO at desktop 1440px and mobile 375px (≥98 for docs).
- **a11y**: WCAG 2.2 AA. Real screen-reader pass on hero + one detail
  page per surface.
- **Type strictness**: no `any`. Tokens never hardcoded outside the
  brand foundation.
- **No fabricated data**: pricing, traction numbers, compliance status,
  customer logos all come from canonical sources or are clearly placeholdered.
- **Motion respects `prefers-reduced-motion`** everywhere.

## Anti-patterns (forbidden across all surfaces)

These will be visible, public mistakes if they ship; flag them in any
review:

- Stock photography of teams, handshakes, server rooms
- AI-generated photoreal imagery on production surfaces
- Mascot or anthropomorphic-agent illustrations
- Glow orbs, neon gradients, "magic sparkles"
- Multiple brand accent colors (aegis-500 is the only one)
- Crypto / web3 visual cues (chain links, abstract Ξ, gradient orbs)
- Security clichés (shield, padlock, fingerprint, eye)
- Bullet-pointed prose where paragraphs would be clearer
- Hardcoded hex colors anywhere (always tokens)
- Any claim that AEGIS holds private keys (we do not — invariant 1
  in CLAUDE.md)
- Any claim that we are an "identity provider" or "single source of truth"
- Any animation longer than 320ms or with bounce/elastic easing

## When something contradicts this library

The hierarchy is:

1. `CLAUDE.md` (architectural invariants, the contract)
2. `docs/design/00_BRAND_FOUNDATION.md` (visual contract)
3. The relevant surface file (`01_*` through `05_*`)
4. The prompt-flavor section within the surface file

If you find a contradiction, fix the higher-priority doc first, then
propagate down. Drop a note in `docs/SESSION_HANDOFF.md` so other
sessions know.

## Updating this library

This library is v1. Bump versions on the foundation doc; surface files
don't carry a version of their own — they always reference foundation v1+.
When the foundation bumps to v2 (visual lane shift), surface files get
a small migration section noting what changed.

Add new surface files as `06_*`, `07_*`, etc. Suggested next additions
when needed:
- Status page (`statuspage.aegis.dev`) — small surface, can live in 01
  for v1
- Email templates (transactional + onboarding) — when product growth
  emails ship
- Conference / booth materials — when AEGIS goes physical

## When in doubt

Read in this order: `CLAUDE.md` → `docs/design/00_BRAND_FOUNDATION.md`
→ the surface file → the relevant section. Then prompt.
