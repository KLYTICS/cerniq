/**
 * MetricsController — unit tests
 *
 * Prometheus exposition endpoint. Public route — ApiKeyGuard not applied.
 * Controller calls MetricsService.render() and pipes the content-type +
 * body to the Express response.
 */

import type { Response } from 'express';

import type { MetricsService } from '../../common/observability/metrics.service';

import { MetricsController } from './metrics.controller';

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeMetrics(): jest.Mocked<Pick<MetricsService, 'render'>> {
  return {
    render: jest.fn().mockResolvedValue({
      contentType: 'text/plain; version=0.0.4; charset=utf-8',
      body: '# HELP okoro_verify_total Total verifications\nokoro_verify_total 42\n',
    }),
  };
}

function makeRes(): jest.Mocked<Response> {
  return {
    setHeader: jest.fn(),
    send: jest.fn(),
  } as unknown as jest.Mocked<Response>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MetricsController', () => {
  describe('render()', () => {
    it('calls metrics.render once', async () => {
      const metrics = makeMetrics();
      const controller = new MetricsController(metrics as unknown as MetricsService);
      await controller.render(makeRes());
      expect(metrics.render).toHaveBeenCalledTimes(1);
    });

    it('sets the Content-Type header from the render result', async () => {
      const metrics = makeMetrics();
      const controller = new MetricsController(metrics as unknown as MetricsService);
      const res = makeRes();
      await controller.render(res);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
    });

    it('sends the metrics body via res.send', async () => {
      const metrics = makeMetrics();
      const controller = new MetricsController(metrics as unknown as MetricsService);
      const res = makeRes();
      await controller.render(res);
      const body = (res.send as jest.Mock).mock.calls[0]?.[0] as string;
      expect(body).toContain('okoro_verify_total');
    });

    it('does NOT call res.end separately (res.send handles it)', async () => {
      const metrics = makeMetrics();
      const controller = new MetricsController(metrics as unknown as MetricsService);
      const res = makeRes();
      // res.end is not on our mock — if it were, we'd verify it's not called
      await controller.render(res);
      expect(res.send).toHaveBeenCalledTimes(1);
    });
  });
});
