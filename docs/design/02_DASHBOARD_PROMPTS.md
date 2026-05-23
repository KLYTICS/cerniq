---
title: CERNIQ — Developer Dashboard Design Prompts
audience: design AI tools, contract designers, in-repo Cursor sessions working in apps/dashboard
last-reviewed: 2026-05-08
prerequisites: read `docs/design/00_BRAND_FOUNDATION.md` first
---

# 02 — Developer Dashboard Prompts

The dashboard (`apps/dashboard`) is where developers manage agents,
policies, keys, audit logs, BATE scores, billing, and webhooks. It is
the daily-use surface — operational, dense, dark-mode-default.

This is the surface where Vercel-tier polish matters most: command
palette, keyboard navigation, instant feedback. The existing repo
already scaffolds: `agents/`, `policies/`, `audit/`, `webhooks/`,
`mcp-servers/`, `billing/`, `quickstart/`, `pricing/`, `login/`,
plus components: `AppShell`, `HeaderNav`, `CommandPalette`,
`KeyboardShortcuts`, `ToastProvider`, `HandshakePanel`, `StatusDot`.
Every prompt below respects those names.

## Information architecture

```
Top nav:    Logo • Org switcher • [Agents] [Policies] [Audit] [Webhooks] [MCP servers]
                  • Search (⌘K) • Docs link • Help • Avatar menu

Side nav (per page):  context-specific filters and pagination

Routes (already scaffolded):
/                       Dashboard home — usage, recent verifies, BATE distribution, alerts
/quickstart             10-minute onboarding (live state machine, not a static page)
/agents                 List + filters + bulk actions
/agents/[agentId]       Detail — policies, BATE history, audit log, revoke
/policies               List + create
/policies/[policyId]    Detail — scopes, spend cap, history, revoke
/audit                  Streaming audit log + filters + export
/webhooks               Subscriptions list + delivery health
/mcp-servers            MCP control plane
/billing                Plan, usage, trial countdown, payment method
/pricing                Embedded pricing table for in-app upgrades
/login                  Auth0/SSO entry
```

## Density target

Dashboard density is the single biggest differentiator from marketing.
A tabular page must show ≥15 rows above the fold at 1440×900.

---

## A. AI UI tool prompts (V0, Lovable, Bolt)

### A.1 Dashboard home

