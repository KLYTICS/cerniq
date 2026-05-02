// k6 load script — sustained verify throughput.
//
// Run:
//   AEGIS_E2E_URL=http://localhost:3000 \
//   AEGIS_E2E_API_KEY=aegis_sk_... \
//   AEGIS_E2E_AGENT_ID=agt_... \
//   AEGIS_E2E_POLICY_TOKEN=eyJ... \
//   k6 run load/verify.js
//
// Pre-reqs: install k6 (`brew install k6` on macOS), seed an agent + policy
// with the dev script, then export the token claims so this script can
// re-sign per-iteration tokens client-side.
//
// Note: k6 has no Ed25519 module out of the box; this script accepts a
// policyToken (signed by AEGIS) and a *single* pre-signed agent request
// token (`AEGIS_E2E_REQUEST_TOKEN`). Replay safety is acknowledged — for a
// pure load test we accept that all VUs re-use the same jti. To exercise
// jti uniqueness at scale, add a /v1/token/sign endpoint or pre-mint a
// pool of tokens via a Node helper and load them with --tag from-file.

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = (__ENV.AEGIS_E2E_URL || 'http://localhost:3000').replace(/\/+$/, '');
const KEY = __ENV.AEGIS_E2E_API_KEY;
const REQUEST_TOKEN = __ENV.AEGIS_E2E_REQUEST_TOKEN;

if (!KEY) throw new Error('AEGIS_E2E_API_KEY is required');
if (!REQUEST_TOKEN) throw new Error('AEGIS_E2E_REQUEST_TOKEN is required (a pre-signed agent JWT)');

const denialCounter = new Counter('aegis_verify_denials');
const approvedCounter = new Counter('aegis_verify_approved');
const verifyLatency = new Trend('aegis_verify_latency_ms', true);

export const options = {
  // 50 RPS sustained for 60s (steady-state). Ramp shapes the warm-up.
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 25,
      maxVUs: 100,
    },
  },
  // Budgets: documented in tests/load/README.md.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    aegis_verify_latency_ms: ['p(95)<200', 'p(99)<500'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const body = JSON.stringify({
    token: REQUEST_TOKEN,
    action: 'commerce.purchase',
    amount: 5,
    currency: 'USD',
    merchantDomain: 'delta.com',
  });
  const res = http.post(`${BASE}/v1/verify`, body, {
    headers: {
      'content-type': 'application/json',
      'X-AEGIS-API-Key': KEY,
    },
    tags: { name: 'verify' },
  });
  verifyLatency.add(res.timings.duration);
  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'body has valid field': (r) => {
      try {
        const j = r.json();
        return typeof j.valid === 'boolean';
      } catch (_) {
        return false;
      }
    },
  });
  if (ok) {
    try {
      const j = res.json();
      if (j.valid) approvedCounter.add(1);
      else denialCounter.add(1);
    } catch (_) {
      /* ignore */
    }
  }
}
