---
title: CERNIQ — Docs Site Design Prompts
audience: design AI tools, contract designers, in-repo Cursor sessions
last-reviewed: 2026-05-08
prerequisites: read `docs/design/00_BRAND_FOUNDATION.md` first
---

# 03 — Docs Site Prompts

The docs site is where developers turn intent into code. Stripe and
Cloudflare set the bar; CERNIQ aims for that bar from day one.

The docs subdomain (`docs.cerniq.dev`) is a separate surface from
marketing — different IA, different layout, different focus on
density and search. It must, however, share the CERNIQ Brand Foundation
exactly so the developer experience reads as one product.

## Information architecture

```
docs.cerniq.dev/
├── /                          Landing — quickstart, popular pages, search front-and-center
├── /quickstart                10-minute path from zero to first verified call
├── /concepts/
│   ├── /identity              Agent identity, principal binding, key handling
│   ├── /policies              Scope grammar, spend caps, time bounds, revocation
│   ├── /attestation           BATE — what feeds it, what it means, how to threshold it
│   ├── /audit                 The chain, canonicalization, integrity verification
│   └── /denials               The 10 reasons in fixed order, with examples for each
├── /sdks/
│   ├── /typescript            @cerniq/sdk reference + cookbook
│   ├── /python                cerniq (PyPI) reference + cookbook
│   ├── /go                    @cerniq/go (post-launch)
│   └── /rust                  @cerniq/rust (post-launch)
├── /api/
│   ├── /authentication        API key types, scopes, rotation
│   ├── /agents                CRUD + signing key management
│   ├── /policies              CRUD + scope grammar reference
│   ├── /verify                The hot path — request, response, denial codes
│   ├── /audit                 Stream, query, export, integrity check
│   ├── /webhooks              Subscribe, deliveries, retry, signing
│   └── /errors                Full error catalog
├── /integrations/
│   ├── /mcp                   MCP-as-control-plane pattern
│   ├── /auth0                 Auth0 bridge for human → principal
│   ├── /langchain             LangChain agent integration
│   ├── /stripe-acp            Plugging into Agentic Commerce Protocol
│   └── /custom                Roll-your-own pattern
├── /guides/
│   ├── /first-relying-party   How to verify on the RP side in 30 lines
│   ├── /threshold-tuning      Setting BATE thresholds for your industry
│   ├── /audit-export-soc2     Generating audit evidence for SOC2
│   ├── /key-rotation          Zero-downtime signing key rotation
│   └── /incident-runbook      What to do when an agent is compromised
├── /reference/
│   ├── /denial-precedence     The fixed 9-reason ladder (mirrored from
│   │                          docs/SECURITY.md so docs is the public face)
│   ├── /scope-grammar         Formal grammar for policy scopes
│   ├── /event-shapes          Canonical audit event JSON
│   ├── /webhook-signatures    Verification recipe
│   └── /openapi.yaml          Machine-readable OpenAPI 3.1
├── /cli                       Full CLI reference (auto-generated from --help)
├── /changelog                 Per-version release notes (mirrored from CHANGELOG.md)
└── /search                    Algolia-backed search modal — hit / from anywhere
```

## Engine choices (set up once, then forget)

- **Framework:** Nextra v3 on Next.js 16 (App Router). Mature, MDX-native,
  ships with a working sidebar + search out of the box. Alternative:
  Mintlify if hosted-docs trade-off is acceptable.
- **MDX:** content lives in `apps/docs/content/` as `.mdx`. API reference
  pages are partially generated from the OpenAPI spec.
- **Search:** Algolia DocSearch (free for OSS docs).
- **Code blocks:** Shiki for syntax highlighting. Custom transformer
  applies the CERNIQ bold-italic on `cerniq.\w+` and SDK-specific tokens.
- **API reference:** generated from `apps/api`'s OpenAPI export at build
  time. The `/api/*` pages are MDX wrappers around generated tables, not
  hand-written prose.

---

## A. AI UI tool prompts (V0, Lovable, Bolt)

### A.1 Docs landing page

