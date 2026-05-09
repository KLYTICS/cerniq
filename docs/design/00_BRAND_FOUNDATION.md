---
title: AEGIS — Brand & Design Foundation
audience: every Claude session, designer, contractor, and AI tool that produces an AEGIS surface
last-reviewed: 2026-05-08
status: source-of-truth — every design prompt in this folder references this doc
---

# 00 — Brand & Design Foundation

> This is the upstream contract. Every prompt in `docs/design/01_*` through
> `docs/design/05_*` says "follow `00_BRAND_FOUNDATION.md`" instead of
> repeating tokens, voice, or principles. Update here, propagate everywhere.

---

## 1. Positioning — what every surface must communicate

### 1.1 The one-liner

**The neutral verification, policy, and attestation layer for AI agents.**

If a surface uses one sentence, it is that sentence. Variants for context:

- Developer-facing: *"Verified agent identity and signed audit in <80ms.
  Drop-in SDK. Zero key custody."*
- Security-buyer-facing: *"Cryptographic gate for agent actions. Public-key
  only. Append-only audit. SOC2-bound."*
- Investor-facing: *"The Switzerland of agent identity — protocol-, vendor-,
  and model-neutral. Verification choke point for every agent transaction."*

### 1.2 The three claims we earn the right to make

Every surface should make these visually true, not just textually claimed:

1. **Neutral.** No vendor lock-in. Works with Claude, GPT, Gemini, custom LLMs;
   plugs into ACP, MCP, OAuth, Auth0; runs in any stack.
2. **Non-custodial.** AEGIS holds public keys only. Private keys live with
   the agent. A breach of AEGIS does not compromise an agent.
3. **Verifiable.** Every decision is signed; every audit event is
   hash-chained. The relying party can prove what happened without
   trusting AEGIS.

If a hero image, diagram, or copy block doesn't reinforce one of these three,
cut it.

### 1.3 What AEGIS is **not** (anti-positioning)

Surfaces must never imply any of the following — they are competitor
ground or wrong-shape framing:

- *"Single source of agent truth"* — we are a verifier, not an authority
- *"Manage your agent's keys"* — we never hold private keys, ever
- *"Replace Auth0/Okta"* — we plug into them; human IAM is their lane
- *"AI security"* in the prompt-injection / red-team sense — that's the
  agent runtime's problem, not ours
- *"Blockchain"* anything — Ed25519 + signed audit ≠ blockchain, do not
  conflate

---

## 2. Voice & tone

### 2.1 Voice (constant)

- **Precise.** Numbers over adjectives. "<80ms p99" beats "fast."
- **Cryptographically grounded.** When we describe a guarantee, we name
  the mechanism. "Append-only audit (Ed25519-signed hash chain)" not
  "tamper-proof logs."
- **Confident, not boastful.** State what AEGIS does. Skip "industry-
  leading," "best-in-class," "revolutionary."
- **Builder-respectful.** The reader is a senior engineer or security
  lead. Don't over-explain primitives they know. Do over-explain the
  AEGIS-specific shape (denial precedence, BATE, principal binding).

### 2.2 Tone (varies by surface)

| Surface | Tone | Example phrasing |
|---|---|---|
| Marketing hero | Quietly confident, builder-flavored | "Sign every agent action. Verify in 80ms. Hold zero keys." |
| Marketing security page | Sober, control-mapped | "Layer 7 cryptographic gate. Public-key registry. Hash-chained audit. SOC2-mapped." |
| Dashboard | Neutral, operational | "Agent revoked at 14:02 UTC. 3 in-flight verifies returned `AGENT_REVOKED`." |
| Docs quickstart | Direct, imperative, terse | "Install the CLI. Authenticate. Run `aegis doctor`. Verify your first call." |
| Pitch deck | Strategic, market-aware | "ACP solved payments. AEGIS solves the verification gap Stripe explicitly left to implementers." |
| Error message | Factual, action-pointing | "`SCOPE_NOT_GRANTED` — policy `pol_01H...` does not include scope `payments.transfer`. Add it via dashboard or `aegis policy edit`." |

### 2.3 Word choices

- **Use:** *agent*, *principal*, *relying party*, *verify*, *attest*, *sign*,
  *revoke*, *scope*, *policy*, *audit chain*, *trust score*.
