import { describe, expect, it, beforeAll } from 'vitest';
import { RawClient, readConfig } from './_support/client';

/**
 * Principal lifecycle tests.
 *
 * v2 reality: the API does not (yet) expose POST /v1/principals/register —
 * principals + API keys are bootstrapped by the operator (`scripts/seed-dev.ts`
 * per WORK_BOARD M-017). The v1 prototype had a self-service endpoint;
 * the production design moves that behind the dashboard / billing flow.
 *
 * Until that endpoint exists, this file exercises the *consequences* of
 * having a bootstrapped key: invalid keys are rejected, the key the
 * harness was given is accepted.
 */
describe('02 · principal & api key', () => {
  let raw: RawClient;

  beforeAll(() => {
    raw = new RawClient(readConfig());
  });

  it('the configured api key is accepted (sanity)', async () => {
    // Hitting any authenticated GET — agents list is the cheapest.
    // 404 is fine; that means "auth passed but resource doesn't exist".
    const r = await raw.get('/v1/agents/agt_does_not_exist');
    expect([200, 404]).toContain(r.status);
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(403);
  });

  it('invalid api key returns 401', async () => {
    const cfg = readConfig();
    const bad = new RawClient({ ...cfg, apiKey: 'aegis_sk_definitely_not_a_real_key_0123456789' });
    const r = await bad.get('/v1/agents/agt_anything');
    expect(r.status).toBe(401);
  });

  it('missing api key returns 401', async () => {
    const r = await raw.get('/v1/agents/agt_anything', { auth: 'none' });
    expect(r.status).toBe(401);
  });

  it('POST /v1/principals/register — self-service path (skipped if not implemented)', async () => {
    // Probe; if not implemented (404), skip without failing.
    const probe = await raw.post('/v1/principals/register', { email: `probe-${Date.now()}@aegis-test.io` }, { auth: 'none' });
    if (probe.status === 404) return;
    expect([201, 409]).toContain(probe.status);
    if (probe.status === 201) {
      const body = probe.body as { principalId?: string; apiKey?: string };
      expect(body.principalId).toMatch(/^pri_/);
      expect(body.apiKey).toMatch(/^aegis_sk_/);

      // Duplicate email rejection.
      const dup = await raw.post(
        '/v1/principals/register',
        { email: (probe.body as { email?: string }).email ?? 'probe@aegis-test.io' },
        { auth: 'none' },
      );
      expect([409, 400]).toContain(dup.status);
    }
  });
});
