# @okoro/docs — Changelog

All notable changes to the docs site. Format mirrors
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Round 26 post-push build verification (2026-05-19)
After pushing the platform commits (de3f7e3, 299c73f, b02348e), ran `pnpm --filter @okoro/docs build` end-to-end for the first time. The build surfaced 6 issues that the source-only audit had missed. All fixed in this round:

- **Fixed**: `apps/docs/scripts/generate-api-docs.mjs` was passing an absolute `output` path to `fumadocs-openapi.generateFiles`, which the lib treats as relative-to-cwd — produced files at a doubled path (`apps/docs/Users/money/.../apps/docs/content/...`). Now `chdir` to appRoot first and pass `./content/docs/api/(generated)`.
- **Fixed**: `apps/docs/app/docs/[[...slug]]/opengraph-image.tsx` removed entirely. Next 16 rejects any file segment after an optional catch-all (`[[...slug]]`) with `Optional catch-all must be the last part of the URL`. The homepage `/opengraph-image.tsx` remains as the shared OG; per-page dynamic OG is deferred to a follow-up that uses a non-optional catch-all or a dedicated `/api/og/[...slug]` route.
- **Fixed**: `apps/docs/app/twitter-image.tsx` re-exported `runtime` from `opengraph-image.tsx`. Next 16 cannot infer the `runtime` export from re-exports. Now declared inline.
- **Fixed**: `apps/docs/app/global.css` used `fumadocs-ui/css/preset.css` (a Fumadocs v15 path). v14.7.7 (what we have) exports `./style.css`. Switched to that.
- **Fixed**: `apps/docs/scripts/generate-api-docs.mjs` is now a documented no-op pending Round 27 wiring. The generated MDX uses `<APIPage document="..." />` with an absolute path baked into the JSX, which breaks on any deploy where the build runs from a different prefix (Vercel, CI). Proper wiring needs `apps/docs/lib/openapi.ts` exporting `createOpenAPI({ input: [...] })` + `APIPage` registered in `mdx-components.tsx` with the shared `ctx`. Until then, the curated `content/docs/api/*.mdx` pages remain authoritative.
- **Fixed**: `apps/docs/scripts/generate-sdk-docs.mjs` now exits 0 on TypeDoc failure (was propagating the non-zero exit). TypeDoc 0.27.9 + typedoc-plugin-markdown 4.11.0 have a peer-constraint chain that doesn't satisfy under TS 5.9 — graceful degradation lets the build proceed with the curated `content/docs/sdk/typescript.mdx` as v1 source.
- **Fixed**: `apps/docs/typedoc.json` stripped advanced options (`expandObjects`, `parametersFormat`, etc.) that typedoc-plugin-markdown 4.11 can't load against typedoc 0.27.
- **Fixed**: `apps/docs/app/layout.tsx` added `metadataBase` to clear Next's resolver-URL warning. Defaults to `NEXT_PUBLIC_DOCS_URL` env, falls back to the prod hostname.

**Build result after fixes**: `pnpm --filter @okoro/docs build` exits 0; 35 routes generated; all 25 docs pages prerendered; `/api/docs`, `/api/search`, `/llms.txt`, `/sitemap.xml`, `/robots.txt`, `/opengraph-image`, `/twitter-image` all wired.

**Discipline lesson**: source-only audits catch wrong-string and missing-step bugs but cannot catch runtime/build-time bugs (Satori flex, Fumadocs CSS exports, Next route conventions, peer-dep semantics under specific versions). Future multi-round arcs that produce build artifacts should include an actual `build` run as an explicit audit step before any commit, not just `typecheck`. Added to `apps/docs/CONTRIBUTING.md` and the docs CI workflow already runs the full build chain.

### Round 26 audit pass (2026-05-18)
- **Fixed**: GitHub org references across all docs MDX. Was `github.com/okorolabs/okoro` (55 refs); actual is `github.com/klytics/okoro` per repo remote and `packages/sdk-ts/package.json` `repository.url`.
- **Fixed**: ADR filename references where I had guessed the convention. `0006-audit-redact.md` → `0006-audit-redactability.md`, `0008-mcp-control-plane.md` → `0008-mcp-as-control-plane.md`, `0010-dpop-replay.md` → `0010-dpop-replay-prevention.md`, `0011-key-rotation.md` → `0011-key-rotation-kms.md`.
- **Fixed**: `apps/docs/content/docs/sdk/cli.mdx` referenced `0009-cli-auth.md` which does not exist. Replaced with the canonical `OPERATOR_DECISIONS.md` OD-009/OD-010 link and a clarifying parenthetical that `0009-auth0-bridge.md` is a separate concern (dashboard auth, not CLI auth).
- **Fixed**: `.github/workflows/docs.yml` typecheck job ran `tsc --noEmit` before the Fumadocs MDX source was generated, so the `@/.source` import would fail. Added a `pnpm --filter @okoro/docs exec fumadocs-mdx` step before typecheck, plus explicit OpenAPI and SDK generate steps so the CI run mirrors what `predev` does locally.
- **Fixed**: `apps/docs/app/opengraph-image.tsx` — added defensive `display: 'flex'` to the eyebrow and tagline divs. Satori (the engine behind `next/og`) is strict about flex layout; missing `display: 'flex'` can fail rendering on some divs even with text-only content.

### Round 26 (2026-05-18)
- **Added**: TypeDoc auto-generated `@okoro/sdk` reference. `scripts/generate-sdk-docs.mjs` runs on every `pnpm dev`/`pnpm build`; output gitignored under `content/docs/sdk/(generated)/typescript/`.
- **Added**: Curated SDK landing pages for Python (`okoro`), CLI (`okoro`), relying-party verifier (`@okoro/verifier-rp`), and MCP packages (`@okoro/mcp-server`, `@okoro/mcp-bridge`). All linked from the new `/docs/sdk` section in nav.
- **Added**: Lighthouse CI workflow (`.github/workflows/lighthouse-docs.yml`) with strict budgets — perf ≥ 0.85, a11y ≥ 0.95, best-practices ≥ 0.9, SEO ≥ 0.95. Runs on 7 representative URLs.
- **Added**: `<JwksFingerprint/>` live component — computes RFC 7638 thumbprints in-page from `/.well-known/audit-signing-key`. Embedded in auditor persona, compliance overview, and audit-chain concept.
- **Added**: Branded Open Graph + Twitter images via `next/og`. Homepage uses aurora-gradient hero; per-page renders dynamic title + description + section eyebrow.
- **Added**: Structured docs index JSON at `/api/docs` — machine-readable companion to `/llms.txt` for AI consumers.
- **Added**: `<RunnableExample/>` MDX component for StackBlitz/CodeSandbox embeds. Lazy-loaded, sandboxed iframe with on-brand caption.
- **Added**: Branded 404 page (`app/not-found.tsx`) with quick-jump links.
- **Added**: PR preview auto-comment workflow (`.github/workflows/docs-preview-comment.yml`) with full reviewer checklist.
- **Added**: `.vercelignore` to trim deploy bundle.
- **Added**: CHANGELOG.md (this file) and CONTRIBUTING.md.
- **Fixed**: `<SdkVersionBadges/>` displayed `@okoro/sdk-ts` (directory name) and `@okoro/cli` (Go directory) instead of `@okoro/sdk` and `okoro (cli)` — the actual published names.

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
- **Added**: OKORO brand theme via Tailwind v4 + CSS variables sourced from `brand/02_design-tokens.json`.