```
Build a dashboard home page for CERNIQ — a verification + attestation
infrastructure for AI agents. Stack: Next.js App Router + Tailwind +
shadcn/ui. The user is a developer or security ops engineer logging in
to check on production verifies.

Follow the CERNIQ Brand Foundation v1 (slate neutrals + cerniq-500 #06B6D4
brand, Inter + JetBrains Mono, Cloudflare/Auth0 visual lane, security-
forward but developer-first, no gradients on text, no stock photos, no
mascots, motion confirms not entertains). Dashboard ships dark-mode
default (slate-950 page bg).

Layout:
- AppShell wraps the page (HeaderNav top, main content, CommandPalette,
  KeyboardShortcuts mounted)
- 240px left sidebar with icon + label nav: Home, Agents, Policies,
  Audit, Webhooks, MCP servers, Billing, Settings. Active item has a
  3px cerniq-500 left border + slate-800 bg.
- Main content area, max-width none, 24px padding

Page contents (top to bottom):
1. Page header strip: h1 "Overview" left, time-window selector right
   (Last 1h, 24h, 7d, 30d — segmented control).
2. KPI strip — 4 stat cards in a row, each:
   - white-on-slate-900 bg, 1px slate-800 border, rounded-lg, 16px padding
   - Label (text-xs all-caps slate-400)
   - Value (text-3xl font-bold slate-50, JetBrains Mono for numbers)
   - Delta (text-xs, success or danger color, with arrow icon)
   The four KPIs: "Verifies (24h)" 184,932 +12.4%, "p99 latency" 71ms
   −3ms, "Denied" 1,204 +0.7%, "Active agents" 47 +2
   (Sample numbers for layout only — real values come from the API
   loader; do not hardcode in shipped components.)
3. Two-column grid below:
   - Left col (2/3 width): "Verify volume" line chart, slate-800 bg,
     rounded-lg, 320px tall. Use Recharts. Two series: total verifies
     (cerniq-500), denied verifies (rose-500). Tooltip on hover with
     mono numbers.
   - Right col (1/3 width): "Denial precedence breakdown" — vertical
     bar list of the 10 denial reasons with counts and a 4px bar at
     scale relative to max. Click → /audit?reason=...
4. "Recent activity" — full-width table of the last 50 verify events.
   Columns: time (mono), agent (mono ID + truncate), result (badge),
   reason (badge if denied), latency (mono ms), policy (link), audit
   ID (mono link). Click row → drawer with full event detail.
5. Right side, persistent rail: "Alerts" panel with up to 3 active
   alerts. Each alert: severity dot, title, description, "Acknowledge"
   button. If none: empty state with ShieldCheck icon at slate-700
   "No active alerts."

Status badges (use throughout):
- valid: emerald-500 dot + "VALID"
- denied: rose-500 dot + "DENIED"
- AGENT_REVOKED: rose-500 dot + uppercase reason
- TRIAL_EXHAUSTED: amber-500 dot + uppercase reason
- everything-else-denied: rose-500

Keyboard:
- ⌘K opens command palette (already wired via CommandPalette component)
- g h → /, g a → /agents, g p → /policies, g u → /audit
- / focuses the search box

Accessibility:
- Charts have a textual table fallback toggleable via "Show as table"
  button
- Live-updating counts use aria-live="polite"

Output the page.tsx file plus any sub-components inline. Default export.
```

### A.2 Agents list page

```
Build the /agents page for the CERNIQ dashboard. Same project + brand
foundation.

The page is a dense, sortable, filterable table of agents. Modeled on
Linear's issue list and Vercel's deployment list.

Header:
- h1 "Agents" left
- "Register agent" primary button right (opens RegisterAgentForm in a
  Sheet — already a component)

Filter bar (just below header):
- Status pills: All • Active (default) • Suspended • Revoked
- Runtime pills: All • anthropic • openai • custom
- Search input (filters by agent ID, principal email, label) with
  ⌘F shortcut hint
- "Sort by: Last verified ▾" dropdown

Table:
- Columns: checkbox, Agent ID (mono, truncated, copy-on-click),
  Label, Runtime, Model, Principal, Status, BATE score, Last verified,
  Actions (overflow menu)
- Row height 40px (default density)
- Header row: text-xs all-caps tracking-wider slate-400, sticky
- Hover: row bg slate-900/60
- Status column: StatusDot component + uppercase status
- BATE score column: a 24px-wide horizontal mini-bar showing 0–1000
  with a colored fill — slate-700 if <300, amber-500 if 300–699,
  emerald-500 if ≥700. Numeric value to the right.
- Last verified: relative time ("2m ago"), tooltip shows ISO ts
- Actions menu: View, Edit, Suspend, Revoke (Revoke red, requires
  confirm modal calling RevokeAgentButton component)

Bulk actions bar (appears when checkboxes selected):
- "{n} selected" left
- "Revoke selected" + "Suspend selected" + "Export" buttons right
- Slides in from bottom with 220ms transition

Pagination:
- Bottom of table: "Showing 1–25 of 412" left, page-size selector
  (25/50/100) middle, prev/next + page jump right

Empty state:
- ShieldCheck icon 64px slate-700, "No agents yet", description, CTA
  "Register your first agent →"

Output one page component. Use the existing AgentTable, AgentMetricStrip,
RegisterAgentForm, RevokeAgentButton components from
apps/dashboard/app/agents/components/ — do not duplicate them; compose
them here. If they need props extended, return a separate diff-style
note at the bottom of the file.
```

### A.3 Agent detail page

