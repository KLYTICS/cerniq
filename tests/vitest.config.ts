import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the AEGIS e2e harness.
 *
 * Sequential by default — these are black-box network tests, not units.
 * Parallelism on the runner side hides race conditions instead of revealing
 * them; tests that need concurrency drive it explicitly with Promise.all
 * (see 09_spend_race.test.ts).
 */
export default defineConfig({
  test: {
    globals: true,
    include: [
      'e2e/**/*.test.ts',
      'e2e/property/**/*.spec.ts',
      // Helper unit tests (e.g. `_support/stripe.spec.ts`) — pure, no API.
      'e2e/_support/**/*.spec.ts',
    ],
    globalSetup: ['e2e/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    reporters: ['default'],
    // Black-box — no isolated modules, no setup files beyond globalSetup.
    isolate: false,
  },
});
