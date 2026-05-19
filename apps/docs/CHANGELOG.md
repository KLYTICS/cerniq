# @aegis/docs — Changelog

All notable changes to the docs site. Format mirrors
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Round 26 audit pass (2026-05-18)
- **Fixed**: GitHub org references across all docs MDX. Was `github.com/aegislabs/aegis` (55 refs); actual is `github.com/klytics/aegis` per repo remote and `packages/sdk-ts/package.json` `repository.url`.
- **Fixed**: ADR filename references where I had guessed the convention. `0006-audit-redact.md` → `0006-audit-redactability.md`, `0008-mcp-control-plane.md` → `0008-mcp-as-control-plane.md`, `0010-dpop-replay.md` → `0010-dpop-replay-prevention.md`, `0011-key-rotation.md` → `0011-key-rotation-kms.md`.
- **Fixed**: `apps/docs/content/docs/sdk/cli.mdx` referenced `0009-cli-auth.md` which does not exist. Replaced with the canonical `OPERATOR_DECISIONS.md` OD-009/OD-010 link and a clarifying parenthetical that `0009-auth0-bridge.md` is a separate concern (dashboard auth, not CLI auth).
- **Fixed**: `.github/workflows/docs.yml` typecheck job ran `tsc --noEmit` before the Fumadocs MDX source was generated, so the `@/.source` import would fail. Added a `pnpm --filter @aegis/docs exec fumadocs-mdx` step before typecheck, plus explicit OpenAPI and SDK generate steps so the CI run mirrors what `predev` does locally.
- **Fixed**: `apps/docs/app/opengraph-image.tsx` — added defensive `display: 'flex'` to the eyebrow and tagline divs. Satori (the engine behind `next/og`) is strict about flex layout; missing `display: 'flex'` can fail rendering on some divs even with text-only content.

### Round 26 (2026-05-18)
- **Added**: TypeDoc auto-generated `@aegis/sdk` reference. `scripts/generate-sdk-docs.mjs` runs on every `pnpm dev`/`pnpm build`; output gitignored under `content/docs/sdk/(generated)/typescript/`.
- **Added**: Curated SDK landing pages for Python (`aegis`), CLI (`aegis`), relying-party verifier (`@aegis/verifier-rp`), and MCP packages (`@aegis/mcp-server`, `@aegis/mcp-bridge`). All linked from the new `/docs/sdk` section in nav.
- **Added**: Lighthouse CI workflow (`.github/workflows/lighthouse-docs.yml`) with strict budgets — perf ≥ 0.85, a11y ≥ 0.95, best-practices ≥ 0.9, SEO ≥ 0.95. Runs on 7 representative URLs.
- **Added**: `<JwksFingerprint/>` live component — computes RFC 7638 thumbprints in-page from `/.well-known/audit-signing-key`. Embedded in auditor persona, compliance overview, and audit-chain concept.
- **Added**: Branded Open Graph + Twitter images via `next/og`. Homepage uses aurora-gradient hero; per-page renders dynamic title + description + section eyebrow.
- **Added**: Structured docs index JSON at `/api/docs` — machine-readable companion to `/llms.txt` for AI consumers.
- **Added**: `<RunnableExample/>` MDX component for StackBlitz/CodeSandbox embeds. Lazy-loaded, sandboxed iframe with on-brand caption.
- **Added**: Branded 404 page (`app/not-found.tsx`) with quick-jump links.
- **Added**: PR preview auto-comment workflow (`.github/workflows/docs-preview-comment.yml`) with full reviewer checklist.
- **Added**: `.vercelignore` to trim deploy bundle.
- **Added**: CHANGELOG.md (this file) and CONTRIBUTING.md.
- **Fixed**: `<SdkVersionBadges/>` displayed `@aegis/sdk-ts` (directory name) and `@aegis/cli` (Go directory) instead of `@aegis/sdk` and `aegis (cli)` — the actual published names.

### Round 25 (2026-05-18)
- **Added**: OpenAPI auto-render via `fumadocs-openapi generate` (regenerated pre-build/predev).
- **Added**: Orama search via Fumadocs built-in (no vendor; `/api/search` route).
- **Added**: 3 new live components — `<StatusBadge/>`, `<TrustBandLegend/>`, `<WebhookEventCatalog/>`.
- **Added**: 4 persona pages — SRE, developer, security, auditor.
- **Added**: 3 industry quickstarts — fintech-payments, ai-platform-tool-call, saas-seat-provisioning.
- **Added**: 3 new concept pages — trust-bands, audit-chain, webhooks.
- **Added**: 4 new API reference pages — policies, verify, audit, webhooks, billing.
- **Added**: Compliance overview section.
- **Added**: SEO + AI-crawler surface — `app/sitemap.ts`, `app/robots.ts`, `app/llms.txt/route.ts`.
- **Added**: 2 new cross-package parity tests — trust-bands, webhook-events.
- **Added**: `.github/workflows/docs.yml` CI gate (typecheck + parity + lychee link-check + main-only build).
- **Added**: Vercel deploy config.

### Round 24 (2026-05-18)
- **Added**: Initial Fumadocs scaffold at `apps/docs/` — Next 16 + React 19 + Tailwind v4.
- **Added**: 3 live components — `<DenialPrecedence/>`, `<PricingTable/>`, `<SdkVersionBadges/>`.
- **Added**: Home page, quickstart (TypeScript), one concept page (denial precedence), one API page (agents).
- **Added**: First cross-package parity test (denial precedence).
- **Added**: AEGIS brand theme via Tailwind v4 + CSS variables sourced from `brand/02_design-tokens.json`.
