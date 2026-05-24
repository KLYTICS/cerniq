import { Module } from '@nestjs/common';

import { WebhooksModule } from '../webhooks/webhooks.module';

import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

// WebhooksModule is imported so IdentityService can fan a webhook on
// agent revocation (OD-024 Phase A5 — mirrors the existing
// policy.expiry.worker pattern that fans `cerniq.policy.expired`).
@Module({
  imports: [WebhooksModule],
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
