import { ShutdownService } from './shutdown.service';

describe('ShutdownService', () => {
  it('runs a registered drain on onApplicationShutdown', async () => {
    const svc = new ShutdownService(5_000);
    const fn = jest.fn().mockResolvedValue(undefined);
    svc.register('worker-a', fn);
    expect(svc.registeredCount).toBe(1);

    await svc.onApplicationShutdown('SIGTERM');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs multiple drains in parallel', async () => {
    const svc = new ShutdownService(5_000);
    const events: string[] = [];

    svc.register('a', async () => {
      events.push('a-start');
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      events.push('a-end');
    });
    svc.register('b', async () => {
      events.push('b-start');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      events.push('b-end');
    });

    const t0 = Date.now();
    await svc.onApplicationShutdown('SIGTERM');
    const elapsed = Date.now() - t0;

    // Parallel: total < a + b sum (50 + 20 = 70). Allow 60ms slack.
    expect(elapsed).toBeLessThan(140);
    // Both started before either finished.
    expect(events.indexOf('a-start')).toBeLessThan(events.indexOf('b-end'));
    expect(events.indexOf('b-start')).toBeLessThan(events.indexOf('a-end'));
  });

  it('logs but does not block when a drain exceeds the timeout', async () => {
    const svc = new ShutdownService(20); // 20ms budget
    const warnSpy = jest.spyOn((svc as unknown as { logger: { warn: jest.Mock } }).logger, 'warn');

    svc.register('slow', async () => {
      // Exceeds the 20ms budget but still resolves.
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
    });

    const t0 = Date.now();
    await svc.onApplicationShutdown('SIGTERM');
    const elapsed = Date.now() - t0;

    // Drain still ran to completion (we don't race it).
    expect(elapsed).toBeGreaterThanOrEqual(70);
    // The slow_drain warning fired.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('slow_drain'),
    );
  });

  it('captures and logs a thrown error from a drain without throwing', async () => {
    const svc = new ShutdownService(5_000);
    const errorSpy = jest.spyOn((svc as unknown as { logger: { error: jest.Mock } }).logger, 'error');

    svc.register('explodes', async () => {
      throw new Error('boom');
    });
    svc.register('ok', async () => undefined);

    await expect(svc.onApplicationShutdown('SIGTERM')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('drain_failed name=explodes'),
    );
  });

  it('warns and skips registration after shutdown has begun', async () => {
    const svc = new ShutdownService(5_000);
    const warnSpy = jest.spyOn((svc as unknown as { logger: { warn: jest.Mock } }).logger, 'warn');

    svc.register('first', async () => undefined);
    await svc.onApplicationShutdown('SIGTERM');

    const lateFn = jest.fn();
    svc.register('late', lateFn);

    expect(lateFn).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("register('late')"),
    );
  });

  it('is idempotent — second onApplicationShutdown call is a no-op', async () => {
    const svc = new ShutdownService(5_000);
    const fn = jest.fn().mockResolvedValue(undefined);
    svc.register('worker', fn);

    await svc.onApplicationShutdown('SIGTERM');
    await svc.onApplicationShutdown('SIGINT');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