```
Build /agents/[agentId] — the deep-dive page for a single agent.

Layout: two-column on desktop ≥1280px, single column below.
Left col (2/3): scrollable detail content.
Right col (1/3): persistent metadata rail.

Header strip:
- Back link to /agents (text-sm slate-400 with ChevronLeft)
- Agent label (text-2xl slate-50)
- Below label, three tags: status badge, runtime + model (mono), BATE
  score with mini-bar
- Right side: kebab menu with View signing key, Rotate key, Suspend, Revoke

Tab strip (sticky, 48px tall):
  Overview • Policies • BATE history • Audit • Settings

Each tab pane:

OVERVIEW:
- 4-stat strip: total verifies (lifetime), denied (lifetime), avg
  latency, current BATE
- "Recent activity" — last 25 verify events as a table
- "Active policies" — list of policies bound to this agent, each with
  scope summary, expiry, spend cap fill bar

POLICIES:
- Full list of policies bound, with create/revoke/edit. Reuses the
  /policies component patterns.

BATE HISTORY:
- A 720px-tall area chart of BATE score over the last 30 days,
  Recharts, cerniq-500 line. Gridlines at 300 and 700.
- Below chart: signal contributors table — Velocity (weight), Geo
  (weight), Spend pattern (weight), Failed-verify rate (weight),
  Cross-RP consistency (weight). Pull weights from
  docs/BATE_ALGORITHM.md or a // OPERATOR-INPUT-NEEDED placeholder.

AUDIT:
- Embedded /audit table filtered to this agentId. Reuse the audit
  table component.

SETTINGS:
- Label, environment tag, runtime, principal binding, key fingerprint.
- "Rotate signing key" — opens HandshakePanel modal that walks the
  user through generating a new keypair client-side and registering
  the new public key.

Right rail (persistent):
- Section "Identity" — Agent ID (mono, copyable), Public key fingerprint
  (mono, truncated, click-to-expand), Created at, Last verified
- Section "Principal" — email, org, link to principal page
- Section "Trust" — current BATE, 24h delta, anomaly flags if any

Output as one page component, composing existing detail sub-components
where they exist.
```

### A.4 Audit log streaming page

```
Build /audit — the live, streaming, hash-chained audit log.

This is the page security engineers will obsess over. It needs to read
as a serious forensics tool, not a chat interface.

Layout: full-width, dense.

Top filter bar:
- Time-window picker (Last 1h / 24h / 7d / Custom)
- Agent filter (multi-select with search)
- Reason filter (multi-select of the 10 denial reasons + VALID)
- Free-text search (matches event ID, agent ID, policy ID, RP ID)
- "Live" toggle — when on, new events stream in at top with a 320ms
  fade-in row + 1px cerniq-500 left-border pulse
- "Export NDJSON" button on right (calls /v1/audit/export)
- "Verify chain integrity" button — runs the audit chain verification
  client-side and shows a green check if the chain is intact, red x
  with the broken-link event ID if not

Table:
- Columns: Time (mono ISO with TZ toggle), Event ID (mono, truncate,
  click-copy), Agent (mono, click → /agents/...), Action (e.g. "verify",
  "policy.revoke"), Result (VALID / denial reason badge), RP (mono),
  Latency, prev_sig (mono truncate, hover → tooltip with full),
  signature (mono truncate, hover → tooltip with full)
- Row height 32px (compact density — this is a forensics view)
- Click row: opens a right-side drawer with the full event JSON
  (expandable), the canonicalized signing input, and a "View on
  audit chain" link
- Banner above the table if any chain integrity issue exists, in
  rose-500 with a "View affected events" CTA

Pagination: cursor-based, "Load older" button at bottom (no page numbers).

Empty state: "No events match your filters."

Status if streaming is paused: a banner "Live updates paused — click to
resume."

Output the page component plus the AuditEventDrawer sub-component.
```

### A.5 Policies create/edit form

