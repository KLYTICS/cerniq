import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  validateWebhookPayload,
  WebhookPayloadValidationError,
} from '@aegis/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { WebhookSecretCipher } from '../../common/crypto/webhook-secret-cipher';
import { WebhookDeliveryWorker } from './webhook.delivery';

export interface WebhookEvent {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Webhook subscription + dispatch surface.
 *
 * On `enqueue`, persists one `WebhookDelivery` per matching active
 * subscription, then hands the row id to `WebhookDeliveryWorker` which
 * owns the actual HTTP delivery, retry, and DLQ semantics.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: WebhookDeliveryWorker,
    private readonly cipher: WebhookSecretCipher,
    private readonly metrics: MetricsService,
  ) {}

  async subscribe(principalId: string, url: string, events: string[]): Promise<{ id: string; secret: string }> {
    // The plaintext is returned to the caller exactly once — they store it,
    // we only retain its AES-256-GCM ciphertext. `WebhookDeliveryWorker.process`
    // decrypts just-in-time before HMAC-signing each outgoing payload.
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const ciphertext = this.cipher.encrypt(secret);
    const sub = await this.prisma.webhookSubscription.create({
      data: { principalId, url, secret: ciphertext, events },
    });
    return { id: sub.id, secret };
  }

  async unsubscribe(principalId: string, id: string): Promise<void> {
    await this.prisma.webhookSubscription.deleteMany({ where: { id, principalId } });
  }

  async list(principalId: string): Promise<Array<{ id: string; url: string; events: string[]; active: boolean }>> {
    const subs = await this.prisma.webhookSubscription.findMany({ where: { principalId } });
    return subs.map((s) => ({ id: s.id, url: s.url, events: s.events, active: s.active }));
  }

  /**
   * Persist + enqueue an event for every active subscription that listens
   * for it. Idempotency: callers wishing to avoid double-fires should
   * include a stable `data.idempotencyKey` and the worker dedupes on it.
   *
   * Errors are logged and swallowed — webhook delivery must never block
   * the caller's hot path (verify, BATE recompute, etc.).
   */
  async enqueue(event: WebhookEvent, principalId: string): Promise<void> {
    // Belt-and-suspenders: assert the payload matches the per-event schema
    // before persistence. The cross-package parity test
    // (tests/cross-package/webhook-payload-parity.spec.ts) is the CI gate
    // that catches drift before it ships; this runtime check is a safety
    // net that prefers "send nothing" over "send wrong shape" if drift
    // somehow makes it past CI.
    //
    // We do NOT throw — the existing invariant is that enqueue never blocks
    // the caller's hot path. Drift surfaces as an ERROR log + early return
    // (no delivery row, no queue entry); the parity test remains the
    // load-bearing guard.
    try {
      validateWebhookPayload(event.type, event.data);
    } catch (err) {
      if (err instanceof WebhookPayloadValidationError) {
        // `err.kind` is the single source of truth for drift classification;
        // see `WebhookPayloadValidationKind` in @aegis/types. Mirrored on
        // the `reason` label of `aegis_webhook_payload_drift_total`.
        this.metrics.webhookPayloadDriftTotal.inc({
          event: event.type,
          reason: err.kind,
        });
        this.logger.error(
          `webhook.enqueue payload drift event=${event.type} reason=${err.kind}: ${err.message}`,
        );
        return;
      }
      throw err;
    }

    try {
      const subs = await this.prisma.webhookSubscription.findMany({
        where: { principalId, active: true, events: { has: event.type } },
      });
      if (subs.length === 0) return;

      const created = await this.prisma.$transaction(
        subs.map((s) =>
          this.prisma.webhookDelivery.create({
            data: {
              subscriptionId: s.id,
              event: event.type,
              payload: event.data as Prisma.InputJsonValue,
            },
          }),
        ),
      );
      await Promise.all(created.map((d) => this.delivery.enqueue(d.id)));
    } catch (err) {
      this.logger.error(`webhook.enqueue failed event=${event.type}: ${(err as Error).message}`);
    }
  }
}
