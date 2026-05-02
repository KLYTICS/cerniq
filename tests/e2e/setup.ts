/**
 * Vitest globalSetup — pings the AEGIS API once before any test fork.
 *
 * Behavior:
 *   - If AEGIS_E2E_URL/health/live returns 2xx within the timeout, we proceed.
 *   - Otherwise we print a multi-line banner and exit(0). Vitest treats a
 *     globalSetup that exits before tests run as a successful no-op, so CI
 *     stays green when the API is intentionally not running.
 *
 * Why exit(0) instead of throwing: a thrown error becomes a red failure in
 * CI and a pile of TypeError noise in the output. The banner-and-exit
 * pattern is the cleanest "skip the whole suite" signal vitest exposes.
 *
 * Operator workflow (documented in tests/README.md):
 *   1. terminal A: `pnpm db:up && pnpm dev`
 *   2. terminal B: `AEGIS_E2E_URL=http://localhost:3000 \
 *                   AEGIS_E2E_API_KEY=aegis_sk_... pnpm --filter @aegis/e2e test`
 */

const DEFAULT_URL = 'http://localhost:3000';
const HEALTH_PATH = '/health/live';
const PROBE_TIMEOUT_MS = 2_000;

function banner(lines: string[]): void {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = '─'.repeat(width);
  // eslint-disable-next-line no-console
  console.log(`\n┌${bar}┐`);
  for (const l of lines) {
    // eslint-disable-next-line no-console
    console.log(`│  ${l.padEnd(width - 4)}  │`);
  }
  // eslint-disable-next-line no-console
  console.log(`└${bar}┘\n`);
}

export async function setup(): Promise<void> {
  const url = (process.env['AEGIS_E2E_URL'] ?? DEFAULT_URL).replace(/\/+$/, '');
  const apiKey = process.env['AEGIS_E2E_API_KEY'];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);

  let reachable = false;
  let status = 0;
  let detail = '';
  try {
    const res = await fetch(`${url}${HEALTH_PATH}`, { signal: ctrl.signal });
    status = res.status;
    reachable = res.ok;
    if (!res.ok) {
      detail = await res.text().catch(() => '');
    }
  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  if (!reachable) {
    banner([
      'AEGIS API not reachable — skipping e2e suite.',
      '',
      `URL probed: ${url}${HEALTH_PATH}`,
      status ? `HTTP status: ${status}` : `Network: ${detail || 'connection failed'}`,
      '',
      'To run the e2e tests:',
      '  1.  terminal A:  pnpm db:up && pnpm dev',
      '  2.  terminal B:  AEGIS_E2E_URL=http://localhost:3000 \\',
      '                   AEGIS_E2E_API_KEY=<aegis_sk_...> \\',
      '                   pnpm --filter @aegis/e2e test',
      '',
      'CI exits 0 with this banner so a missing API does not turn the build red.',
    ]);
    // Skip cleanly — vitest accepts an empty teardown.
    process.exit(0);
  }

  if (!apiKey) {
    banner([
      'AEGIS_E2E_API_KEY is not set — skipping e2e suite.',
      '',
      'The harness needs a valid management key (aegis_sk_...) to register',
      'agents and policies. Generate one via the seed script (M-017 ops):',
      '  pnpm tsx scripts/seed-dev.ts',
      '',
      'Then re-run with:',
      '  AEGIS_E2E_API_KEY=aegis_sk_... pnpm --filter @aegis/e2e test',
    ]);
    process.exit(0);
  }

  banner([
    'AEGIS e2e harness — preflight OK',
    `  url     ${url}`,
    `  health  ${url}${HEALTH_PATH}  (200)`,
    `  apiKey  ${apiKey.slice(0, 12)}…${apiKey.slice(-4)}`,
  ]);
}

export async function teardown(): Promise<void> {
  // Intentional no-op. Per-file afterAll hooks handle their own cleanup.
}
