import { defineConfig } from 'vitest/config';

/**
 * Vitest config for AEGIS cross-package parity tests.
 *
 * These specs are pure unit-shaped checks that load source from multiple
 * workspace packages directly (via relative imports) and assert they agree
 * on canonical artifacts: denial-reason precedence, error catalogs, audit
 * chain canonicalisation, SDK <-> API JWT compatibility.
 *
 * Deliberately separate from `tests/vitest.config.ts` (the e2e harness),
 * which spins up a live API in `globalSetup`. Cross-package tests do not
 * need that — they are static parity guards and must run fast in CI.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['**/*.spec.ts'],
    testTimeout: 10_000,
    pool: 'forks',
    reporters: ['default'],
  },
});
