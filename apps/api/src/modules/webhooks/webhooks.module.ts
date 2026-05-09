import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryWorker } from './webhook.delivery';
import { WebhooksController } from './webhooks.controller';
import { WebhookSecretCipher } from '../../common/crypto/webhook-secret-cipher';

// G-4: WebhooksController added — exposes POST/GET/DELETE /v1/webhooks.
// Webhook secret envelope encryption (AES-256-GCM) wraps `WebhookSubscription.secret`
// at rest; `WebhookSecretCipher` is a leaf utility (no DI deps beyond AppConfigService)
// scoped to this module — it is NOT exported because no other module needs it.
//
// Note: ShutdownService and MetricsService are provided globally by
// `ObservabilityModule` (`@Global()`) — `WebhookDeliveryWorker` injects
// them directly via the global container and we do NOT need to import the
// observability module here.
@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDeliveryWorker, WebhookSecretCipher],
  exports: [WebhooksService, WebhookDeliveryWorker],
})
export class WebhooksModule {}
