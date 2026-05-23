#!/usr/bin/env node
/* eslint-disable */
/**
 * CERNIQ — container healthcheck
 * -----------------------------------------------------------------------
 * Distroless images do not ship with a shell, so this is JavaScript that
 * `node` can execute directly. The `.sh` extension is preserved because
 * the file is referenced from infra docs and CI scripts under that name;
 * the shebang above is informational — invocation goes through `node`.
 *
 * Exit codes:
 *   0  — /v1/health/ready returned 200 within the timeout
 *   1  — non-200, network error, or timeout
 *
 * Why we hit /v1/health/ready and not /v1/health/live:
 *   - `live` only proves the process is alive (responds to event loop).
 *   - `ready` proves Postgres + Redis are reachable. A container that is
 *     live but not ready cannot serve verify requests, and Railway / k8s
 *     should restart it. The denial-precedence guarantee in
 *     docs/SECURITY.md § 6 depends on Postgres being reachable on every
 *     verify, so "live but not ready" is functionally broken.
 *
 * NO third-party deps — must work in the distroless `nodejs20` image.
 */

const http = require('node:http');

const PORT = process.env.PORT || '4000';
const PATH = process.env.HEALTHCHECK_PATH || '/v1/health/ready';
const TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 4000);

const req = http.request(
  {
    host: '127.0.0.1',
    port: PORT,
    path: PATH,
    method: 'GET',
    timeout: TIMEOUT_MS,
    headers: { 'user-agent': 'cerniq-healthcheck/1' },
  },
  (res) => {
    // Drain the body so the socket can close cleanly even on slow apps.
    res.resume();
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      process.exit(0);
    }
    process.stderr.write(`healthcheck: status=${res.statusCode}\n`);
    process.exit(1);
  },
);

req.on('timeout', () => {
  process.stderr.write(`healthcheck: timeout after ${TIMEOUT_MS}ms\n`);
  req.destroy();
  process.exit(1);
});

req.on('error', (err) => {
  process.stderr.write(`healthcheck: ${err.message}\n`);
  process.exit(1);
});

req.end();
