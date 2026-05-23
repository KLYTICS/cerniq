# @cerniq/docs

Live documentation site for CERNIQ. Served at `docs.cerniqapp.com`.

## Why "live"

Three things this site does that a static docs site does not:

1. **Imports wire constants directly** — `<DenialPrecedence/>` reads
   `DENIAL_REASON_PRECEDENCE` from `@cerniq/types`. The docs literally cannot
   drift from the API's denial precedence; a parity test enforces it.
2. **SSR-fetches the running platform** — `<PricingTable/>` calls
   `/.well-known/pricing.json` at request time via `CERNIQ_API_BASE_URL`.
   When the operator changes a price in `plans.ts` and redeploys the API,
   the docs reflect it within the ISR window. No second deploy.
3. **Reads versions at build** — `<SdkVersionBadges/>` reads
   `packages/sdk-ts/package.json`, `packages/sdk-py/pyproject.toml`, and
   `packages/cli/package.json` at build time. The badge always matches what
   was actually published.

A `data-source="api" | "fallback"` attribute is emitted on every live
component so operators can spot infra drift from a single page inspect.

## Stack

- Next.js 16 + React 19 (App Router; server components by default)
- Fumadocs 14 (UI + MDX + OpenAPI plugin)
- Tailwind v4 with CERNIQ brand tokens (`brand/02_design-tokens.json`)
- Pagefind for static search — no third-party vendor

## Run locally

```bash
pnpm install
pnpm --filter @cerniq/docs dev
```

Open <http://localhost:3100>.

## Environment

| Var                   | Purpose                                                                                                                                                                 | Default               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `CERNIQ_API_BASE_URL` | Source of `/.well-known/pricing.json` for `<PricingTable/>`. When unset, the component falls back to a build-time mirror and emits `data-source="fallback"` in the DOM. | unset (uses fallback) |

## Deploy

Vercel-ready out of the box. Can also run on Railway with the standard
Next.js build. The `CERNIQ_API_BASE_URL` env must be set in production for
`data-source="api"` to become the default.

## Adding a new live component

1. Create the component under `components/live/<name>.tsx`.
2. Mark it `import 'server-only';` if it touches the filesystem or an env
   variable. Keep client components for interactivity only.
3. Register it in `mdx-components.tsx` so MDX pages can use it.
4. Add a `data-source` attribute when the component reads from an external
   source — operators rely on this to spot fallbacks.
5. Add a parity test under `tests/cross-package/docs-*.spec.ts` if the
   component mirrors any constant or contract.

## Adding a new page

1. Drop a `.mdx` file under `content/docs/<section>/<slug>.mdx`.
2. Add it to the relevant `meta.json` `pages` list — that controls nav order.
3. Use live components by tag name (`<DenialPrecedence/>`, `<PricingTable/>`,
   `<SdkVersionBadges/>`). They render server-side.

## Generating the OpenAPI reference

```bash
pnpm --filter @cerniq/docs openapi:generate
```

Reads `docs/spec/CERNIQ_API_SPEC.yaml`, writes MDX pages under
`content/docs/api/(generated)/`. The `(generated)/` segment is reserved
for output and should not be edited by hand.
