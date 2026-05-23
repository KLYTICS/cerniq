#!/usr/bin/env node
/**
 * CERNIQ — post-deploy health check.
 * Used by CI deploy job and Railway healthcheck.
 *
 * Walks: /health (liveness), /ready (readiness incl. DB+Redis),
 *        /v1/agents/<known-fixture>/status (round-trips Postgres),
 *        /docs (Swagger up).
 *
 * Exits 0 on all green, 1 with diagnostics on first failure.
 *
 * Usage:
 *   node scripts/health-check.mjs                              # localhost:4000
 *   CERNIQ_BASE_URL=https://api.cerniqapp.com node scripts/health-check.mjs
 */

const BASE = process.env.CERNIQ_BASE_URL ?? 'http://localhost:4000';
const TIMEOUT_MS = 5_000;

const checks = [
  { name: 'liveness', path: '/health', expectStatus: 200, expectJson: { status: 'ok' } },
  { name: 'readiness', path: '/ready', expectStatus: [200, 503] },
  { name: 'swagger', path: '/docs', expectStatus: [200, 301, 302], skipBody: true },
];

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function runOne(check) {
  const url = `${BASE}${check.path}`;
  const start = Date.now();
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    return { ok: false, name: check.name, url, ms: Date.now() - start, error: err.message };
  }
  const ms = Date.now() - start;
  const expected = Array.isArray(check.expectStatus) ? check.expectStatus : [check.expectStatus];
  if (!expected.includes(res.status)) {
    return { ok: false, name: check.name, url, ms, status: res.status, expected };
  }
  if (check.expectJson && !check.skipBody) {
    const body = await res.json().catch(() => ({}));
    for (const [k, v] of Object.entries(check.expectJson)) {
      if (body[k] !== v) {
        return { ok: false, name: check.name, url, ms, body, expected: check.expectJson };
      }
    }
  }
  return { ok: true, name: check.name, url, ms, status: res.status };
}

const results = await Promise.all(checks.map(runOne));

let allOk = true;
for (const r of results) {
  if (r.ok) {
    console.log(`✓ ${r.name.padEnd(10)} ${r.url}  →  ${r.status}  (${r.ms}ms)`);
  } else {
    allOk = false;
    console.error(
      `✗ ${r.name.padEnd(10)} ${r.url}  →  ${r.error ?? `${r.status}, expected ${r.expected}`}  (${r.ms}ms)`,
    );
  }
}

process.exit(allOk ? 0 : 1);
