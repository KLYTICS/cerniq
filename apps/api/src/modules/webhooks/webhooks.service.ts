import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { WebhookSecretCipher } from '../../common/crypto/webhook-secret-cipher';
import { PrismaService } from '../../common/prisma/prisma.service';

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

  async list(principalId: string): Promise<{ id: string; url: string; events: string[]; active: boolean }[]> {
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
    // apps/api/CLAUDE.md hard rule: "Do not swallow errors in security,
    // billing, policy, webhooks, KMS, or audit paths." The previous
    // single-try-catch collapsed three failure modes — "no subscribers
    // configured" (legitimate empty), "Postgres write failed" (real
    // signal loss; revocations/SOC2 evidence subscribers never hear),
    // and "BullMQ queue.add failed" (durable row exists, delivery
    // just timing-delayed) — into one logged-but-swallowed branch.
    //
    // After this fix the three modes are distinct:
    //   - subs.length === 0 → silent return (legitimate)
    //   - subscription lookup OR delivery-row persist failure → THROW
    //     (the caller — typically a revoke handler — must learn that
    //     subscribers will never be notified; tx rollback or operator
    //     alert is its responsibility)
    //   - per-delivery BullMQ queue.add failure → warn + metric, do
    //     NOT throw (the webhookDelivery row is durable; the
    //     reconcile worker will retry)

    let subs;
    try {
      subs = await this.prisma.webhookSubscription.findMany({
        where: { principalId, active: true, events: { has: event.type } },
      });
    } catch (err) {
      this.logger.error(
        `webhook.enqueue subscription lookup failed event=${event.type} principal=${principalId}: ${(err as Error).message}`,
      );
      throw err;
    }
    if (subs.length === 0) return;

    let created;
    try {
      created = await this.prisma.$transaction(
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
    } catch (err) {
      this.logger.error(
        `webhook.enqueue delivery persist failed event=${event.type} principal=${principalId} subscribers=${subs.length}: ${(err as Error).message} — subscribers will NOT be notified`,
      );
      throw err;
    }

    // Per-delivery BullMQ enqueue is best-effort: the durable record
    // is the webhookDelivery row above. If queue.add fails (Redis
    // blip), the reconcile worker picks the row up on its next sweep.
    // We surface each failure via warn-log so the operator can see
    // delivery-latency anomalies, but we don't throw — that would
    // misleadingly fail the caller after the durable write succeeded.
    await Promise.all(
      created.map((d) =>
        this.delivery.enqueue(d.id).catch((err: unknown) => {
          this.logger.warn(
            `webhook.enqueue queue.add failed deliveryId=${d.id} event=${event.type}: ${(err as Error).message} — row persisted, will be picked up by reconcile sweep`,
          );
        }),
      ),
    );
  }
}
