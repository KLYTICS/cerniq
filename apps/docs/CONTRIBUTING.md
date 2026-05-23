# Contributing to @cerniq/docs

## Local setup

```bash
pnpm install
pnpm --filter @cerniq/docs dev
```

Opens at <http://localhost:3100>. Hot reload works for both MDX and React.
The `predev` hook regenerates the OpenAPI and TypeDoc references — no
need to run them manually.

## Adding a new page

1. Drop a `.mdx` file under `content/docs/<section>/<slug>.mdx`.
2. Frontmatter:

   ```yaml
   ---
   title: Page title
   description: One-sentence summary — shows in OG image, sitemap, search results, /api/docs.
   ---
   ```

3. Add the new slug to the relevant `meta.json` `pages` array — that
   controls nav order.
4. Use live components by tag name. No imports needed inside MDX.

## Adding a new live component

The pattern: every wire-facing constant or runtime value the docs surface
should render from its source of truth, not a transcribed copy.

1. Create `components/live/<name>.tsx`. Mark `import 'server-only';` if it
   touches the filesystem, an env variable, or makes a network call.
2. Import the wire constant directly from `@cerniq/types`. Never copy the
   value as a string literal.
3. Emit a `data-source="api" | "fallback"` attribute or an in-page source
   caption — operators use these to spot drift from a single page inspect.
4. Register the component in `mdx-components.tsx`.
5. **If the component mirrors a wire constant**, add a parity test under
   `tests/cross-package/docs-<name>-parity.spec.ts`. Use
   `docs-denial-precedence-parity.spec.ts` as a template.

## Auto-generated content

| Path                                       | Source of truth                  | Regenerator                     |
| ------------------------------------------ | -------------------------------- | ------------------------------- |
| `content/docs/api/(generated)/`            | `docs/spec/CERNIQ_API_SPEC.yaml` | `scripts/generate-api-docs.mjs` |
| `content/docs/sdk/(generated)/typescript/` | `packages/sdk-ts/src/**`         | `scripts/generate-sdk-docs.mjs` |

Both run on every `pnpm dev` and `pnpm build` via the `predev` and
`prebuild` hooks. Both output directories are gitignored — **never** edit
files inside `(generated)/`, they will be overwritten.

## CI gates

| Gate              | Workflow                                     | What it catches                                |
| ----------------- | -------------------------------------------- | ---------------------------------------------- |
| typecheck         | `.github/workflows/docs.yml`                 | Type errors, missing imports                   |
| parity            | `.github/workflows/docs.yml`                 | Live components diverging from wire constants  |
| link-check        | `.github/workflows/docs.yml` (lychee)        | Dead links in MDX                              |
| build             | `.github/workflows/docs.yml` (main only)     | Build-time regressions                         |
| Lighthouse        | `.github/workflows/lighthouse-docs.yml`      | Perf / a11y / best-practices / SEO regressions |
| Preview checklist | `.github/workflows/docs-preview-comment.yml` | Reviewer checklist posted to every docs PR     |

Lighthouse budgets are **errors**, not warnings. A PR that drops perf
below 0.85 or a11y below 0.95 cannot merge until fixed.

## Visual / brand

All colors and tokens trace back to `brand/02_design-tokens.json` and are
mirrored into `app/global.css`. The Fumadocs UI preset is composed onto
CERNIQ variables via the `--color-fd-*` CSS variables — do not introduce
off-grid hex colors or one-off spacing.

## Deploy

- **Production**: automatic on Vercel for every push to `main`.
- **PR previews**: automatic on Vercel for every PR touching `apps/docs/**`.
  The Vercel bot posts the preview URL; `docs-preview-comment.yml` posts
  the reviewer checklist alongside.

## Adding a new SDK page

The `/docs/sdk` section has one MDX page per public package. To add one:

1. Create `content/docs/sdk/<package-id>.mdx` with frontmatter and a
   curated overview (install, surface, recipes, source link).
2. Add it to `content/docs/sdk/meta.json` `pages` array.
3. If the package is TypeScript and you want auto-generated reference,
   extend `typedoc.json` with an additional entry point and re-run
   `pnpm --filter @cerniq/docs sdk:generate`.

## Adding a new persona

The `/docs/personas/<persona>.mdx` pattern is intentionally light —
each persona page is ≤ 5 links + a 30-second value prop + a first-action
call. Resist the urge to make personas long. They are routing pages, not
content pages.
