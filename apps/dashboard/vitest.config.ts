import { defineConfig } from 'vitest/config';

/**
 * Vitest config for `@aegis/dashboard` (Round 24 Lane C — M-020-pkg-install).
 *
 * Hosts pure-TS unit tests that live next to the dashboard module they cover
 * (`lib/safe-redirect.ts`, future `lib/pricing-source.ts` follow-ups, etc.).
 * Cross-package parity specs that need to import both API and dashboard
 * sources continue to live in `tests/cross-package/` and run under the
 * root `pnpm test:parity` config — keeping each runner narrowly scoped
 * to its actual dependency set.
 *
 * `server-only` is a no-op outside Next.js bundling; stub it here so a
 * future colocated test for `pricing-source.ts` resolves cleanly without
 * needing the React/Next runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      'server-only': new URL('./__tests__/_stubs/server-only.ts', import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    include: ['__tests__/**/*.spec.ts', 'lib/**/*.spec.ts'],
    testTimeout: 5_000,
    hookTimeout: 5_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    reporters: ['default'],
  },
});
