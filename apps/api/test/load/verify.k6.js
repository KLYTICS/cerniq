/**
 * AEGIS — verify hot path load test (k6).
 *
 * Proves the < 200 ms p99 budget claimed in docs/ARCHITECTURE.md and
 * the WORK_BOARD M-005 acceptance criterion.
 *
 * Usage:
 *
 *   # Local (against `pnpm dev` on :4000)
 *   k6 run apps/api/test/load/verify.k6.js
 *
 *   # Staging
 *   AEGIS_BASE_URL=https://api.staging.aegislabs.io \
 *     AEGIS_VERIFY_KEY=$STAGING_VERIFY_KEY \
 *     AEGIS_FIXTURE_TOKEN=$STAGING_FIXTURE_TOKEN \
 *     k6 run apps/api/test/load/verify.k6.js
 *
 *   # Custom budget (e.g. CF Worker Phase 3 target)
 *   P99_BUDGET_MS=80 k6 run apps/api/test/load/verify.k6.js
 *
 * Pre-requisites:
 *   - A seeded fixture agent + policy whose signed token is exported
 *     as AEGIS_FIXTURE_TOKEN. Generate with:
 *       pnpm tsx apps/api/scripts/seed-dev.ts --emit-token
 *   - A verify-only API key (X-AEGIS-Verify-Key) with quota.
 *
 * Stages: ramp 0→50 RPS over 30 s, hold 50 RPS for 60 s, ramp to 200
 * RPS over 30 s, hold 200 RPS for 60 s, drain.
 *
 * Thresholds (any one breach fails the run):
 *   - p99 latency under the budget (default 200 ms; override via env)
 *   - error rate < 0.1 %
 *   - denial rate within expected envelope (we only fixture an
 *     APPROVED token; any denial means something is wrong)
 */

import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.AEGIS_BASE_URL || 'http://localhost:4000';
const VERIFY_KEY = __ENV.AEGIS_VERIFY_KEY || '';
const FIXTURE_TOKEN = __ENV.AEGIS_FIXTURE_TOKEN || '';
const P99_BUDGET_MS = parseInt(__ENV.P99_BUDGET_MS || '200', 10);
const FIXTURE_DOMAIN = __ENV.AEGIS_FIXTURE_DOMAIN || 'delta.com';
const FIXTURE_AMOUNT = parseFloat(__ENV.AEGIS_FIXTURE_AMOUNT || '47.00');

if (!VERIFY_KEY) fail('AEGIS_VERIFY_KEY env var required');
if (!FIXTURE_TOKEN) fail('AEGIS_FIXTURE_TOKEN env var required');

// ── Custom metrics ──────────────────────────────────────────────────
const verifyApprovals = new Counter('aegis_verify_approvals');
const verifyDenials = new Counter('aegis_verify_denials');
const verifyDenialRate = new Rate('aegis_verify_denial_rate');
const verifyServerLatency = new Trend('aegis_verify_server_latency_ms', true);

// ── Stages ──────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 400,
      stages: [
        { duration: '30s', target: 50 },   // ramp to nominal
        { duration: '60s', target: 50 },   // hold nominal
        { duration: '30s', target: 200 },  // ramp to peak
        { duration: '60s', target: 200 },  // hold peak
        { duration: '30s', target: 0 },    // drain
      ],
    },
  },
  thresholds: {
    [`http_req_duration{endpoint:verify}`]: [`p(99)<${P99_BUDGET_MS}`],
    http_req_failed: ['rate<0.001'],                              // < 0.1%
    aegis_verify_denial_rate: ['rate<0.001'],                      // ditto
  },
  noConnectionReuse: false,
  discardResponseBodies: false,
};

// ── Test loop ────────────────────────────────────────────────────────
export default function () {
  const payload = JSON.stringify({
    token: FIXTURE_TOKEN,
    action: 'commerce.purchase',
    amount: FIXTURE_AMOUNT,
    currency: 'USD',
    merchantDomain: FIXTURE_DOMAIN,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-AEGIS-Verify-Key': VERIFY_KEY,
    },
    tags: { endpoint: 'verify' },
  };

  const res = http.post(`${BASE_URL}/v1/verify`, payload, params);

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'has response body': (r) => !!r.body,
  });
  if (!ok) return;

  let body;
  try {
    body = res.json();
  } catch (_e) {
    return;
  }

  if (body && typeof body === 'object') {
    if (body.valid === true) {
      verifyApprovals.add(1);
      verifyDenialRate.add(false);
    } else {
      verifyDenials.add(1);
      verifyDenialRate.add(true);
      // Denial in a steady-state load test is unexpected (we use a fixture
      // token). Record the reason as a tag so the report shows what went wrong.
      verifyServerLatency.add(res.timings.duration, { denial_reason: body.denialReason || 'unknown' });
    }
  }

  verifyServerLatency.add(res.timings.duration);
}

// ── Summary ──────────────────────────────────────────────────────────
export function handleSummary(data) {
  const verify = data.metrics['http_req_duration{endpoint:verify}'];
  const p99 = verify ? Math.round(verify.values['p(99)']) : null;
  const p95 = verify ? Math.round(verify.values['p(95)']) : null;
  const med = verify ? Math.round(verify.values.med) : null;

  const stdout = [
    '\n──────────────────────────────────────────────',
    `AEGIS verify hot path — load test`,
    `Base URL: ${BASE_URL}`,
    `p99 budget: ${P99_BUDGET_MS} ms`,
    `──────────────────────────────────────────────`,
    `Latency:`,
    `  median: ${med} ms`,
    `  p95:    ${p95} ms`,
    `  p99:    ${p99} ms   ← ${p99 !== null && p99 < P99_BUDGET_MS ? 'PASS' : 'FAIL'}`,
    `Approvals: ${data.metrics.aegis_verify_approvals?.values.count ?? 0}`,
    `Denials:   ${data.metrics.aegis_verify_denials?.values.count ?? 0}`,
    `HTTP errors: ${data.metrics.http_req_failed?.values.passes ?? 0} ` +
      `(rate ${(data.metrics.http_req_failed?.values.rate ?? 0).toFixed(4)})`,
    `──────────────────────────────────────────────\n`,
  ].join('\n');

  return {
    stdout,
    'apps/api/test/load/verify.k6.summary.json': JSON.stringify(data, null, 2),
  };
}
