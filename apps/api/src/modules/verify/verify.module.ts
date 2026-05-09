import { Module } from '@nestjs/common';
import { VerifyController } from './verify.controller';
import { VerifyService } from './verify.service';
import { SpendGuardService } from './spend-guard.service';
import { ReplayCacheService } from './replay-cache.service';
import { BateModule } from '../bate/bate.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { PlanAwareThrottlerGuard } from '../../common/throttle/plan-aware-throttler.guard';

// G-2: BillingModule imported so VerifyService can inject UsageGuardService
// and enforce plan-tier monthly verify quotas before the algorithm runs.
//
// OD-006: PlanAwareThrottlerGuard is registered as a controller-scoped
// provider (NOT APP_GUARD) so other endpoints continue to use the global
// flat ThrottlerGuard from app.module.ts. The guard is wired via
// `@UseGuards(PlanAwareThrottlerGuard)` on VerifyController.
@Module({
  imports: [BateModule, AuditModule, BillingModule],
  controllers: [VerifyController],
  providers: [VerifyService, SpendGuardService, ReplayCacheService, PlanAwareThrottlerGuard],
  exports: [VerifyService],
})
export class VerifyModule {}
