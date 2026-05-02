import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
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
  ) {}

  async subscribe(principalId: string, url: string, events: string[]): Promise<{ id: string; secret: string }> {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const sub = await this.prisma.webhookSubscription.create({
      data: { principalId, url, secret, events },
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
