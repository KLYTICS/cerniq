// Webhook delivery worker — BullMQ-driven, HMAC-signed, exponential
// backoff with a configurable DLQ horizon (OD-005 default = 8 attempts).
//
// Lifecycle of one webhook event:
//   1. WebhooksService persists a `WebhookDelivery` row with status=PENDING.
//   2. WebhooksService enqueues a BullMQ job referencing the row id.
//   3. This worker pulls the job, signs the payload with the per-subscription
//      secret, POSTs it to the subscription URL with a short timeout,
//      records the response code + body excerpt.
//   4. On 2xx → status=DELIVERED. On retry-eligible (5xx, network) → BullMQ
//      auto-reschedules with exponential backoff up to MAX_ATTEMPTS.
//   5. On exhausted attempts or 4xx (excluding 429) → status=ABANDONED.

import { createHmac } from 'node:crypto';

import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, QueueEvents, Worker, type Job, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

import { WebhookSecretCipher } from '../../common/crypto/webhook-secret-cipher';
import { MetricsService } from '../../common/observability/metrics.service';
import { ShutdownService } from '../../common/observability/shutdown.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';

import { checkSsrf, type SsrfRejection } from './ssrf-guard';

function describeSsrfRejection(r: SsrfRejection): string {
  switch (r.kind) {
    case 'blocked_address':
      return `ssrf_blocked_address: ${r.reason} (${r.host} → ${r.address})`;
    case 'unsupported_scheme':
      return `ssrf_unsupported_scheme: ${r.scheme}`;
    case 'invalid_url':
      return `ssrf_invalid_url: ${r.reason}`;
    case 'host_resolution_failed':
      return `ssrf_dns_failed: ${r.reason}`;
    case 'redirect_limit_exceeded':
      return `ssrf_redirect_limit_exceeded: hops=${r.hops}`;
  }
}

export const WEBHOOK_QUEUE = 'cerniq.webhooks';

/** OD-005 default. Override via env once operator decides. */
export const MAX_ATTEMPTS = 8;
/** Per-attempt HTTP timeout. Webhook receivers are usually fast or hard-down. */
export const REQUEST_TIMEOUT_MS = 5_000;
/** Retain at most this many response-body chars for diagnostics. */
const RESPONSE_BODY_TRUNCATE = 2_048;
/**
 * How often we sample BullMQ queue depth and update the gauge. 15s is a
 * compromise between scrape-resolution (Prometheus typical 15-30s) and
 * Redis load (1 `getJobCounts` ≈ 6 EXISTS calls per tick).
 */
export const QUEUE_DEPTH_SAMPLE_INTERVAL_MS = 15_000;

interface DeliveryJobData {
  deliveryId: string;
}

