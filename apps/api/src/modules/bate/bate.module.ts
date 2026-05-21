import { Module } from '@nestjs/common';

import { WebhooksModule } from '../webhooks/webhooks.module';

import { BateAnomalyDetector } from './bate.anomaly';
import { BateController } from './bate.controller';
import { BateScorer } from './bate.scorer';
import { BateService } from './bate.service';
import { BateRecomputeWorker } from './bate.worker';


// G-3: BateAnomalyDetector is now provided and injected into BateRecomputeWorker.
// It runs after every BATE recompute, emitting signals for rules R-1..R-5.
@Module({
  imports: [WebhooksModule],
  controllers: [BateController],
  providers: [BateService, BateScorer, BateRecomputeWorker, BateAnomalyDetector],
  exports: [BateService, BateScorer],
})
export class BateModule {}