```
Build the docs.cerniq.dev landing page. Stack: Next.js App Router +
Tailwind + shadcn/ui (or Nextra if the tool supports it).

Follow the CERNIQ Brand Foundation v1 (slate neutrals + cerniq-500 #06B6D4
brand, Inter + JetBrains Mono, Cloudflare/Auth0 visual lane, security-
forward but developer-first, no gradients on text). Light mode default
on docs (matches Stripe/Cloudflare convention); dark-mode toggle in
header.

Layout:
- Header (64px sticky): wordmark left, search bar center (with /
  shortcut hint), version dropdown right, Dark/Light toggle, GitHub
  icon
- Below header: a single-column hero, 480px tall, centered content,
  max-width 720px:
  - Eyebrow "CERNIQ docs" (text-xs all-caps slate-500)
  - h1 "Verify your first agent in 10 minutes." (text-5xl tracking-tight)
  - Lede (text-lg slate-600): "Quickstart, full SDK + API references,
    and the integration patterns we recommend for production. Start
    where you are."
  - A prominent search box (640px wide, 56px tall, with magnifier
    icon, "Search docs (or hit /)" placeholder, opens Algolia modal)
  - Below search: 4 small "I am a..." chip filters: Agent operator •
    Relying party • Security engineer • SRE
- Below hero, a 3-column grid of "Start here" cards:
  1. "Quickstart" — Lucide PlayCircle, "10 minutes from install to
     first verified call", link to /quickstart
  2. "API reference" — Lucide Code, "Every endpoint, every parameter,
     every error code", link to /api
  3. "Concepts" — Lucide BookOpen, "Identity, policies, attestation,
     audit — the model in 30 minutes", link to /concepts
- Below cards, a 2-column section:
  Left: "Popular pages" — list of 8 most-visited docs, each row with
    title, brief description, last-updated date in mono
  Right: "Recipes" — list of 6 named cookbooks, each with a copy-able
    one-liner curl/SDK call preview
- Below: a "By language" strip showing 4 cards (TypeScript, Python, Go,
  Rust) with the canonical install command in mono. Go and Rust cards
  are dimmed with a "Coming soon" pill.
- Footer: same as marketing — minimal version, just brand, GitHub,
  status, copyright

The search box must visually dominate the hero — this is the docs'
single most-important UI element. No CTAs that compete with it.

Output one page component.
```

### A.2 Doc content page layout (used for every concept/guide/reference)

```
Build the canonical docs content page layout. Three columns on desktop
≥1280px:

Left col (240px, sticky-on-scroll, scroll-overflow-y):
- Section header (e.g. "Concepts") — text-xs all-caps slate-500
- Tree of pages with active highlighting; nested 2 levels max
- Active item: cerniq-500 left border 2px, slate-900 text, slate-50 bg
  (light mode)
- Hover: slate-700 text, slate-100 bg

Center col (max-width 720px, flex-grow):
- Breadcrumbs (text-sm slate-500): Concepts / Identity
- h1 (text-3xl)
- Lede paragraph (text-lg slate-600, max-width 640px)
- Body MDX rendered with prose-slate typography:
  · h2 (text-2xl, 64px top margin, 24px bottom)
  · h3 (text-xl, 32px top, 12px bottom)
  · p (text-base slate-700, 24px line-height, max-width 64ch)
  · ul/ol (slate-700, 8px gap between items)
  · code (inline) — JetBrains Mono 14px, slate-100 bg, 4px x-padding,
    cerniq-700 text
  · pre (code blocks) — see Brand Foundation §10 treatment, with
    language label header strip + copy button + the bold-italic on
    CERNIQ-specific calls
  · blockquote — left cerniq-500 4px border, 16px padding, slate-50 bg
  · table — full width, slate-200 borders, header row text-xs all-caps
  · img — rounded-md, 1px slate-200 border
  · custom components: <Callout type="info|warn|danger">, <Steps>,
    <Tabs> (for SDK language tabs), <ApiTable>
- Page footer:
  · "Was this helpful?" thumbs up/down (sends event to PostHog or
    similar; no text required, click is the signal)
  · "Edit this page on GitHub →" link
  · Prev / Next page links (full-width row, slate-50 cards)

Right col (240px, sticky):
- "On this page" — auto-generated TOC of h2 + h3 headings
- Active heading highlighted in cerniq-500
- Below TOC: "Last updated 3 days ago", "View on GitHub" link

Mobile (<1024px): single column, left nav becomes a Sheet that slides
in from the left, right rail collapses to a sticky bottom "On this
page" expandable.

Custom components to include:
- <Callout type="info|warn|danger|success" title=""> — colored left
  border + matching icon, slate-50/-50 bg
- <Steps> — numbered vertical steps, mono numerals
- <Tabs labels={['TypeScript','Python','curl']}> — for multi-language
  code samples; persists choice across pages via localStorage
- <ApiEndpoint method="POST" path="/v1/verify" /> — renders a colored
  method badge + mono path, anchor link
- <ApiTable rows={[...]}> — parameter table with name, type, required,
  description columns

Output the layout component plus the custom MDX components.
```