- **Avoid:** *passport* (we are not), *identity provider* (we are not),
  *AI safety* (different problem), *blockchain*, *web3*, *bulletproof*,
  *military-grade*, *unhackable*, *cutting-edge*.
- **House style:** "AEGIS" is always all-caps in body text. SDK package is
  lowercase `@aegis/sdk`. Endpoints are mono: `POST /v1/verify`.

---

## 3. Visual lane — Cloudflare / Auth0 (security-forward, neutral)

### 3.1 The reference triangulation

The brand sits at the intersection of three reference points:

1. **Cloudflare** — the page architecture, the security narrative cadence,
   the "infra you trust by default" tone, the way they move from product
   page → security page → docs without changing register.
2. **Auth0** — the dual developer/security audience hierarchy, the way
   code samples and compliance badges coexist on the same page.
3. **Vercel** (small dose) — the typographic discipline and command-palette
   energy in the dashboard, but **without** the all-black aesthetic;
   AEGIS reads as more enterprise than indie-hacker.

### 3.2 Things we deliberately *don't* take from references

- Cloudflare's orange — we use a controlled blue/teal palette
- Auth0's mascot illustrations — we use technical diagrams, not characters
- Vercel's full-black — we ship light + dark, light is the default for
  marketing/docs, dark is the default for dashboard

---

## 4. Color system

All colors are tokens. Never hardcode hex outside the foundation file.
Tailwind class names below assume the standard palette extension.

### 4.1 Core neutral ramp (the spine)

The brand is 80% neutral. Color carries semantic weight precisely *because*
it's rare.

```
slate-50  #F8FAFC   page background (light)
slate-100 #F1F5F9   card background (light), subtle dividers
slate-200 #E2E8F0   borders (light)
slate-400 #94A3B8   secondary text (light), borders (dark)
slate-500 #64748B   tertiary text
slate-700 #334155   body text (light)
slate-900 #0F172A   headings (light), surface (dark)
slate-950 #020617   page background (dark)
```

### 4.2 Brand accent — "Aegis Blue"

```
aegis-50  #ECFEFF   tint, subtle highlight backgrounds
aegis-100 #CFFAFE   hover tint
aegis-300 #67E8F9   accents in dark mode
aegis-500 #06B6D4   primary brand — buttons, links, focus rings
aegis-600 #0891B2   primary hover
aegis-700 #0E7490   primary pressed
aegis-900 #164E63   deep brand (illustrations)
```

Aegis Blue is **only** used for: primary CTA, the AEGIS wordmark,
focus ring, the "verified" semantic, hero accent shapes, the active
nav indicator. It is **not** a body-text color.

### 4.3 Semantic ramps

```
success: emerald-500 #10B981  — "verified", "active", spend within cap
warning: amber-500   #F59E0B  — "expiring", "trust score declining"
danger:  rose-500    #F43F5E  — "revoked", "denied", "anomaly"
info:    aegis-500            — same as brand; use sparingly
```

Do not use red for anything that isn't a denial / revocation. Reserved
visual real estate.

### 4.4 Dark mode

