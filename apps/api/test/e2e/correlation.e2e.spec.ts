// Correlation middleware behaviour at the HTTP boundary.
//
// Pre-requisite: app.module.ts must mount CorrelationMiddleware via
// `MiddlewareConsumer.apply(CorrelationMiddleware).forRoutes('*')`. Until
// the foundation session lands that wiring, the "echoes X-Request-Id" and
// "generates tx_<ulid>" assertions will fail because the header isn't
// being set on the response. This is intentional — the suite is the
// contract that wiring must satisfy.
//
// Tracker: M-019 covers the AsyncLocalStorage propagation into the
// AuditEvent table column (the third assertion below is `test.skip`'d
// because the column doesn't exist yet — see test/e2e/README.md "Known
// limits" for the migration unblock).

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AEGIS_HEADER_REQUEST_ID } from '@aegis/types';

import { createTestApp, type SupertestHttp, type TestAppHandle } from './_helpers/test-app';

const HEADER_LOWER = AEGIS_HEADER_REQUEST_ID.toLowerCase();
const ULID_RE = /^tx_[0-9A-HJKMNP-TV-Z]{26}$/i;

describe('e2e: correlation / X-Request-Id', () => {
  let handle: TestAppHandle;
  let app: INestApplication;
  let http: SupertestHttp;

  beforeAll(async () => {
    handle = await createTestApp();
    app = handle.app;
    http = request(app.getHttpServer());
    await handle.resetDatabase();
  });

  afterAll(async () => {
    await handle.close();
  });

  test('inbound X-Request-Id is echoed verbatim on the response', async () => {
    const inbound = `tx_01HZZZ${'0'.repeat(20)}`; // 26-char ULID-shaped suffix
    const res = await http.get('/').set(AEGIS_HEADER_REQUEST_ID, inbound);
    // Status 200 or 404 both acceptable — we only care about the header.
    expect([200, 404]).toContain(res.status);
    const echoed = res.headers[HEADER_LOWER];
    expect(typeof echoed).toBe('string');
    expect(echoed).toBe(inbound);
  });

  test('missing inbound id → server generates a tx_<ulid>', async () => {
    const res = await http.get('/');
    expect([200, 404]).toContain(res.status);
    const generated = res.headers[HEADER_LOWER];
    expect(typeof generated).toBe('string');
    expect(generated as string).toMatch(ULID_RE);
  });

  // M-019 — AuditEvent has no correlationId / txId column. Until the
  // migration lands, we cannot prove the middleware-emitted txId is
  // persisted alongside the audit row. Documented in test/e2e/README.md.
  test.skip('audit row carries the request txId [M-019 — column not yet added]', () => {
    // Body intentionally empty until M-019 migration lands.
  });

  test('50 parallel requests with distinct ids: no bleed in echo', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `tx_par${String(i).padStart(23, '0')}`);
    const responses = await Promise.all(
      ids.map((id) => http.get('/').set(AEGIS_HEADER_REQUEST_ID, id)),
    );
    expect(responses).toHaveLength(50);
    for (let i = 0; i < responses.length; i += 1) {
      const echoed = responses[i]!.headers[HEADER_LOWER];
      expect(echoed).toBe(ids[i]);
    }
  });

  test('untrusted bytes in inbound header are not echoed (fresh id minted)', async () => {
    // Header injection / control-char attempts must not be reflected. The
    // middleware drops anything outside SAFE_OPAQUE_RE and mints a fresh
    // tx_<ulid>. We only test the safe-shape rejection here because
    // Express normalises header values; embedding raw control chars would
    // be rejected by the HTTP layer before the middleware sees them.
    const bad = 'oversized'.repeat(20); // 180 chars > 128 cap
    const res = await http.get('/').set(AEGIS_HEADER_REQUEST_ID, bad);
    expect([200, 404]).toContain(res.status);
    const echoed = res.headers[HEADER_LOWER];
    expect(echoed).not.toBe(bad);
    expect(echoed as string).toMatch(ULID_RE);
  });
});
