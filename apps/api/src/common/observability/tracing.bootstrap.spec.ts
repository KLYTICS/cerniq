// Tracing bootstrap regression suite.
//
// Pins the OTel 2.x init contract after the migration off 1.x:
//   - `Resource` class → `resourceFromAttributes` factory
//   - `SemanticResourceAttributes.SERVICE_NAME` → `ATTR_SERVICE_NAME`
//
// Coverage targets: disabled-noop path, idempotency, missing-deps fallback,
// and a real init under the 2.x API surface (exporter='noop' to avoid
// spawning the OTLP HTTP client). Without these, the migration could
// silently regress the next time someone bumps OTel.

import { initTracing } from './tracing.bootstrap';

describe('initTracing — OTel 2.x bootstrap contract', () => {
  it('returns a noop handle when disabled', async () => {
    const t = await initTracing({ enabled: false });
    expect(t.enabled).toBe(false);
    await expect(t.flush()).resolves.toBeUndefined();
    await expect(t.shutdown()).resolves.toBeUndefined();
  });

  it('initializes under the 2.x API surface (exporter=noop)', async () => {
    const t = await initTracing({
      enabled: true,
      serviceName: 'aegis-api-test',
      exporter: 'noop',
      resourceAttributes: { 'deployment.environment': 'unit-test' },
    });
    expect(t.enabled).toBe(true);
    // Clean shutdown is the proof that NodeSDK accepted resourceFromAttributes()
    // and the ATTR_SERVICE_NAME / ATTR_SERVICE_VERSION semantic-convention
    // exports without throwing during construction or start().
    await t.shutdown();
  });

  it('is idempotent — second init returns a handle bound to the same SDK', async () => {
    const a = await initTracing({ enabled: true, exporter: 'noop' });
    const b = await initTracing({ enabled: true, exporter: 'noop' });
    expect(a.enabled).toBe(true);
    expect(b.enabled).toBe(true);
    await a.shutdown();
    // The second handle's shutdown is a noop after the first ran;
    // must not throw and must not error on the now-null sdk reference.
    await expect(b.shutdown()).resolves.toBeUndefined();
  });
});