The dashboard and docs ship light + dark. Marketing ships light only at
launch (dark mode adds polish but isn't shipping-critical). Dark mode
swaps the neutral ramp inverted; brand and semantics keep their hue but
shift one step (e.g. aegis-500 → aegis-300 on dark surfaces) for AA
contrast.

### 4.5 Forbidden colors

- Pure black (#000000) — too harsh, use slate-950
- Pure white (#FFFFFF) — too clinical, use slate-50 in light mode and
  slate-50/95 with backdrop-blur for elevated surfaces
- Saturated purple, magenta, lime — off-brand for a security product
- Gradients on text — never. Solid color only.

---

## 5. Typography

### 5.1 Type stack

```
Display & headings: Inter, ui-sans-serif, system-ui, sans-serif
Body:               Inter, ui-sans-serif, system-ui, sans-serif
Mono:               JetBrains Mono, ui-monospace, SFMono-Regular, monospace
```

Inter is the workhorse. JetBrains Mono is mandatory for: code samples,
endpoint paths, agent IDs, signatures, audit-event hashes. Mono in the
right place is a security-trust signal.

### 5.2 Scale (modular, 1.25 ratio anchored at 16px)

```
text-xs    12px / 16px  — labels, table column headers, badges
text-sm    14px / 20px  — secondary UI text, table rows
text-base  16px / 24px  — body
text-lg    18px / 28px  — lede paragraphs
text-xl    20px / 28px  — sub-headings (h3)
text-2xl   24px / 32px  — section headings (h2)
text-3xl   30px / 36px  — page titles
text-4xl   36px / 40px  — hero sub
text-5xl   48px / 52px  — hero head (mobile)
text-6xl   60px / 64px  — hero head (desktop)
```

### 5.3 Weight discipline

- Body: 400
- Strong: 500 (not 600 — too heavy in Inter)
- Headings: 600 for h2/h3, 700 for h1 and hero only
- Mono: 400 always — bolded mono looks broken

### 5.4 Letter-spacing

- Headings ≥ text-3xl: `tracking-tight` (-0.02em)
- All-caps labels (eyebrows, badges): `tracking-wider` (+0.06em),
  `font-medium`, `text-xs`
- Body and code: default (0)

### 5.5 Anti-patterns

- No script, serif, or display fonts. Inter only.
- No font-size below 12px anywhere, ever.
- No more than 75 characters per line in body copy.
- No `text-decoration: underline` for emphasis — only on links.

---

## 6. Spacing, grid, density

### 6.1 Spacing scale (4px base)

```
0.5  →  2px
1    →  4px
2    →  8px
3    →  12px
4    →  16px
6    →  24px
8    →  32px
12   →  48px
16   →  64px
24   →  96px
32   →  128px
```

Marketing pages live at 16/24/48/96. Dashboard lives at 4/8/16/24.
Density is the loudest visual signal of "marketing" vs "tool."

### 6.2 Grid

- Marketing: 12-column, 1280px max-width, 24px gutter, 16px outer padding
  on mobile, 64px on desktop.
- Dashboard: fluid, no max-width below 1920px, sidebar 240px (desktop),
  content area uses 16px gutter at 8-column grid.
- Docs: 3-column on desktop (left nav 240px, content max-width 720px,
  right rail 240px for "On this page"). Single column ≤1024px.

### 6.3 Radius

```
rounded-none    0px    table cells, code blocks
rounded-sm      4px    inputs, badges, small buttons
rounded-md      6px    buttons, cards, dropdowns (default)
rounded-lg      8px    modals, large cards
rounded-xl      12px   hero panels, marketing feature cards
rounded-full           avatars, dots, pills
```

Never `rounded-2xl` or higher — reads consumer/playful, off-brand.

### 6.4 Shadows

Three elevation tiers, all neutral (no colored shadows):

```
shadow-sm   0 1px 2px rgba(15,23,42,0.06)         resting
shadow-md   0 4px 12px rgba(15,23,42,0.08)        hover, dropdowns
shadow-lg   0 12px 24px rgba(15,23,42,0.10)       modals, command palette
```

In dark mode, shadows weaken to barely-visible — depth comes from
border-color contrast instead.

---

## 7. Iconography

### 7.1 Library

**Lucide** (https://lucide.dev) is the canonical icon set. 1.5px stroke,
24px default. No filled icons except for status dots.

Approved exceptions (security/crypto-specific):
- **Phosphor** for `Key`, `Fingerprint`, `Shield`, `Certificate` if Lucide
  alternatives feel weak
- Custom SVGs for: AEGIS mark, denial-precedence ladder, BATE score gauge

### 7.2 Style rules

- Stroke: 1.5px (never 2px — too heavy, never 1px — too thin)
- Color: inherit from parent text-color; only colored when conveying
  semantic state (success/warning/danger)
- No icons inside body paragraphs — only in nav, buttons, badges, lists
- Always paired with a text label, except in icon-only buttons that
  have an `aria-label`

### 7.3 The AEGIS mark

The wordmark and mark are designed in `04_BRAND_IDENTITY_PROMPTS.md`.
Until that ships, surfaces use the wordmark "AEGIS" set in Inter 700,
tracking-tight, with `aegis-500` color, no logomark.

---

## 8. Motion

### 8.1 Principles

- **Motion confirms; it does not entertain.** Every animation must
  communicate state change (loading, success, hover, page transition).
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` for enter, `cubic-bezier(0.4, 0, 1, 1)`
  for exit. Never linear unless it's a progress bar.
- **Duration:** 150ms for micro (hover, focus), 220ms for component
  transitions, 320ms for page-level. Anything ≥500ms feels broken.
- **No bounce, spring overshoot, or elastic.** Reads consumer/playful.
- **Respect `prefers-reduced-motion`.** Replace all transitions with
  instant state change.

### 8.2 Approved patterns

- Button press: 100ms scale 0.98, then back
- Card hover: 150ms shadow-sm → shadow-md, 1px translate-y
- Toast: 220ms slide-in from top-right with 8px offset
- Page transition (Next.js): 220ms opacity 0 → 1 + 4px translate-y
- Audit log new event: 320ms fade-in row with 1px aegis-500 left border
  pulse (2 cycles, then fade)

### 8.3 Forbidden

- Confetti, fireworks, particles, hover-glow halos
- Auto-playing video on hero
- Parallax scrolling
- Cursor-following effects
- Marquee / continuous scrollers (logo cloud allowed if 30s+ duration
  and reduced-motion stops it)

---

## 9. Imagery & illustration

### 9.1 What we use

- **Technical diagrams.** Lines, boxes, labels, arrows. Drawn in Figma,
  exported SVG. No raster.
- **Code samples.** Treated as a first-class visual element — see §10.
- **Screenshots.** Of the dashboard or docs, in-frame, with light
  border, never tilted, never on a colored background.
- **Abstract geometry.** Sparse, monochromatic, used only as a hero
  texture. Examples: a faint grid, a faded radial gradient, the AEGIS
  mark at 4% opacity.

### 9.2 What we don't use

- Stock photography (especially: handshakes, server-room shots,
  hooded-hacker silhouettes, "diverse team around a laptop")
- 3D renders, isometric scenes, Memphis-style shapes
- Mascot characters or anthropomorphic agents
- AI-generated photoreal images of any kind on production surfaces
- Emoji as decorative elements (functional emoji in copy is fine
  if the user uses them; we don't lead with them)

### 9.3 Diagram conventions

- Stroke: 1.5px slate-700 (light) / slate-300 (dark)
- Fill: slate-100 (light) / slate-900 (dark) for boxes; aegis-50 /
  aegis-900 for highlighted boxes
- Arrows: slate-500 with a 6px arrowhead, never curved unless showing
  a callback
- Text in diagrams: text-sm Inter, never mono unless naming an endpoint
- Always include a single highlighted path showing "the verify hot
  path" — this is the brand-consistent visual hook

---

## 10. Code samples (visual)

Code samples are a first-class visual element on AEGIS surfaces. They
must always:

- Use JetBrains Mono, 14px, line-height 24px, never below
- Have a header strip with: language label (text-xs all-caps),
  filename or endpoint, copy button on the right
- Use a 1-pixel slate-200 (light) / slate-800 (dark) border, no shadow
- Highlight the AEGIS-specific lines with a left border in aegis-500
  (3px, full height of the highlighted lines)
- Never animate (no typing-effect, no syntax-color-cycling)
- Be syntactically valid — no `// ...` ellipsis substituting for real
  code unless paired with a working complete example below

Color theme: a custom theme based on `Slack Ochin` (light) and `One Dark
Pro` (dark), with comments in slate-500, strings in emerald-600, keywords
in aegis-700, and AEGIS-specific calls (`aegis.verify`, etc.) in aegis-500
**bold-italic**. The bold-italic on AEGIS calls is the brand's typographic
signature.

---

## 11. Components — design intent (the contract for any builder)

Detailed prompts live in the per-surface files; this section sets the
*intent* every prompt downstream must respect.

| Component | Intent |
|---|---|
| Primary button | Solid `aegis-500`, white text, 36px tall (default), rounded-md, no gradient, no shadow at rest, shadow-sm on hover |
| Secondary button | 1px slate-200 border, slate-700 text, white background, same dimensions |
| Tertiary / link button | aegis-600 text, no background, underline on hover only |
| Input | 1px slate-200 border, rounded-sm, 36px tall, slate-900 text, slate-400 placeholder, focus ring 2px aegis-500/40 |
| Card | white (light) / slate-900 (dark), 1px slate-200 (light) / slate-800 (dark) border, rounded-lg, 24px padding |
| Badge | 12px text, all-caps, tracking-wider, rounded-sm, 6px×2px padding, semantic-color background at 10% opacity |
| Status dot | 6px filled circle, semantic-colored, paired with text label |
| Table | Density 40px row height (default), 32px (compact), zebra optional and off by default, column header text-xs all-caps slate-500 |
| Modal | rounded-lg, shadow-lg, 480px default width, white backdrop-blur on slate-900/40 overlay, 24px padding, footer right-aligned actions |
| Toast | top-right, 320px wide, rounded-md, shadow-md, 12px padding, 220ms slide-in, 4s default dismiss |
| Empty state | Centered, 64px Lucide icon at slate-400, text-base slate-500 description, single primary CTA |
| Loading | Skeleton bars (slate-200 / slate-800) — never spinners on main content; spinners only inside buttons (12px, currentColor, 1.5s rotation) |

---

## 12. Accessibility floor (non-negotiable)

- WCAG 2.2 AA contrast minimum (AAA preferred for body text)
- Every interactive element has a visible focus state — the 2px
  aegis-500/40 ring is the canonical one
- Keyboard: every action reachable; the dashboard ships with
  command-palette (`⌘K`) and g-prefixed page jumps
- Forms: label always visible (no placeholder-as-label), error
  messages adjacent to the field with role="alert"
- Color is never the only signal — pair with icon + text for status
- Motion respects `prefers-reduced-motion`
- All images have alt text; decorative images use empty alt + `role="presentation"`
- Tables use `<th scope>`, never just `<td>` for headers
- Modals trap focus and restore focus on close

---

## 13. Tokens — machine-readable summary

For any prompt that wants the full token set as JSON to hand to a tool:

```json
{
  "color": {
    "neutral": {
      "50": "#F8FAFC", "100": "#F1F5F9", "200": "#E2E8F0",
      "400": "#94A3B8", "500": "#64748B", "700": "#334155",
      "900": "#0F172A", "950": "#020617"
    },
    "aegis": {
      "50": "#ECFEFF", "100": "#CFFAFE", "300": "#67E8F9",
      "500": "#06B6D4", "600": "#0891B2", "700": "#0E7490",
      "900": "#164E63"
    },
    "semantic": {
      "success": "#10B981",
      "warning": "#F59E0B",
      "danger":  "#F43F5E",
      "info":    "#06B6D4"
    }
  },
  "font": {
    "sans": "Inter, ui-sans-serif, system-ui, sans-serif",
    "mono": "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
  },
  "radius": {
    "sm": "4px", "md": "6px", "lg": "8px", "xl": "12px"
  },
  "shadow": {
    "sm": "0 1px 2px rgba(15,23,42,0.06)",
    "md": "0 4px 12px rgba(15,23,42,0.08)",
    "lg": "0 12px 24px rgba(15,23,42,0.10)"
  },
  "motion": {
    "easing-enter": "cubic-bezier(0.16, 1, 0.3, 1)",
    "easing-exit":  "cubic-bezier(0.4, 0, 1, 1)",
    "duration-micro":     "150ms",
    "duration-component": "220ms",
    "duration-page":      "320ms"
  }
}
```

---

## 14. How to use this doc when prompting

Every prompt template in `01_*` through `05_*` opens with one of these
two patterns. Use them verbatim:

**Short reference (for AI tools with token budgets):**

```
Follow the AEGIS Brand Foundation v1 (slate neutrals + aegis-500 #06B6D4
brand, Inter + JetBrains Mono, Cloudflare/Auth0 visual lane, security-
forward but developer-first, no gradients on text, no stock photos, no
mascots, motion confirms not entertains).
```

**Full reference (for designer briefs and high-stakes generation):**

```
Follow `docs/design/00_BRAND_FOUNDATION.md` in full. Critical anchors:
§1 positioning (neutral / non-custodial / verifiable), §3 visual lane
(Cloudflare-Auth0), §4 color system (aegis-500 = #06B6D4 single brand
accent), §5 typography (Inter + JetBrains Mono only), §10 code-sample
treatment (mandatory bold-italic on AEGIS-specific calls), §11
component intent. Anti-positioning in §1.3 — do not violate.
```

---

## 15. Versioning

This is **v1**. Bump the minor version when tokens change without breaking
existing surfaces; bump the major when the visual lane shifts. Breaking
changes require an entry in `docs/decisions/` (next ADR number) and a
note in `docs/SESSION_HANDOFF.md`.
