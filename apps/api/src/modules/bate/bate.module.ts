import { Module } from '@nestjs/common';
import { BateService } from './bate.service';
import { BateScorer } from './bate.scorer';
import { BateController } from './bate.controller';
import { BateRecomputeWorker } from './bate.worker';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule],
  controllers: [BateController],
  providers: [BateService, BateScorer, BateRecomputeWorker],
  exports: [BateService, BateScorer],
})
export class BateModule {}