```
Build the policy create/edit form. Reachable at /policies/new and
/policies/[policyId]/edit.

Layout: single column, 720px max-width, centered. The form is dense but
not crowded.

Sections (each in a Card):

1. Basics
   - Name (input, required)
   - Description (textarea, optional)
   - Bound agent (combobox, required) — searches agents, shows agent
     label + ID + status

2. Scopes
   - A scope-builder UI: rows of (action, resource, conditions). Each
     row: action select (read/write/transfer/...), resource input
     (free text or namespace picker), conditions composer (AND/OR
     tree of key-op-value, with keys like "amount", "currency",
     "destination", "country", "timeOfDay"). "Add scope" button
     adds a row.
   - Live preview of the resulting JSON scope on the right (mono,
     read-only), updated as the user edits.

3. Spend cap
   - Numeric input + currency select (USD/EUR/GBP/JPY)
   - Window selector: per-call / per-hour / per-day / per-policy-lifetime
   - Optional "Soft warn at" threshold (% of cap)

4. Time bounds
   - Starts: datetime picker (default: now)
   - Expires: datetime picker (default: now + 30d) OR "Never"

5. Allow-list
   - Domain allow-list — list of domains the policy permits. Add via
     input + Enter; remove via x icon on each chip.

6. Revocation
   - Toggle "Revokable" (default on, disabled — non-revokable policies
     require enterprise plan)

Sticky footer bar (bottom of page):
- Left: "Cancel" link back to /policies
- Right: "Save as draft" + "Activate policy" (primary). Both call
  /v1/policies endpoint.

Validation:
- Form is built with react-hook-form + zod, schema imported from
  packages/types. Inline error messages below each field.
- Submit disabled until valid; required fields marked with a small
  text-xs cerniq-500 asterisk after the label.

Output the form as a single component, plus the ScopeBuilder
sub-component.
```

### A.6 Quickstart wizard

```
Build /quickstart — a stateful onboarding wizard, not a static page.

This is the surface that turns "signed up" into "verified first call."
It must feel like a live shell, not a marketing page.

Layout: split, 50/50.
Left: a 5-step state machine.
Right: a live terminal-style log that updates as the user completes steps.

Steps (each is a Card on the left):
1. Install the CLI — shows the curl one-liner; "I've installed it"
   button → verifies via a quickstart-status endpoint.
2. Authenticate — shows `cerniq login --device-code`; polls for
   completion.
3. Run cerniq doctor — shows the command; the right-side terminal
   streams the diagnostic output.
4. Scaffold an integration — radio picker (fintech-payments / ai-platform-
   tool-call / saas-seat-provisioning), then `cerniq init --industry ...`
   one-liner.
5. Verify your first call — shows the curl + SDK examples; on success,
   confetti is forbidden — instead show a single 24px emerald-500
   ShieldCheck with text "First verify accepted." and a link to /audit.

Each step:
- 64px tall when collapsed, expanded card when active
- Status: pending (slate-400 circle), in-progress (cerniq-500 with
  spinner), complete (emerald-500 with check), failed (rose-500 with x)

Right pane (terminal):
- slate-900 bg, JetBrains Mono 13px, slate-100 text
- Lines fade in as they arrive
- Real timestamps (UTC, mono)
- Auto-scroll on new content with a sticky "Jump to bottom" button
- Filter input above (regex-capable) for power users

If a step fails, show the doctor output inline + a link to the
relevant docs page.

State is persisted to localStorage so closing the tab doesn't reset.

Output the page + the StepCard, TerminalPane, and StatusIndicator
components.
```

---

## B. Figma AI / Figma Make prompts

### B.1 Dashboard system frame

