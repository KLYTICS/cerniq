// Load test for the verify hot path.
//
// Targets:
//   Phase 1 (origin only) — p99 < 200 ms at 200 RPS sustained.
//   Phase 3 (CF Workers edge) — p99 <  80 ms at 1000 RPS sustained.
//
// Gated behind LOAD_TEST=1 so it doesn't run in normal CI. Exec via:
//
//   AEGIS_VERIFY_KEY=aegis_vk_xxxx  AEGIS_TOKEN=...  LOAD_TEST=1 \
//     pnpm --filter @aegis/api exec jest test/load/verify.load.test.ts
//
// Running it from the bootstrap script and a freshly minted dev token is
// scaffolded in the next iteration of `scripts/seed-dev.ts` — for now, set
// AEGIS_TOKEN by hand from the dashboard or seed output.

import autocannon from 'autocannon';

const RUN = process.env.LOAD_TEST === '1';

const TARGETS = {
  origin: { p99Ms: 200, rps: 200, durationSec: 30 },
  edge: { p99Ms: 80, rps: 1_000, durationSec: 30 },
} as const;

const PROFILE: keyof typeof TARGETS = (process.env.AEGIS_LOAD_PROFILE as keyof typeof TARGETS) || 'origin';

const URL = process.env.AEGIS_API_URL ?? 'http://localhost:4000';
const VERIFY_KEY = process.env.AEGIS_VERIFY_KEY ?? '';
const TOKEN = process.env.AEGIS_TOKEN ?? '';

(RUN ? describe : describe.skip)(`/v1/verify load — profile=${PROFILE}`, () => {
  beforeAll(() => {
    if (!VERIFY_KEY || !TOKEN) {
      throw new Error('Set AEGIS_VERIFY_KEY and AEGIS_TOKEN before running the load test.');
    }
  });

  it(`sustains target RPS with p99 ≤ ${TARGETS[PROFILE].p99Ms} ms`, async () => {
    const target = TARGETS[PROFILE];

    const result = await autocannon({
      url: `${URL}/v1/verify`,
      method: 'POST',
      connections: Math.max(64, Math.floor(target.rps / 10)),
      pipelining: 1,
      duration: target.durationSec,
      headers: {
        'Content-Type': 'application/json',
        'X-AEGIS-Verify-Key': VERIFY_KEY,
      },
      body: JSON.stringify({
        token: TOKEN,
        action: 'commerce.purchase',
        amount: 50,
        currency: 'USD',
        merchantDomain: 'load-test.example',
      }),
    });

    // eslint-disable-next-line no-console
    console.log(
      `\n  → load summary: ${result.requests.average.toFixed(0)} rps, p50=${result.latency.p50}ms, p99=${result.latency.p99}ms, errors=${result.errors}`,
    );

    expect(result.errors).toBe(0);
    expect(result.non2xx).toBe(0);
    expect(result.latency.p99).toBeLessThanOrEqual(target.p99Ms);
    expect(result.requests.average).toBeGreaterThanOrEqual(target.rps * 0.9); // 10% slop
  }, 90_000);
});