### A.3 API reference page

```
Build the canonical API reference page layout. Used for every endpoint
in /api/*.

The page is two-pane on desktop ≥1280px:
- Left (60% width): prose, parameters, response schema, errors
- Right (40% width, sticky): a code sample block with language tabs
  (TypeScript, Python, curl) that auto-reflect the endpoint

Structure (for example, /api/verify):

1. Endpoint header strip:
   - Method badge (POST in cerniq-500 bg) + path "/v1/verify" in mono
   - Right side: small "Try it" button that opens an in-page console
     (see below)
2. h1 "Verify an agent action"
3. Lede sentence describing what the endpoint does
4. <ApiSection title="Authentication">
   - Required scope, key type, rate limits
5. <ApiSection title="Request body">
   - <ApiTable> of parameters with: name (mono), type, required (Yes/No),
     description, default (mono if applicable)
6. <ApiSection title="Response">
   - Two tabs: "Success (200)" and "Error (4xx/5xx)"
   - Each tab: <ApiTable> of fields + a fully-rendered example JSON in
     a code block on the right pane
7. <ApiSection title="Errors">
   - Full table of error codes for this endpoint with: code (mono badge),
     description, when-it-fires, retryable (Yes/No)
   - For /verify specifically, this section anchors to the denial
     precedence ladder
8. <ApiSection title="In-page console">
   - A live "Try it" panel with form-rendered request body, language-
     specific code that updates as fields change, and a Run button that
     calls the endpoint with the user's logged-in test API key.
   - If the user is not logged in, the Run button shows "Sign in to run."

The right-side code pane stays in sync with the section the user is
reading (intersection observer). When user is in the "Authentication"
section, the right pane shows the "with auth" example; in "Response",
it shows the example response.

Output the layout + the in-page console component (mock the API call
behind a typed interface so a real wiring is straightforward).
```

### A.4 Quickstart guide

```
Build /quickstart — the docs version (distinct from the dashboard
wizard at /quickstart inside the dashboard).

This page is a standalone tutorial that takes the reader from "I have
nothing installed" to "I just got a 200 from /v1/verify" in 10 minutes.

Layout: single column, max-width 720px, centered.

Structure:
1. h1 "Quickstart" with a "10 minutes" pill badge next to it
2. Lede: "By the end of this guide, you'll have an CERNIQ agent
   identity, a policy, and a successful verify call."
3. <Callout type="info"> Prerequisites: macOS or Linux, Node 20+ or
   Python 3.11+, a free CERNIQ account.
4. <Tabs labels={['TypeScript','Python','curl']}>
   ...content varies per language tab; preserve the choice across the
   whole page.
5. <Steps>
   1. Install the CLI — `curl -fsSL https://get.cerniq.dev/install.sh | sh`
      Below: a callout "Why a CLI?" with a one-paragraph rationale.
   2. Authenticate — `cerniq login --device-code`
   3. Run cerniq doctor — full expected output as a code block, with
      annotations explaining what each line means.
   4. Register your first agent — code sample showing the SDK or curl
      call, plus the response.
   5. Create a policy — code sample creating a policy bound to that
      agent.
   6. Sign and verify — code sample showing client-side signing and
      the verify call.
6. <Callout type="success">  "You did it. Your first audit event is
   visible at https://app.cerniq.dev/audit."