```
Design the CERNIQ developer dashboard in Figma. Audience: developers
and security ops; daily-use operational tool. Visual lane: Cloudflare/
Auth0 with Vercel-like polish on density and keyboard affordances.
Dark mode is the default.

Token foundation: the CERNIQ Brand Foundation v1 in
docs/design/00_BRAND_FOUNDATION.md. Bind every fill, stroke, and text
style to a Figma variable; do not hardcode colors anywhere.

Frames to deliver (1440×900 dark, plus 1440×900 light variants for
parity):
1. Shell — header, sidebar, content area, command palette open state,
   command palette closed state, keyboard shortcut overlay (?)
2. Home / overview — 4 KPI strip, verify-volume chart, denial-
   precedence bar, recent activity table, alerts rail
3. /agents list — filter bar, table at compact + default density,
   bulk-action bar, empty state
4. /agents/[agentId] — overview tab, BATE history tab, audit tab,
   settings tab, plus the rotate-key HandshakePanel modal
5. /policies list + /policies/new (the form)
6. /audit — streaming view, filter open state, export modal,
   integrity-check passing + failing states
7. /webhooks — list + create form + delivery health drill-down
8. /mcp-servers — list with health column + drill-down
9. /billing — plan card, usage strip, trial countdown, payment method
   card, invoices table
10. /quickstart — step 3 active state with terminal streaming
11. Empty states — agents, policies, audit (all 3 designed; rest
    inherit the pattern)

Component library (build first, use everywhere):
- Button (primary, secondary, tertiary, danger) at sm/md/lg with
  loading and disabled states
- Input + Textarea + Select + Combobox + DatePicker + DateRangePicker
- Badge (semantic + neutral, uppercase + sentence-case)
- StatusDot
- Card, Sheet, Modal, Drawer, Toast
- Table cell (mono, label, badge, action) and table row
- Tabs (sticky)
- Sidebar nav item (idle, hover, active)
- KPI stat card
- Code sample card (matching marketing CodeSample but dark-default)
- Empty state
- Loading skeleton
- Command palette
- Mini-bar (BATE)
- Severity bar (denial reasons)

Auto-layout on every frame. Variants for dark + light, compact + default
density. Component documentation in DEV mode for each — include the
intended Tailwind class names from the Brand Foundation §11.
```

### B.2 Two-state pages worth designing in Figma deliberately

```
For the dashboard, design these specific dual-state frames in Figma
because the contrast between "happy" and "incident" states defines the
product:

1. Audit page — chain-intact (banner absent) vs chain-broken (rose-500
   banner with affected event highlighted)
2. Agent detail — healthy (BATE 880, no alerts) vs at-risk (BATE 320,
   anomaly flagged, 14d trust decline)
3. Policy detail — within cap (spend bar 40% emerald) vs over (rose,
   "denied: SPEND_LIMIT_EXCEEDED")
4. Billing — normal vs past-due (PastDueBanner active, blocked actions)
5. Quickstart step 3 — doctor passing vs doctor failing with diagnostic
   inline

These are the screens that get screenshotted in incident postmortems
and customer trust conversations. They earn extra design time.
```

---

## C. Designer brief (long-form)

