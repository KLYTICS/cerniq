import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryWorker } from './webhook.delivery';

@Module({
  providers: [WebhooksService, WebhookDeliveryWorker],
  exports: [WebhooksService, WebhookDeliveryWorker],
})
export class WebhooksModule {}
