// k6 load script — sustained verify throughput.
//
// Run:
//   OKORO_E2E_URL=http://localhost:3000 \
//   OKORO_E2E_API_KEY=okoro_sk_... \
//   OKORO_E2E_AGENT_ID=agt_... \
//   OKORO_E2E_POLICY_TOKEN=eyJ... \
//   k6 run load/verify.js
//
// Pre-reqs: install k6 (`brew install k6` on macOS), seed an agent + policy
// with the dev script, then export the token claims so this script can
// re-sign per-iteration tokens client-side.
//
// Note: k6 has no Ed25519 module out of the box; this script accepts a
// policyToken (signed by OKORO) and a *single* pre-signed agent request
// token (`OKORO_E2E_REQUEST_TOKEN`). Replay safety is acknowledged — for a
// pure load test we accept that all VUs re-use the same jti. To exercise
// jti uniqueness at scale, add a /v1/token/sign endpoint or pre-mint a
// pool of tokens via a Node helper and load them with --tag from-file.

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE = (__ENV.OKORO_E2E_URL || 'http://localhost:3000').replace(/\/+$/, '');
const KEY = __ENV.OKORO_E2E_API_KEY;
const REQUEST_TOKEN = __ENV.OKORO_E2E_REQUEST_TOKEN;
const TOKEN_POOL_FILE = __ENV.OKORO_E2E_TOKEN_POOL;

if (!KEY) throw new Error('OKORO_E2E_API_KEY is required');
if (!REQUEST_TOKEN && !TOKEN_POOL_FILE) {
  throw new Error('Either OKORO_E2E_REQUEST_TOKEN or OKORO_E2E_TOKEN_POOL is required');
}

// Round-24 token pool — replay protection rejects same-jti reuse, so a
// single static token caps measurable throughput at "1 approved + N
// replay-denied per 60s." Pre-mint a pool via `tests/load/mint-token-pool.mjs`
// and feed via `OKORO_E2E_TOKEN_POOL=/tmp/okoro-token-pool.txt`. Each VU
// iteration round-robins through the pool so distinct jtis exercise
// approve-throughput. SharedArray loads once into init memory; copies are
// COW-shared across VUs by the goja runtime.
const tokenPool = new SharedArray('okoro-token-pool', function () {
  if (!TOKEN_POOL_FILE) return REQUEST_TOKEN ? [REQUEST_TOKEN] : [];
  // k6's setup-time `open()` is a built-in global (no import).
  const text = open(TOKEN_POOL_FILE);
  return text.split('\n').filter((l) => l.length > 0);
});

const denialCounter = new Counter('okoro_verify_denials');
const approvedCounter = new Counter('okoro_verify_approved');
const verifyLatency = new Trend('okoro_verify_latency_ms', true);

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
    okoro_verify_latency_ms: ['p(95)<200', 'p(99)<500'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  // Round-robin through the pool. `__ITER` is the per-VU iteration counter
  // exposed by k6; combined with `__VU` it produces a unique stride that
  // doesn't collide across VUs. When the pool is smaller than total
  // iterations, wrap is acceptable: replay-protection will start denying
  // wrapped tokens, which IS a real-world signal.
  // eslint-disable-next-line no-undef
  const idx = (__VU * 1_000_003 + __ITER) % tokenPool.length;
  const token = tokenPool[idx];
  const body = JSON.stringify({
    token,
    action: 'commerce.purchase',
    amount: 199,
    currency: 'USD',
    merchantDomain: 'delta.com',
  });
  const res = http.post(`${BASE}/v1/verify`, body, {
    headers: {
      'content-type': 'application/json',
      // verify path expects the verify-only key header per OpenAPI security
      // definition `PublicVerifyKey`. FULL-scope keys are accepted there too.
      'X-OKORO-Verify-Key': KEY,
    },
    tags: { name: 'verify' },
  });
  verifyLatency.add(res.timings.duration);
  const ok = check(res, {
    // Verify writes a new audit row → server returns 201 Created. Accept
    // 200 OR 201; everything else (4xx auth, 5xx) remains a real failure.
    'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
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
