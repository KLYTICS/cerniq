import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

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
   * Increments when the per-subscription HMAC secret cannot be decrypted
   * at delivery time. Causes: rotated DEK without re-encrypting rows,
   * tampered `WebhookSubscription.secret` column, format corruption.
   * Each increment ABANDONS one delivery — alarm at >0 per minute, page
   * at any sustained rate (means outgoing webhooks are silently broken
   * for at least one subscription).
   */
  readonly webhookSecretDecryptFailureTotal = new Counter({
    name: 'aegis_webhook_secret_decrypt_failure_total',
    help: 'Webhook deliveries ABANDONED because the encrypted secret could not be unwrapped.',
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

  /**
   * Outbox drain outcomes — `outcome ∈ {ok, fail, no_handler}`. ADR-0007.
   * Sustained `outcome=fail` increments without `outcome=ok` mean a producer
   * is enqueueing rows that no consumer can process — page after >5min.
   */
  readonly outboxDrainedTotal = new Counter({
    name: 'aegis_outbox_drained_total',
    help: 'Outbox rows processed by the OutboxWorker, by kind and outcome.',
    labelNames: ['kind', 'outcome'] as const,
  });

  /**
   * Outbox dead-letter — increments when a row hits `maxAttempts` without
   * ever succeeding. Each increment requires a manual replay or RCA;
   * alarm at >0 per hour.
   */
  readonly outboxDeadLetteredTotal = new Counter({
    name: 'aegis_outbox_dead_lettered_total',
    help: 'Outbox rows that exhausted retries — manual intervention required.',
    labelNames: ['kind'] as const,
  });

  /**
   * G-3: BATE anomaly detector triggers — increments each time one of the
   * five anomaly rules (R-1…R-5) fires during a BATE recompute. Low cardinality:
   * `rule` ∈ {r1_velocity, r2_geo, r3_spend_cv, r4_failed_verify, r5_delegation}.
   * Alert: any single agent_id accumulating >10 triggers/hour warrants review.
   */
  readonly bateAnomalyTriggerTotal = new Counter({
    name: 'aegis_bate_anomaly_trigger_total',
    help: 'Number of BATE anomaly rule firings during recompute jobs, by rule.',
    labelNames: ['rule'] as const,
  });

  /**
   * G-3 sweep: count of policies revoked by `PolicyExpiryWorker` and the
   * outcome bucket. Sample alert: `rate(aegis_policy_expired_swept_total[1h])
   * > 100` means a customer is mass-issuing short-TTL policies.
   */
  readonly policyExpiredSweptTotal = new Counter({
    name: 'aegis_policy_expired_swept_total',
    help: 'Number of policies revoked by the expiry sweep worker.',
    labelNames: ['outcome'] as const,
  });

  /**
   * Audit-retention sweep: number of audit events whose raw columns were
   * zeroed because they aged past their plan's `auditRetentionDays`. The
   * underlying redaction goes through `RedactService.redactEvent` so the
   * audit chain stays cryptographically intact (hash columns + signature
   * untouched, redaction itself appended as a meta-event).
   *
   * No labels by design — bounded cardinality, retention reason is fixed
   * per run and recorded on the meta-event itself, not on the metric.
   * Sample alert: a sustained zero rate when DB volume is growing means
   * the retention worker is no longer firing — page operators.
   */
  readonly auditRetentionEventsRedactedTotal = new Counter({
    name: 'aegis_audit_retention_events_redacted_total',
    help: 'Audit events redacted by the retention sweep (chain intact, raw columns zeroed).',
  });

  /**
   * Hand-rolled circuit breaker state per outbound dependency. Numeric
   * encoding: 0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN. Low cardinality —
   * the `breaker` label is restricted to the wired callsites:
   * 'kms.aws.decrypt', 'kms.gcp.sign', 'kms.vault.sign', 'stripe.api'.
   * Alert: any non-zero value sustained > 1 min indicates a wedged
   * dependency — page on `aegis_circuit_breaker_state{breaker=~".+"} > 0`.
   */
  readonly circuitBreakerStateGauge = new Gauge({
    name: 'aegis_circuit_breaker_state',
    help: 'Outbound circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN).',
    labelNames: ['breaker'] as const,
  });

  /**
   * Total CLOSED→OPEN transitions per breaker. Each increment is an SLO
   * burn event (a downstream dependency just degraded). Alert at any
   * non-zero `rate(aegis_circuit_breaker_trips_total[5m])`.
   */
  readonly circuitBreakerTripsTotal = new Counter({
    name: 'aegis_circuit_breaker_trips_total',
    help: 'Number of CLOSED→OPEN transitions per outbound circuit breaker.',
    labelNames: ['breaker'] as const,
  });

  /**
   * BullMQ queue depth gauge — sampled on a 15s interval per queue. Labels
   * are bounded enums:
   *   - `queue`  ∈ {'aegis.webhooks', …} (one per BullMQ queue we run).
   *   - `state`  ∈ {'waiting','active','completed','failed','delayed','paused'}.
   *
   * 1 queue × 6 states = 6 series — well under any cardinality budget.
   * Alert: `aegis_bullmq_queue_depth{state="waiting",queue="aegis.webhooks"} > 1000`
   * for >5min means consumers can't keep up; page operators.
   */
  readonly bullmqQueueDepthGauge = new Gauge({
    name: 'aegis_bullmq_queue_depth',
    help: 'BullMQ queue depth, sampled per state.',
    labelNames: ['queue', 'state'] as const,
  });

  /**
   * Per-job processing duration in milliseconds, by queue + event kind.
   * Buckets cover the SLO range from very fast (<10ms in-process) up to
   * worst-case 30s — anything beyond that is treated as a stall and the
   * job will be retried by BullMQ before the bucket fires.
   */
  readonly bullmqJobProcessingMs = new Histogram({
    name: 'aegis_bullmq_job_processing_ms',
    help: 'BullMQ job processing duration in milliseconds.',
    labelNames: ['queue', 'event'] as const,
    buckets: [10, 50, 100, 500, 1_000, 5_000, 10_000, 30_000],
  });

  /**
   * Per-job terminal outcome counter. `result` is bounded to:
   *   - 'success'   — handler returned without throwing.
   *   - 'failed'    — handler threw; BullMQ will retry until attempts exhaust.
   *   - 'abandoned' — attempts exhausted (final failure) or non-retryable
   *                    permanent error (e.g. HTTP 4xx, secret_decrypt_failed).
   */
  readonly bullmqJobsTotal = new Counter({
    name: 'aegis_bullmq_jobs_total',
    help: 'BullMQ job outcomes by queue, event kind, and terminal result.',
    labelNames: ['queue', 'event', 'result'] as const,
  });

  /**
   * ADR-0014 / Round 17 — TrialService gauges. Bounded cardinality (no
   * labels): `principalId` would explode label space, so we only count
   * aggregate volume. Per-principal observability lives in the audit
   * chain + dashboard query against `Principal.trialUsedCount`.
   */
  readonly trialUsageIncrementedTotal = new Counter({
    name: 'aegis_trial_usage_incremented_total',
    help: 'Number of FREE-tier verify increments through the lifetime trial counter.',
  });

  readonly trialExhaustedTotal = new Counter({
    name: 'aegis_trial_exhausted_total',
    help: 'Number of TRIAL_EXHAUSTED denials emitted (cap reached or fail-closed).',
  });

  /**
   * RFC-9396 RAR (Rich Authorization Requests) decision metrics.
   *
   * Labels are bounded enums:
   *   - `result`: 'allow' | 'deny'
   *   - `detail_type`: bounded by REGISTERED_AUTH_DETAIL_TYPES in
   *     verify/rar/rar.types.ts (currently: trading_order |
   *     payment_initiation | data_access | agent_action | 'none' when
   *     evaluator short-circuits before matching).
   *   - `deny_reason`: bounded by RarDenyReason union ('allow' when
   *     result=allow). New variants require updating this comment and
   *     the RAR evaluator together.
   *
   * Use these to alert on RAR deny spikes per detail_type — a sudden
   * elevation in `limit_exceeded` on `trading_order`, for example, is
   * a signal that an agent is misconfigured or compromised.
   */
  readonly rarEvaluationsTotal = new Counter({
    name: 'aegis_rar_evaluations_total',
    help: 'RFC-9396 RAR evaluations by outcome, detail type, and deny reason.',
    labelNames: ['result', 'detail_type', 'deny_reason'] as const,
  });

  readonly rarEvaluationLatency = new Histogram({
    name: 'aegis_rar_evaluation_latency_seconds',
    help: 'Latency of /v1/verify/rar/evaluate in seconds. Pure-function evaluator — sub-millisecond expected.',
    labelNames: ['result'] as const,
    // RAR evaluator is pure-function; sub-ms expected. Buckets sized to
    // catch a regression that would push past 5ms (i.e. accidental I/O).
    buckets: [0.0001, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1],
  });

  // ── Intent Manifest (ADR-0017) ─────────────────────────────────────
  //
  // Operator dashboard SLOs typically:
  //   - issued_total — adoption metric; expect monotonic growth once
  //     AEGIS_INTENT_MANIFEST_ENABLED flips.
  //   - reconciled_total{outcome="mismatch_denied"} — security signal;
  //     spike rate > 1/sec per principal warrants a manual review.
  //   - mismatch_total — per-kind breakdown; over-amount-cap + wrong-
  //     merchant are stronger signals than over-call-count.

  readonly intentIssuedTotal = new Counter({
    name: 'aegis_intent_issued_total',
    help: 'Intent manifests issued via POST /v1/intent.',
    labelNames: ['intent_kind'] as const, // 'http-call' | 'commerce-action' | 'tool-invocation'
  });

  readonly intentIssueLatency = new Histogram({
    name: 'aegis_intent_issue_latency_seconds',
    help: 'Latency of POST /v1/intent end-to-end (algorithm + adapter).',
    // Issuance includes KMS-backed signing — sub-50ms in steady state.
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  });

  readonly intentReconciledTotal = new Counter({
    name: 'aegis_intent_reconciled_total',
    help: 'Intent reconciliation outcomes by terminal result.',
    labelNames: ['outcome'] as const, // 'clean' | 'mismatch_advised' | 'mismatch_denied' | 'replay'
  });

  readonly intentReconcileLatency = new Histogram({
    name: 'aegis_intent_reconcile_latency_seconds',
    help: 'Latency of POST /v1/intent/{id}/actuals end-to-end.',
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  });

  readonly intentMismatchTotal = new Counter({
    name: 'aegis_intent_mismatch_total',
    help: 'Individual IntentMismatchKind occurrences across reconciliation outcomes.',
    labelNames: ['mismatch_kind'] as const,
    // Bounded enum — 8 kinds per packages/intent-manifest types.ts.
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
    this.registry.registerMetric(this.webhookSecretDecryptFailureTotal);
    this.registry.registerMetric(this.cacheSetFailedTotal);
    this.registry.registerMetric(this.outboxDrainedTotal);
    this.registry.registerMetric(this.outboxDeadLetteredTotal);
    this.registry.registerMetric(this.bateAnomalyTriggerTotal);
    this.registry.registerMetric(this.policyExpiredSweptTotal);
    this.registry.registerMetric(this.auditRetentionEventsRedactedTotal);
    this.registry.registerMetric(this.circuitBreakerStateGauge);
    this.registry.registerMetric(this.circuitBreakerTripsTotal);
    this.registry.registerMetric(this.bullmqQueueDepthGauge);
    this.registry.registerMetric(this.bullmqJobProcessingMs);
    this.registry.registerMetric(this.bullmqJobsTotal);
    this.registry.registerMetric(this.trialUsageIncrementedTotal);
    this.registry.registerMetric(this.trialExhaustedTotal);
    this.registry.registerMetric(this.rarEvaluationsTotal);
    this.registry.registerMetric(this.rarEvaluationLatency);
    this.registry.registerMetric(this.intentIssuedTotal);
    this.registry.registerMetric(this.intentIssueLatency);
    this.registry.registerMetric(this.intentReconciledTotal);
    this.registry.registerMetric(this.intentReconcileLatency);
    this.registry.registerMetric(this.intentMismatchTotal);
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
