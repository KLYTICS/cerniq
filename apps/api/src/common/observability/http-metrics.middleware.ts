import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * HTTP request middleware. Increments `aegis_http_requests_total` per
 * request keyed by method + (low-cardinality) route + status class.
 *
 * "Low-cardinality" matters: we use the matched route template
 * (`/v1/agents/:agentId`) rather than the URL (which would explode
 * cardinality with thousands of agent ids and break Prometheus).
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    res.on('finish', () => {
      const route = (req.route?.path as string | undefined) ?? routeFromUrl(req.originalUrl);
      const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
      this.metrics.httpRequestsTotal.inc({ method: req.method, route, status_class: statusClass });
    });
    next();
  }
}

function routeFromUrl(url: string): string {
  // Best-effort fallback — collapse anything that looks like an id.
  const path = url.split('?')[0] ?? '/';
  return path
    .replace(/\/agt_[a-zA-Z0-9_-]+/g, '/:agentId')
    .replace(/\/pol_[a-zA-Z0-9_-]+/g, '/:policyId')
    .replace(/\/evt_[a-zA-Z0-9_-]+/g, '/:eventId')
    .replace(/\/[0-9a-f-]{20,}/g, '/:id');
}