7. "Next steps" — 4 link cards: Concepts/Identity, Concepts/Policies,
   Guides/First-relying-party, API/Verify

Every code block uses the Brand Foundation §10 treatment, with the
CERNIQ-specific calls in bold-italic.

Output the page MDX + any custom components needed.
```

---

## B. Figma AI / Figma Make prompts

### B.1 Docs site — three core templates

```
Design the CERNIQ docs.cerniq.dev site in Figma. Light mode default with
a designed dark-mode variant. Audience: developers; this is the most
DX-critical surface in the entire CERNIQ system.

References (visual lane):
- Stripe docs (search-first, code-rich, sober)
- Cloudflare developer docs (multi-tab code samples, deep nav)
- Vercel docs (typography, density, "On this page" rail)

Anti-references:
- Algolia's own docs site (over-stylized)
- Most React-component-library docs (over-decorated)

Templates to deliver (1440×900 desktop + 768×1024 tablet + 375×812
mobile, each in light + dark):
1. Docs landing page (per § A.1)
2. Concept / guide page (per § A.2) — full layout with all custom
   components rendered: Callout (4 variants), Steps, Tabs, blockquote,
   table, image, ApiEndpoint inline
3. API reference page (per § A.3) — full layout with two-pane code
   sync, the in-page console open and closed states

Beyond templates, design these specific screens:
- Search modal (Algolia-style) open with results
- 404 page
- "Page not found in this version" — when user lands on a doc that
  exists in v2 but not v1
- Mobile sheet nav (left nav as bottom sheet)
- Code-sample component in 4 states: default, copy-clicked (with
  tooltip "Copied!"), language-tab switching, CERNIQ-call highlight
  hover (tooltip explains "This is an CERNIQ-specific SDK call")

Component library:
- All custom MDX components above
- Code-sample component with language label, filename, copy button,
  line numbers (toggleable), CERNIQ-call highlight, light + dark
- Method badge (GET, POST, PUT, DELETE) with semantic-aligned colors:
  · GET: cerniq-500
  · POST: emerald-500
  · PUT/PATCH: amber-500
  · DELETE: rose-500
- Pill badges for "New", "Updated", "Beta", "Deprecated"

Tokens come from docs/design/00_BRAND_FOUNDATION.md. Bind via Figma
variables.
```

---

## C. Designer brief (long-form)

```
PROJECT: CERNIQ Docs Site v1 (docs.cerniq.dev)
CONTEXT: CERNIQ is a verification + attestation infrastructure for AI
agents. The docs site is the single most DX-critical surface — it
converts "I read about CERNIQ" into "I shipped a verified call." We
benchmark against Stripe and Cloudflare.

DELIVERABLES (v1 launch):
1. Docs landing page (search-led)
2. Three core templates: concept/guide page, API reference page,
   quickstart-style step-by-step page
3. Custom MDX components: Callout (info/warn/danger/success), Steps,
   Tabs (multi-language code), ApiEndpoint, ApiTable, blockquote,
   table, image, code sample (the §10 treatment)
4. Search modal (Algolia DocSearch styled)
5. Method badges, pill badges, breadcrumbs, "On this page" rail
6. 404, version-mismatch, and empty-search states
7. Mobile + tablet variants for every template
8. DEV-mode-ready handoff with notes on Nextra theming overrides

OUT OF SCOPE for v1:
- The /api auto-generated content itself (engineering pipeline, not
  design)
- Algolia indexing config (engineering)
- A user-account / saved-search feature

INPUTS (all in repo):
- `docs/design/00_BRAND_FOUNDATION.md`
- Existing docs MDX content under `docs/` (most of it will be ported
  to apps/docs/content/)
- `docs/personas/developer.md` — primary audience

REFERENCES:
- Stripe docs — page rhythm, code-sample density, "On this page"
- Cloudflare developer docs — left-nav depth, multi-tab code samples
- Vercel docs — typography discipline, dark/light parity

ANTI-REFERENCES:
- AWS docs (too dense, no whitespace)
- Most React-component-library docs (over-decorated)