```
PROJECT: CERNIQ Developer Dashboard v1 (apps/dashboard)
CONTEXT: CERNIQ is a verification + attestation infrastructure for AI
agents (read `docs/spec/01_MASTER.md` and `CLAUDE.md`). This dashboard
is the operational surface — daily-use, dense, dark-default. Users are
developers and security/ops engineers.

DELIVERABLES (v1 launch):
1. Component library in Figma — the full §11 set in dark + light, with
   variants and Figma-variable bindings to the Brand Foundation tokens.
2. Page designs for: overview, /agents list, /agents detail (4 tabs),
   /policies list + form, /audit (live + integrity-check states),
   /webhooks, /mcp-servers, /billing, /pricing (in-app), /quickstart
   wizard, /login, 404, error boundary.
3. Empty, loading, and error states for every list + detail page.
4. Modal specs: revoke confirm, rotate key (multi-step HandshakePanel),
   export audit, upgrade-plan, delete-resource.
5. Toast variants: success, info, warning, danger, with action and
   without.
6. Command palette open + closed states with keyboard chord overlay.
7. DEV-mode-ready handoff to engineering with annotated motion specs.

OUT OF SCOPE for v1:
- Mobile dashboard (desktop only at launch — security ops is a desk
  workflow). Responsive ≥768px is required but not optimized.
- White-label theming.
- Customer-facing settings pages beyond Billing and Profile.

INPUTS (all in repo):
- `docs/design/00_BRAND_FOUNDATION.md` — locked.
- `apps/dashboard/app/**` — existing routes; you are designing the
  visual layer for these pages, not changing the IA.
- `apps/dashboard/components/**` — existing components like AppShell,
  CommandPalette, HandshakePanel; design must match these names so
  engineering wiring is mechanical.
- `docs/spec/03_TECHNICAL_SPEC.md` — data shapes for tables and detail
  pages.
- `docs/SECURITY.md` — denial precedence (the 10 reasons) — copy
  exactly, this is a public API contract.
- `docs/BATE_ALGORITHM.md` — BATE score visualization spec.

REFERENCES:
- Vercel dashboard — typography, command palette, keyboard chord
  overlay, deployment list density
- Linear — issue list density, filter bar, bulk-action bar, optimistic
  UI
- Cloudflare dashboard — multi-tenant org switcher, security-rich
  data tables
- Stripe dashboard — payment-grade table polish, log/event drill-down,
  audit-as-product

ANTI-REFERENCES:
- Datadog (visually overloaded)
- AWS console (visually under-considered)
- Most low-code/no-code dashboards (consumer feel)

KEY VISUAL ANCHORS:
1. The denial-precedence ladder — 10 reasons in fixed order, recurring
   visual motif. Treat it as the brand's signature security visual.
2. The BATE score gauge / mini-bar — present on every agent row and
   detail page.
3. The audit chain integrity check — pass / fail states must be
   instantly readable.
4. The command palette — fast, dense, keyboard-first.

HARD CONSTRAINTS:
- Dark mode default. Light mode parity required for every screen.
- Density target: ≥15 rows above fold on a tabular page at 1440×900.
- Every status uses dot + text; color is never the only signal.
- Mono is mandatory for: IDs, fingerprints, signatures, latencies,
  endpoint paths, ISO timestamps. Mono in the wrong place reads
  amateurish; mono in the right place reads enterprise.
- Keyboard navigation is a first-class affordance — every action has
  a chord, every chord is documented in the ? overlay.

PROCESS:
- Week 1: component library in dark + light. Engineering reviews.
- Week 2: Overview, /agents list, /agents detail.
- Week 3: /policies, /audit (the security forensics tour-de-force).
- Week 4: /webhooks, /mcp-servers, /billing, /quickstart, /login.
- Week 5: empty/loading/error states, modals, toasts, motion specs,
  DEV-mode handoff.

SUCCESS METRIC:
A senior ops engineer joins a customer team, lands in /audit during
an incident, and finds the affected events in <90 seconds without
documentation. If they need a hand-hold, the page failed.

BUDGET / TIMELINE: [fill in]
PRIMARY POINT OF CONTACT: [fill in]
```

---

## D. Cursor / Claude Code in-repo prompts

### D.1 Wire Tailwind + tokens into apps/dashboard

```
Goal: bring apps/dashboard to parity with the Brand Foundation. The
package currently has Next 16 + React 19 only; no styling pipeline.

Read first:
- /Users/money/Desktop/CERNIQ/CLAUDE.md
- /Users/money/Desktop/CERNIQ/docs/design/00_BRAND_FOUNDATION.md
- apps/dashboard/package.json
- apps/dashboard/components/AppShell.tsx

Tasks:
1. Install tailwindcss + @tailwindcss/forms + @tailwindcss/typography
   + class-variance-authority + tailwind-merge in apps/dashboard.
2. Add tailwind.config.ts at apps/dashboard/ with the full token set
   from §13 of the foundation doc. The cerniq ramp must be exposed as
   `colors.cerniq.*` so utilities like `bg-cerniq-500` work.
3. Add app/globals.css with @tailwind base/components/utilities and a
   :root with CSS vars for light + .dark for dark. Default dark.
4. Wire Inter + JetBrains Mono via next/font/google. Expose --font-sans
   and --font-mono to globals.css.
5. Initialize shadcn/ui at apps/dashboard with the new-york style.
   Override primary to cerniq-500 in the components.json.
6. Add the canonical components from §11: Button, Input, Card, Badge,
   Modal, Sheet, Toast (Sonner), Table, Tabs, DropdownMenu, Tooltip,
   Skeleton, Command (for the palette).
7. Verify by running `pnpm --filter @cerniq/dashboard build`. Lint must
   pass with --max-warnings 0.
8. Update WORK_BOARD.md and docs/SESSION_HANDOFF.md.

Constraint: do not break any existing components. Read every file under
apps/dashboard/components/ and apps/dashboard/app/ first; refactor only
where necessary to use the new classes. If a component already works
visually, leave it; if it has hardcoded inline styles, migrate them to
tokens.

Quality bar: no `any`, --strict typecheck passes, every component renders
in Storybook (set up Storybook if not present — leave a // FIXME if you
defer Storybook to a later session).
```

### D.2 Build the dashboard home page

```
Goal: implement apps/dashboard/app/page.tsx as the overview screen.

Read first:
- docs/design/00_BRAND_FOUNDATION.md
- docs/design/02_DASHBOARD_PROMPTS.md § A.1
- apps/dashboard/components/AppShell.tsx
- apps/api/src/modules/verify/* (the verify response shape — KPIs must
  reflect real data, not mock)
- packages/types — the canonical types

Tasks:
1. Build the page exactly as in § A.1: KPI strip, verify-volume chart,
   denial-precedence breakdown, recent activity table, alerts rail.
2. Data fetching: use Server Components. Add loaders in
   apps/dashboard/app/_data/ that call the CERNIQ API via the SDK
   (@cerniq/sdk). Key invariant: every loader takes principalId from
   the session and passes it through. No cross-principal leaks
   (CLAUDE.md invariant 5).
3. Charts: use Recharts. The verify-volume chart loads only the time
   window selected; switching window refetches via a client component
   wrapper.
4. The 10 denial reasons must come from packages/types — import the
   constant. If missing, add it (CLAUDE.md says constants live in
   packages/types).
5. The "Active alerts" rail reads from a future alerts module. If the
   module doesn't exist yet, render an empty state and leave a
   // OPERATOR-INPUT-NEEDED comment with a link to a placeholder
   ADR.

Tests:
- Snapshot of the page with mocked loaders.
- Loader functions reject when principalId is missing.
- Charts render the correct number of series.

Update SESSION_HANDOFF.md.
```

### D.3 Audit page (the forensics tour-de-force)

```
Goal: implement apps/dashboard/app/audit/page.tsx and its components.

Read first:
- docs/design/00_BRAND_FOUNDATION.md
- docs/design/02_DASHBOARD_PROMPTS.md § A.4
- docs/decisions/0005-audit-chain-canonicalization.md
- docs/decisions/0006-audit-redactability.md
- apps/api/src/modules/audit/audit.service.ts (the canonical service)

Tasks:
1. Build the streaming table per § A.4.
2. Streaming uses SSE from /v1/audit/stream (add the endpoint if
   missing on the API side; coordinate via WORK_BOARD.md).
3. The "Verify chain integrity" button runs the verification CLIENT-
   SIDE — pull the events for the selected window, run audit-chain
   verification using the same util as audit-chain.util.spec.ts, show
   pass/fail. This proves to the user that CERNIQ does not need to be
   trusted for integrity.
4. The export-NDJSON button calls /v1/audit/export with the current
   filters. Permission-gate it to roles with audit.export scope.
5. Each row's drawer shows: full event JSON (collapsible tree), the
   canonicalized signing input as a separate tab, the prev_sig and
   sig as expandable mono fields, and a "Copy signing input" button
   so a user can independently verify in their own tooling.

Tests:
- Chain verification on a known-good fixture passes.
- Chain verification on a tampered fixture identifies the broken
  event ID.
- Streaming gracefully degrades to polling if SSE is blocked.
- principalId scoping enforced on the loader.

Update SESSION_HANDOFF.md.
```

### D.4 Quickstart wizard in-repo

```
Goal: implement apps/dashboard/app/quickstart/page.tsx as a live state
machine, per § A.6.

Read first:
- docs/design/02_DASHBOARD_PROMPTS.md § A.6
- docs/personas/developer.md (the 5-step flow described there is
  canonical)
- docs/DEVELOPER_QUICKSTART.md

Tasks:
1. Implement the 5-step state machine using xstate (install if not
   present). The machine is exported so it can be unit-tested
   independently.
2. The terminal pane renders streaming output via WebSocket from a
   /v1/quickstart/stream endpoint. If the endpoint doesn't exist,
   coordinate with the api claim and leave a placeholder local mock.
3. Persist machine state to localStorage with a v1 schema; on load,
   resume from the last completed step.
4. Each step's "verify" call hits a real readiness endpoint
   (/v1/quickstart/state) — never simulate progress.
5. When all 5 steps complete, redirect to /agents with a success toast
   "First verify accepted. View your audit log →" pointing to /audit
   filtered by that agent.

Tests:
- Machine transitions match the docs/personas/developer.md flow.
- localStorage persistence round-trips.
- Failure of step 3 (cerniq doctor) routes the user to a "Diagnose"
  panel with the relevant doctor output and docs links.

Update SESSION_HANDOFF.md.
```

### D.5 Command palette deepening

```
Goal: extend apps/dashboard/components/CommandPalette.tsx to ship as
the dashboard's primary navigation surface.

Read first:
- docs/design/02_DASHBOARD_PROMPTS.md § A.1 keyboard section
- apps/dashboard/components/CommandPalette.tsx
- apps/dashboard/components/KeyboardShortcuts.tsx

Tasks:
1. The palette opens on ⌘K and registers the following groups:
   - Navigate (g a → Agents, g p → Policies, g u → Audit, g w →
     Webhooks, g h → Home, g b → Billing, g s → Settings)
   - Actions (Register agent, Create policy, Export audit, Rotate key
     for…, Revoke agent…, Acknowledge alert)
   - Search (typed text searches across agents, policies, audit
     events; debounced 150ms; results limited to 10 per type)
   - Help (? to open shortcuts overlay, "What's new" link, "Send
     feedback")
2. Recent and starred items at top.
3. Fully keyboard-driven; no mouse required for any action.
4. Width 720px, rounded-lg, shadow-lg, slate-900 bg in dark mode.
5. The "What's new" entry opens a slide-over with the latest
   changelog entries pulled from the marketing /changelog at build
   time (cache the JSON locally to avoid runtime fetch).

Tests:
- Every g-prefixed shortcut routes correctly.
- Every action has an undo-or-confirm UX (CLAUDE.md "no silent
  failures").
- Cmd-K toggles open/close.

Update SESSION_HANDOFF.md.
```

---

## How to use the four flavors together — dashboard edition

The dashboard is more dependent on the **designer brief (C)** path than
marketing. Engineering can implement the AI-tool prompts, but a
component library that doesn't anchor to a Figma source of truth will
drift in 6 weeks.

Recommended order:

1. Designer ships the component library in Figma (C, week 1).
2. Engineering bootstraps Tailwind + tokens in-repo (D.1, week 1, in
   parallel with designer).
3. As designer ships pages weekly, engineering implements with D.2–D.5,
   each anchored to the matching Figma frame.
4. AI UI prompts (A) are best for spiking new features post-launch
   when the designer is unavailable — never as the source of truth.
