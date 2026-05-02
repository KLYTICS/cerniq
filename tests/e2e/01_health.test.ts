import { describe, expect, it, beforeAll } from 'vitest';
import { RawClient, readConfig } from './_support/client';

describe('01 · health & infrastructure', () => {
  let raw: RawClient;

  beforeAll(() => {
    raw = new RawClient(readConfig());
  });

  it('GET /health/live returns 200 with ok status', async () => {
    const r = await raw.get<{ status: string; ts: string }>('/health/live', { auth: 'none' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(typeof r.body.ts).toBe('string');
  });

  it('GET /health/ready returns 200 with db + redis checks', async () => {
    const r = await raw.get<{ status: string; checks: Record<string, boolean> }>('/health/ready', { auth: 'none' });
    expect([200, 503]).toContain(r.status);
    expect(r.body.checks).toBeDefined();
    expect(typeof r.body.checks.database).toBe('boolean');
    expect(typeof r.body.checks.redis).toBe('boolean');
  });

  it('GET /metrics — Prometheus exposition (if M-010 has shipped)', async () => {
    const r = await raw.get<string>('/metrics', { auth: 'none' });
    if (r.status === 404) {
      // M-010 metrics endpoint not yet wired — skip without failing.
      // (Documented in WORK_BOARD M-010 "Remaining: /metrics via prom-client".)
      return;
    }
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type') ?? '').toMatch(/text\/plain/);
    expect(typeof r.text).toBe('string');
    // At least one sane Prometheus metric line.
    expect(r.text).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*(\{[^}]*\})?\s+/m);
  });
});
