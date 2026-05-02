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

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, QueueEvents, Worker, type Job, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../common/observability/metrics.service';
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

export const WEBHOOK_QUEUE = 'aegis.webhooks';

/** OD-005 default. Override via env once operator decides. */
export const MAX_ATTEMPTS = 8;
/** Per-attempt HTTP timeout. Webhook receivers are usually fast or hard-down. */
export const REQUEST_TIMEOUT_MS = 5_000;
/** Retain at most this many response-body chars for diagnostics. */
const RESPONSE_BODY_TRUNCATE = 2_048;

interface DeliveryJobData {
  deliveryId: string;
}

@Injectable()
export class WebhookDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);
  private connection?: IORedis;
  private queue?: Queue<DeliveryJobData>;
  private worker?: Worker<DeliveryJobData>;
  private events?: QueueEvents;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
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
      async (job) => this.process(job),
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
      this.logger.warn(`webhook delivery failed deliveryId=${job?.data.deliveryId} attempts=${attempts}: ${err?.message}`);
      if (job && attempts >= MAX_ATTEMPTS) {
        void this.markAbandoned(job.data.deliveryId, err?.message ?? 'max attempts').catch(() => undefined);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.events?.close(), this.queue?.close()]);
    await this.connection?.quit();
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
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: job.data.deliveryId },
      include: { subscription: true },
    });
    if (!delivery) throw new Error(`delivery ${job.data.deliveryId} missing`);
    if (delivery.status === 'DELIVERED' || delivery.status === 'ABANDONED') return;

    // SSRF guard — release-blocker per Round 2 risk #1. We refuse to dial
    // private/loopback/link-local addresses even if a customer registers
    // a webhook URL pointing at one. Failure here is permanent (no retry).
    const ssrf = await checkSsrf(delivery.subscription.url);
    if (ssrf.kind !== 'ok') {
      const reason = describeSsrfRejection(ssrf);
      await this.markAbandoned(delivery.id, reason);
      this.metrics.webhookDeliveryTotal.inc({ status: 'ABANDONED', event: delivery.event });
      this.logger.warn(`webhook ${delivery.id} ${reason}`);
      return;
    }

    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: delivery.id, event: delivery.event, data: delivery.payload, ts });
    const signature = WebhookDeliveryWorker.sign(delivery.subscription.secret, ts, body);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

    let responseCode: number | null = null;
    let responseBody: string | null = null;

    try {
      const res = await fetch(delivery.subscription.url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-AEGIS-Signature': signature,
          'X-AEGIS-Event': delivery.event,
          'X-AEGIS-Delivery-Id': delivery.id,
          'User-Agent': '@aegis/webhooks 0.1',
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
        return;
      }

      // Permanent failure on 4xx (except 429 — rate limit) → don't retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        await this.markAbandoned(delivery.id, `HTTP ${res.status}`, responseCode, responseBody);
        this.metrics.webhookDeliveryTotal.inc({ status: 'ABANDONED', event: delivery.event });
        return;
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

  private async recordTransientFailure(id: string, code: number | null, body: string | null): Promise<void> {
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
