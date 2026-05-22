#!/usr/bin/env node
// Generates MDX files under content/docs/api/(generated)/ from the canonical
// OpenAPI spec at docs/spec/OKORO_API_SPEC.yaml.
//
// NOTE — currently disabled pending Round 27 follow-up wiring:
//   fumadocs-openapi v5 emits MDX that uses `<APIPage document="..." />`
//   with an absolute filesystem path baked into the JSX. That breaks on
//   any host where the build runs from a different absolute prefix (Vercel,
//   CI, etc.). The proper fix is to:
//     1. Add `apps/docs/lib/openapi.ts` exporting `createOpenAPI({ input: [...] })`
//     2. Register `APIPage` in mdx-components.tsx with the shared `ctx`
//     3. Configure generate-files to emit relative or context-aware paths
//   That's a small but careful change deferred to a follow-up round.
//
// Until then: this script is a no-op. The curated content/docs/api/*.mdx
// pages (agents, policies, verify, audit, webhooks, billing) remain the
// v1 source of API reference. They are not auto-generated, but they cover
// every endpoint with examples and link to the canonical OpenAPI spec.

console.log(
  '[docs] OpenAPI auto-render SKIPPED (Round 27 follow-up needed; see scripts/generate-api-docs.mjs header). ' +
    'Curated content/docs/api/*.mdx pages remain authoritative.',
);
process.exit(0);