KEY VISUAL ANCHORS:
1. Search box dominates the landing — bigger than any CTA.
2. Code samples are the visual hero of every content page — the bold-
   italic on CERNIQ-specific calls is the brand's typographic signature.
3. The denial-precedence ladder reappears in /reference/denial-
   precedence and is the docs' security-narrative centerpiece.

HARD CONSTRAINTS:
- Light mode is default on docs (matches Stripe/Cloudflare); dark
  mode is required for parity.
- Mobile-first content readability — even though developers mostly
  browse on desktop, mobile must be considered, not deprioritized.
- Every page must support a screen reader test pass.
- Lighthouse ≥98 on every category. Docs is the only surface where
  we hold this bar — it sets the tone for engineering trust.

PROCESS:
- Week 1: component library + 1 fully designed concept page (Identity).
- Week 2: API reference page (Verify) + landing page.
- Week 3: quickstart + remaining MDX components + mobile variants.
- Week 4: empty/error states, polish, DEV-mode handoff.

SUCCESS METRIC:
A developer who has never used CERNIQ lands on /quickstart, gets to
a successful verify in <12 minutes, and rates the experience 9+/10
in our 5-question post-quickstart survey.

BUDGET / TIMELINE: [fill in]
PRIMARY POINT OF CONTACT: [fill in]
```

---

## D. Cursor / Claude Code in-repo prompts

### D.1 Bootstrap apps/docs

```
Goal: scaffold the docs site at apps/docs using Nextra v3 on Next.js 16.

Read first:
- /Users/money/Desktop/CERNIQ/CLAUDE.md
- /Users/money/Desktop/CERNIQ/docs/design/00_BRAND_FOUNDATION.md
- /Users/money/Desktop/CERNIQ/docs/design/03_DOCS_SITE_PROMPTS.md

Tasks:
1. Create apps/docs/ as a pnpm workspace package, name "@cerniq/docs".
2. Install Nextra v3 with the docs theme. Match Next 16 + React 19
   versions from apps/dashboard.
3. Override the Nextra theme: replace its primary color with cerniq-500
   via theme.config.tsx; replace its fonts with Inter + JetBrains Mono;
   adjust the sidebar typography to match the Brand Foundation §5.
4. Set up Shiki with a custom transformer that wraps `cerniq.\w+`,
   `agent.sign`, `agent.verify`, and the package import lines
   (`from "@cerniq/sdk"`) in <span class="cerniq-call"> for the bold-
   italic treatment. Add the CSS in app globals.
5. Add Algolia DocSearch placeholders (env vars only — actual
   indexing is post-launch).
6. Add the custom MDX components from § A.2 in apps/docs/components/:
   Callout, Steps, Tabs, ApiEndpoint, ApiTable. Each in its own file
   with TypeScript types.
7. Port the most critical existing markdown to MDX:
   - docs/QUICKSTART.md → apps/docs/content/quickstart.mdx
   - docs/SECURITY.md (the denial precedence section) →
     apps/docs/content/reference/denial-precedence.mdx
   - docs/personas/developer.md → apps/docs/content/concepts/audiences/developer.mdx
   Convert headings, links, and code fences. Preserve exact wording on
   denial-precedence — it is a public API contract.
8. Build the API reference auto-generation:
   - Add scripts/build-api-ref.ts that reads
     apps/api/openapi.json (run `pnpm --filter @cerniq/api openapi:export`
     first if missing) and emits MDX files under
     apps/docs/content/api/ — one per endpoint.
   - Each emitted MDX uses ApiEndpoint, ApiTable, and a Tabs block
     with TypeScript / Python / curl examples.
9. Run `pnpm --filter @cerniq/docs dev` on port 3002 (3000 = dashboard,
   3001 = marketing).
10. Update WORK_BOARD.md and docs/SESSION_HANDOFF.md.

Constraint: do not paraphrase technical claims. Numbers (`<80ms`,
`Ed25519`), the 10 denial reasons, and endpoint paths must come from
their canonical sources verbatim.

Quality bar: typecheck strict, no `any`, every MDX file lints clean
in markdownlint.
```

### D.2 Build the in-page API console

```
Goal: implement apps/docs/components/ApiConsole.tsx — the "Try it"
component on every API reference page.