@Injectable()
export class WebhookDeliveryWorker implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);
  private connection?: IORedis;
  private queue?: Queue<DeliveryJobData>;
  private worker?: Worker<DeliveryJobData>;
  private events?: QueueEvents;
  private depthSampleTimer?: NodeJS.Timeout;
  private drained = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly cipher: WebhookSecretCipher,
    private readonly shutdown: ShutdownService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.enableWebhooks) {
      this.logger.log('Webhooks disabled — skipping queue setup.');
      return;
    }
    this.connection = new IORedis(this.config.redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<DeliveryJobData>(WEBHOOK_QUEUE, { connection: this.connection });
    this.worker = new Worker<DeliveryJobData>(
      WEBHOOK_QUEUE,
      async (job) => {
        await this.process(job);
      },
      {
        connection: this.connection.duplicate(),
        // 8 attempts with exponential backoff: 1s → 2s → 4s → … → ~256s.
        // Adjusted by BullMQ's `attempts` + `backoff` configuration on enqueue.
        concurrency: 16,
      },
    );
    this.events = new QueueEvents(WEBHOOK_QUEUE, { connection: this.connection.duplicate() });

    this.worker.on('failed', (job, err) => {
      const attempts = job?.attemptsMade ?? 0;
      this.logger.warn(
        `webhook delivery failed deliveryId=${job?.data.deliveryId} attempts=${attempts}: ${err?.message}`,
      );
      if (job && attempts >= MAX_ATTEMPTS) {
        void this.markAbandoned(job.data.deliveryId, err?.message ?? 'max attempts').catch(
          () => undefined,
        );
        this.metrics.bullmqJobsTotal.inc({
          queue: WEBHOOK_QUEUE,
          event: 'deliver',
          result: 'abandoned',
        });
      }
    });

    // Begin polling queue depth — fire one sample immediately so the gauge
    // is populated before the first /metrics scrape lands. Subsequent
    // ticks happen on the configured interval.
    void this.sampleQueueDepth();
    this.depthSampleTimer = setInterval(() => {
      void this.sampleQueueDepth();
    }, QUEUE_DEPTH_SAMPLE_INTERVAL_MS);
    if (typeof this.depthSampleTimer.unref === 'function') {
      // Don't keep the event loop alive purely for this timer.
      this.depthSampleTimer.unref();
    }

    // Register with the centralized shutdown coordinator. SIGTERM →
    // ShutdownService.onApplicationShutdown → drain() — drains in-flight
    // jobs (BullMQ worker.close() awaits current handler invocations).
    this.shutdown.register('webhook-delivery-worker', () => this.drain());
  }

  async onModuleDestroy(): Promise<void> {
    // Idempotent — drain() guards against double-close. NestJS may invoke
    // onModuleDestroy in addition to ShutdownService's hook, depending on
    // teardown order; we want cleanup to run exactly once.
    await this.drain();
  }

  async onApplicationShutdown(): Promise<void> {
    // Belt-and-braces: even if the central ShutdownService isn't wired
    // (e.g. integration test that bootstraps just this provider), we still
    // drain on the framework's OnApplicationShutdown hook.
    await this.drain();
  }

  /**
   * Idempotent shutdown sequence — safe to invoke from multiple lifecycle
   * hooks. Order matters:
   *   1. Stop the depth-sample interval (no more Redis traffic from us).
   *   2. `worker.close()` — BullMQ docs: close() waits for current jobs.
   *      In-flight `process()` invocations finish naturally; new jobs are
   *      not pulled.
   *   3. `events.close()` — QueueEvents subscriber stream.
   *   4. `queue.close()` — drops the producer connection.
   *   5. `connection.quit()` — graceful Redis QUIT after consumers detach.
   */
  async drain(): Promise<void> {
    if (this.drained) return;
    this.drained = true;

    if (this.depthSampleTimer) {
      clearInterval(this.depthSampleTimer);
      this.depthSampleTimer = undefined;
    }

    // Sequenced — worker first so it stops accepting new jobs and lets
    // current handlers finish before we tear the queue down underneath them.
    if (this.worker) {
      try {
        await this.worker.close();
      } catch (err) {
        this.logger.warn(`worker.close() failed: ${(err as Error).message}`);
      }
    }
    if (this.events) {
      try {
        await this.events.close();
      } catch (err) {
        this.logger.warn(`events.close() failed: ${(err as Error).message}`);
      }
    }
    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        this.logger.warn(`queue.close() failed: ${(err as Error).message}`);
      }
    }
    if (this.connection) {
      try {
        await this.connection.quit();
      } catch (err) {
        this.logger.warn(`connection.quit() failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * One-shot sample of `queue.getJobCounts()` → 6 gauge series. We catch
   * Redis errors so a transient outage doesn't unhandled-reject and crash
   * the process; sustained failures will surface as the gauge going stale
   * (Prometheus `staleness` rule on `cerniq_bullmq_queue_depth`).
   */
  private async sampleQueueDepth(): Promise<void> {
    if (!this.queue) return;
    try {
      const counts = await this.queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused',
      );
      for (const state of [
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused',
      ] as const) {
        const value = counts[state];
        if (typeof value === 'number') {
          this.metrics.bullmqQueueDepthGauge.set({ queue: WEBHOOK_QUEUE, state }, value);
        }
      }
    } catch (err) {
      this.logger.warn(`queue depth sample failed: ${(err as Error).message}`);
    }
  }

  /**
   * Enqueue a delivery for processing. Returns the BullMQ job id (useful
   * for the dashboard to surface in-flight state).
   */
  async enqueue(deliveryId: string): Promise<string | undefined> {
    if (!this.queue) return undefined;
    const opts: JobsOptions = {
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { count: 1_000, age: 86_400 },
      removeOnFail: { count: 1_000, age: 7 * 86_400 },
      jobId: `del:${deliveryId}`,
    };
    const job = await this.queue.add('deliver', { deliveryId }, opts);
    return job.id;
  }

  private async process(job: Job<DeliveryJobData>): Promise<void> {
    // BullMQ-level timing + outcome instrumentation. We capture the result
    // in a local that the success / abandon branches below set; on uncaught
    // throw the catch in the finally bookkeeper records 'failed' (BullMQ
    // will retry until attempts exhaust). `eventLabel` defaults to 'deliver'
    // until we've loaded the delivery row.
    const startedAt = Date.now();
    let outcome: 'success' | 'failed' | 'abandoned' = 'failed';
    let eventLabel = 'deliver';
    try {
      const result = await this.processInner(job);
      outcome = result.outcome;
      eventLabel = result.eventLabel;
    } catch (err) {
      outcome = 'failed';
      throw err;
    } finally {
      this.metrics.bullmqJobProcessingMs.observe(
        { queue: WEBHOOK_QUEUE, event: eventLabel },
        Date.now() - startedAt,
      );
      this.metrics.bullmqJobsTotal.inc({
        queue: WEBHOOK_QUEUE,
        event: eventLabel,
        result: outcome,
      });
    }
  }

  private async processInner(
    job: Job<DeliveryJobData>,
  ): Promise<{ outcome: 'success' | 'abandoned'; eventLabel: string }> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: job.data.deliveryId },
      include: { subscription: true },
    });
    if (!delivery) throw new Error(`delivery ${job.data.deliveryId} missing`);
    const eventLabel = delivery.event;
    if (delivery.status === 'DELIVERED' || delivery.status === 'ABANDONED') {
      return { outcome: 'success', eventLabel };
    }

    // SSRF guard — release-blocker per Round 2 risk #1. We refuse to dial
    // private/loopback/link-local addresses even if a customer registers
    // a webhook URL pointing at one. Failure here is permanent (no retry).
    const ssrf = await checkSsrf(delivery.subscription.url);
    if (ssrf.kind !== 'ok') {
      const reason = describeSsrfRejection(ssrf);
      await this.markAbandoned(delivery.id, reason);
      this.metrics.webhookDeliveryTotal.inc({ status: 'ABANDONED', event: delivery.event });
      this.logger.warn(`webhook ${delivery.id} ${reason}`);
      return { outcome: 'abandoned', eventLabel };
    }

    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      data: delivery.payload,
      ts,
    });

    // Decrypt the per-subscription HMAC secret just-in-time. Subscriptions
    // created before envelope encryption rolled out still hold a plaintext
    // `whsec_...` value; the `isEncrypted` branch lets them keep delivering
    // until the operator re-issues the secret. No silent fallbacks: if a
    // ciphertext fails to decrypt we ABANDON rather than risk a forged
    // signature header (CLAUDE.md invariant 4).
    let plainSecret: string;
    try {
      plainSecret = this.cipher.isEncrypted(delivery.subscription.secret)
        ? this.cipher.decrypt(delivery.subscription.secret)
        : delivery.subscription.secret;
    } catch (err) {
      this.metrics.webhookSecretDecryptFailureTotal.inc();
      this.logger.error(
        `webhook secret decrypt failed delivery=${delivery.id} sub=${delivery.subscription.id}: ${(err as Error).message}`,
      );
      await this.markAbandoned(delivery.id, 'secret_decrypt_failed');
      this.metrics.webhookDeliveryTotal.inc({ status: 'ABANDONED', event: delivery.event });
      return { outcome: 'abandoned', eventLabel };
    }

    const signature = WebhookDeliveryWorker.sign(plainSecret, ts, body);

    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
    }, REQUEST_TIMEOUT_MS);

    let responseCode: number | null = null;
    let responseBody: string | null = null;

    try {
      const res = await fetch(delivery.subscription.url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-CERNIQ-Signature': signature,
          'X-CERNIQ-Event': delivery.event,
          'X-CERNIQ-Delivery-Id': delivery.id,
          'User-Agent': '@cerniq/webhooks 0.1',
        },
        body,
      });
      responseCode = res.status;
      responseBody = (await res.text()).slice(0, RESPONSE_BODY_TRUNCATE);

      if (res.ok) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'DELIVERED',
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
            responseCode,
            responseBody,
          },
        });
        this.metrics.webhookDeliveryTotal.inc({ status: 'DELIVERED', event: delivery.event });
        return { outcome: 'success', eventLabel };
      }

      // Permanent failure on 4xx (except 429 — rate limit) → don't retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        await this.markAbandoned(delivery.id, `HTTP ${res.status}`, responseCode, responseBody);
        this.metrics.webhookDeliveryTotal.inc({ status: 'ABANDONED', event: delivery.event });
        return { outcome: 'abandoned', eventLabel };
      }

      // Transient — let BullMQ retry per `attempts` policy.
      await this.recordTransientFailure(delivery.id, responseCode, responseBody);
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      const msg = (err as Error).message;
      await this.recordTransientFailure(delivery.id, responseCode, responseBody ?? msg);
      this.metrics.webhookDeliveryTotal.inc({ status: 'FAILED', event: delivery.event });
      throw err; // BullMQ retries
    } finally {
      clearTimeout(timer);
    }
  }

  private async recordTransientFailure(
    id: string,
    code: number | null,
    body: string | null,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: 'PENDING', // BullMQ owns the retry
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        responseCode: code ?? undefined,
        responseBody: body ?? undefined,
      },
    });
  }

  private async markAbandoned(
    id: string,
    reason: string,
    code: number | null = null,
    body: string | null = null,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: 'ABANDONED',
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        responseCode: code ?? undefined,
        responseBody: body ?? reason,
        nextRetryAt: null,
      },
    });
    this.logger.warn(`webhook ABANDONED delivery=${id} reason=${reason}`);
  }

  /**
   * Stable signature header value. Stripe-style:
   *   t=<unix-timestamp>,v1=<hmac-sha256-hex(`${ts}.${body}`)>
   *
   * Subscribers verify by re-computing on their side; tolerance window
   * recommended at ≤ 5 min to defeat replay.
   */
  static sign(secret: string, ts: number, body: string): string {
    const h = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    return `t=${ts},v1=${h}`;
  }
}
