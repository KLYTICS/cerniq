# CERNIQ — Brand & Design System v1.0

> **Direction:** Cinematic immersive
> **Ecosystem strategy:** Standalone-but-compatible
> **Owns:** the hexagonal Cerniq Shield mark, the aurora gradient, the Verified Light palette
> **Shares with the broader portfolio:** type stack, motion curve, 8pt grid, dark-canvas convention

---

## What's in this folder

| File                         | What it is                                                                                                    | Hand to                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `01_BRAND_BRIEF.docx`        | 29-page master brand brief — strategy, 12 benchmark studies, voice, page-by-page UX patterns, ecosystem rules | Designer / stakeholder             |
| `02_design-tokens.json`      | W3C-format design tokens. Colors, type, spacing, motion. Source of truth.                                     | Eng / tooling                      |
| `03_design-tokens.css`       | Same tokens as CSS custom properties. Drop straight into any project.                                         | Frontend eng                       |
| `04_style-guide.html`        | Single-file living style guide. Open in browser.                                                              | Everyone                           |
| `logos/01-shield.svg`        | **Recommended primary mark** — the Cerniq Shield                                                              | Default everywhere                 |
| `logos/02-halo.svg`          | Alternate — abstract, infrastructure-feeling                                                                  | SDK / CLI surfaces                 |
| `logos/03-northstar.svg`     | Alternate — editorial, neutrality metaphor                                                                    | About / mission pages              |
| `logos/04-lattice.svg`       | Alternate — hash-chain motif                                                                                  | SDK / docs / sticker pack          |
| `logos/05-verified-mark.svg` | Verification badge motif                                                                                      | Inline "Verified by CERNIQ" badges |
| `logos/wordmark-primary.svg` | Horizontal lockup with shield + CERNIQ wordmark                                                               | Marketing default                  |
| `logos/wordmark-stacked.svg` | Vertical lockup, descriptor below                                                                             | Social avatars, app icon           |
| `v0-archive/`                | Original v0 brand work, preserved                                                                             | Reference only                     |

---

## Ten-second pitch

CERNIQ owns one architectural metaphor: **Verified Light** — a near-black canvas (Obsidian, Ink, Steel) with a single beam of cyan-violet light (the aurora gradient) used like a key light, never as a fill. Type is three-voiced: tight technical sans for UI, humane sans for body, editorial serif italic for the once-per-page emotional moment. Motion is one curve — `cubic-bezier(0.16, 1, 0.3, 1)` — the Apple/Linear ease-out-expo. Movement should feel inevitable, not animated.

The recommended primary mark is the **Cerniq Shield** — a hexagonal stability with a single audit-chain bisector and the letter A in negative space. It's the one to ship.

---

## Drop-in sequence (fastest path to a branded surface)

```html
<!-- 1. In your <head>, add the tokens stylesheet -->
<link rel="stylesheet" href="/path/to/03_design-tokens.css" />

<!-- 2. On <body>, add the cerniq class -->
<body class="cerniq">
  <!-- 3. Use the tokens -->
  <button
    style="background: var(--cerniq-gradient-aurora); color: var(--cerniq-obsidian);
               padding: 12px 20px; border-radius: var(--cerniq-radius-sm);
               font-family: var(--cerniq-font-body); font-weight: 600;"
  >
    Verify identity
  </button>
</body>
```

That's it — you're on-brand. For the full vocabulary of components, open `04_style-guide.html`.

---

## Voice rules — the short version

- **Cryptographic, never magical.** Don't say "AI-powered." Say "Ed25519 signature over the canonical request body."
- **Neutral, not bland.** Switzerland is the metaphor. Neutrality is a stance, not an absence of voice.
- **Technically literal, occasionally human.** 90% surgical sans. 10% editorial serif italic. The serif is when CERNIQ exhales.
- **Quiet confidence, not bravado.** Never "world-class," "best-in-class," "enterprise-grade." Show the architecture instead.

Tagline (recommended): **Verified. Or it didn't happen.**

---

## Implementation order

**Phase 1 (this week):**

1. Drop `03_design-tokens.css` into `apps/dashboard`. Apply `class="cerniq"` to root.
2. Replace existing logo references with `logos/01-shield.svg` and `logos/wordmark-primary.svg`.
3. Build the homepage hero per the spec in section 08 of the brief.
4. Audit existing UI; replace any off-token components with the four button variants and three card variants.

**Phase 2 (next two weeks):** Docs three-pane, verify-log dashboard view, commission the 3D hero render.
**Phase 3 (month two):** Pricing page, security & trust page, status subdomain.

Full sequence + open operator decisions in `01_BRAND_BRIEF.docx`, section 10.

---

## Open operator decisions (from CLAUDE.md `BLOCKED ON OPERATOR`)

1. **Tagline primary** — recommended: _"Verified. Or it didn't happen."_ Confirm or veto.
2. **Domain** — `cerniq.dev` / `cerniq.id` / something else. Affects wordmark length + lockup proportions.
3. **3D hero render budget** — commission a freelancer (~$3-8K), AI-generate, or ship with the SVG mark animated. Recommendation: commission. Reuses on homepage, social, README, sales decks.

---

## Notes for housekeeping

- **`_build/` directory** — created during DOCX generation, contains a node_modules tree from `docx-js`. Safe to delete (`rm -rf _build` once you have shell perms; the brief is already generated and committed in `01_BRAND_BRIEF.docx`).
- **`v0-archive/`** — earlier brand pass (different palette: `#1340C4` blue + `#0A0E27` near-black, plus a different shield treatment). Kept on file in case any of it is useful for sub-brand exploration.

---

## Verification before any external surface ships

- [ ] All hex values trace back to `02_design-tokens.json`
- [ ] All dimensions are multiples of 4 (preferably 8)
- [ ] Maximum one aurora gradient per page
- [ ] Maximum one editorial serif moment per page
- [ ] `prefers-reduced-motion` respected
- [ ] Focus rings visible on every interactive element
- [ ] Halo on Obsidian contrast ≥ 7:1 (default is 18:1 — never accept worse)

---

_CERNIQ · Brand v1.0 · 2026-05-05 · Authored for Erwin Kiess-Alfonso_
