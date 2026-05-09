import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the AEGIS cross-package parity suite.
 *
 * Why this is separate from `vitest.config.ts`:
 * The e2e config wires `globalSetup: ['e2e/setup.ts']` to bring up the
 * live API. Cross-package parity tests are PURE — they read source files
 * (TypeScript unions, OpenAPI YAML, generated catalog files) and assert
 * structural equality. Running them under the e2e config would spin up
 * the API for a sub-second lint, which is wasteful and gates CI on
 * docker-compose health.
 *
 * Round 18 / Wave I.2 lit these up. Before this config, the four parity
 * specs lived in `tests/cross-package/` but had no runner: the root
 * `vitest.workspace.ts` referenced them but root has no vitest install,
 * and `vitest.config.ts` only included `e2e/**`. They compiled but
 * never enforced.
 *
 * Specs covered:
 *   - denial-precedence-enum.spec.ts   (CLAUDE.md invariant 6 across 4 surfaces)
 *   - error-catalog-parity.spec.ts     (R16 cream-loaded catalog mirrors)
 *   - audit-chain-parity.spec.ts       (signed-chain consistency: api ↔ verifier)
 *   - sdk-api-jwt-parity.spec.ts       (per ADR-0008, SDK + API maintain
 *                                       independent JWT impls; this spec
 *                                       catches silent EdDSA divergence)
 */
export default defineConfig({
  // Round 23: dashboard pricing parity imports `apps/dashboard/lib/pricing-source.ts`,
  // which uses `'server-only'` (a Next.js boundary marker). The package is a no-op
  // in Node and only matters at bundle time; stub it to an empty module so vitest
  // can resolve the import.
  resolve: {
    alias: {
      'server-only': new URL('./_stubs/server-only.ts', import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    include: ['cross-package/**/*.spec.ts'],
    testTimeout: 5_000,
    hookTimeout: 5_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    reporters: ['default'],
    isolate: false,
  },
});
