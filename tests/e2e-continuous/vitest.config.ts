import { defineConfig } from 'vitest/config';

/**
 * Continuous E2E config.
 *
 * Single-threaded, no parallelism — these are real network calls against
 * staging and several steps depend on side-effects from earlier steps
 * (synthetic agent registered in step 4 is reused in step 6, etc.).
 *
 * 60s per-test timeout because the trial-exhaustion step loops verify
 * calls and we don't want flaky pages on a slow staging window.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['funnel.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    // Sequential file order, no isolation between tests — we want shared
    // module-scope state (the synthetic principal/agent/policy) to flow
    // through the ordered funnel steps.
    sequence: { concurrent: false },
    isolate: false,
    reporters: ['default'],
  },
});
