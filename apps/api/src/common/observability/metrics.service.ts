import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics surface — single registry per process.
 *
 * Naming follows the Prometheus convention: `<unit>_<noun>_<verb>` with
 * SI units (`_seconds`, `_bytes`, `_total`). Labels are kept low-cardinality
 * — `denial_reason`, `signal_type`, `decision` are bounded enums; do not
 * add free-form labels (URL paths, agent ids, etc.) without explicit review.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  readonly verifyLatency = new Histogram({
    name: 'aegis_verify_latency_seconds',
    help: 'Latency of /v1/verify in seconds.',
    labelNames: ['decision'] as const,
    // Phase 1 origin target is 200 ms p99; Phase 3 edge is 80 ms.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2.5, 5],
  });

  readonly verifyTotal = new Counter({
    name: 'aegis_verify_total',
    help: 'Verify decisions by outcome.',
    labelNames: ['decision', 'denial_reason'] as const,
  });

  readonly bateScoreDelta = new Histogram({
    name: 'aegis_bate_score_delta',
    help: 'Trust-score delta per BATE signal application.',
    labelNames: ['signal_type'] as const,
    buckets: [-500, -250, -100, -50, -20, -5, 0, 5, 20, 50, 100, 250, 500],
  });

  readonly httpRequestsTotal = new Counter({
    name: 'aegis_http_requests_total',
    help: 'HTTP requests handled, by route + status class.',
    labelNames: ['method', 'route', 'status_class'] as const,
  });

  readonly auditAppendTotal = new Counter({
    name: 'aegis_audit_append_total',
    help: 'Audit chain appends.',
    labelNames: ['result'] as const, // ok | error
  });

  readonly webhookDeliveryTotal = new Counter({
    name: 'aegis_webhook_delivery_total',
    help: 'Webhook delivery attempts by terminal status.',
    labelNames: ['status', 'event'] as const,
  });

  /**
   * Best-effort cache writes (Redis SET) that fail without breaking the
   * caller. H-3 fix — sustained increments on this counter mean a Redis
   * incident is silently piling DB load; alarm threshold > 1/sec.
   */
  readonly cacheSetFailedTotal = new Counter({
    name: 'aegis_cache_set_failed_total',
    help: 'Best-effort cache writes that failed (Redis outage / eviction / type mismatch).',
    labelNames: ['op'] as const, // 'agent' | 'policy' | 'touch_agent' | 'spend_day' | 'spend_month' | 'verify_result'
  });

  onModuleInit(): void {
    // Default Node + process metrics — heap, event loop lag, GC, etc.
    collectDefaultMetrics({ register: this.registry, prefix: 'aegis_' });
    this.registry.registerMetric(this.verifyLatency);
    this.registry.registerMetric(this.verifyTotal);
    this.registry.registerMetric(this.bateScoreDelta);
    this.registry.registerMetric(this.httpRequestsTotal);
    this.registry.registerMetric(this.auditAppendTotal);
    this.registry.registerMetric(this.webhookDeliveryTotal);
    this.registry.registerMetric(this.cacheSetFailedTotal);
  }

  /**
   * Render the registry in Prometheus text exposition format.
   *
   * SECURITY: Metrics include process counters that are mildly sensitive
   * (latency distributions can fingerprint the deployment). The /metrics
   * route should be reachable only from the cluster's monitoring scraper —
   * gate it behind a private network or a dedicated bearer token.
   */
  async render(): Promise<{ contentType: string; body: string }> {
    return { contentType: this.registry.contentType, body: await this.registry.metrics() };
  }
}