Read first:
- docs/design/03_DOCS_SITE_PROMPTS.md § A.3
- packages/sdk-ts (the canonical SDK)
- apps/api/src/modules/* (the actual endpoints)

Tasks:
1. The console renders a form built from the endpoint's request schema
   (passed in as a prop, derived from OpenAPI at build time).
2. As the user edits the form, the right-side code sample updates in
   3 languages (TypeScript using @cerniq/sdk, Python using the cerniq
   PyPI package, curl).
3. The Run button calls the endpoint with the user's session API key
   if they're logged in to docs (we'll integrate with a future docs
   auth via Auth0; for v1, leave a "Sign in to run" placeholder).
4. The response is rendered as a syntax-highlighted JSON block with
   the same code-sample treatment.
5. Errors are rendered with a rose-500 left border and the error.code
   linked to /api/errors#<code>.

Tests:
- The form correctly renders required vs optional fields.
- The 3 language code samples stay in sync as the form changes.
- The component is fully keyboard-accessible.

Update SESSION_HANDOFF.md.
```

### D.3 Search wiring

```
Goal: wire Algolia DocSearch into apps/docs and ship the search modal
per the design spec.

Read first:
- docs/design/03_DOCS_SITE_PROMPTS.md (the search modal spec)
- Algolia DocSearch v3 docs (configure for OSS docs)

Tasks:
1. Apply for DocSearch via Algolia. While waiting, scaffold the
   integration with a stub index so the UI builds and tests pass.
2. The search modal opens on / from anywhere in the docs (intercept
   the keypress globally; no input focus stealing).
3. The modal styling must match the Brand Foundation, not Algolia's
   default. Override via the @docsearch/react custom-theming hooks.
4. Results display: section name (text-xs all-caps), title, snippet
   with matched query highlighted in cerniq-500.
5. Recent searches and starred pages are stored in localStorage.
6. Empty state: "No results — try a less specific query, or open
   /sitemap to browse all pages." with a link.

Tests: keypress opens modal; ESC closes; arrow keys navigate; Enter
follows a result; localStorage round-trips for recents.

Update SESSION_HANDOFF.md.
```

### D.4 Migration script for existing docs/

```
Goal: write apps/docs/scripts/migrate-from-repo-docs.ts that ports
the existing markdown docs from /docs/ into apps/docs/content/.

Read first:
- The full /docs/ tree (use ls/glob)
- Nextra's expected content layout

Tasks:
1. The script reads every .md under /docs/, strips the front-matter,
   rewrites internal links from `docs/foo.md` to `/foo` (Nextra
   routing), converts admonition syntax to <Callout> components,
   and emits to apps/docs/content/<bucket>/<slug>.mdx where bucket
   is determined by a mapping table at the top of the script (e.g.
   docs/THREAT_MODEL_v2.md → /security/threat-model).
2. The script is idempotent — running it twice produces the same
   output. It prints a summary of created vs updated vs skipped files.
3. Files that don't have a clear bucket get emitted under
   /content/_unsorted/ with a warning so a human can re-classify.
4. Includes a dry-run flag.

Constraint: do not delete or modify any file under /docs/. The repo
docs are the source of truth; apps/docs/content is a public face that
may diverge over time but must round-trip for the launch-blocking pages.

Update SESSION_HANDOFF.md with a list of pages that need human
review post-migration.
```

---

## How to use the four flavors together — docs edition

Docs is the most templated of the three surfaces. Once the brief (C)
ships the 3 core templates and the engineering bootstrap (D.1) is
done, content authoring becomes a matter of writing MDX into the
right buckets. Run the flavors in this order:

1. Designer ships the 3 templates (C, week 1).
2. Engineering bootstraps Nextra + tokens + custom MDX components
   (D.1, week 1, parallel).
3. Engineering wires search (D.3) and the API console (D.2) in week 2.
4. Content team ports existing /docs/ into MDX (D.4, weeks 2–3).
5. AI UI prompts (A) are not the right path for docs at all — they
   produce one-off pages, but docs is a _system_ of pages governed
   by templates. Skip A entirely for docs unless prototyping a new
   custom component.
