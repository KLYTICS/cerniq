import { Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/config.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';
import { TrialService } from './trial.service';
import { UsageGuardService } from './usage-guard.service';

/**
 * BillingModule — plan-tier enforcement, Stripe billing, webhook intake.
 *
 * Surface:
 *   - UsageGuardService: monthly verify-quota gate (FREE hard-stop at 1 K/month).
 *   - StripeService: checkout session creation + idempotent webhook event
 *     handler with SETNX-based dedupe.
 *   - BillingController: POST /v1/billing/checkout, POST /v1/billing/webhook
 *     (public), GET /v1/billing/plan.
 *
 * Both services are exported so VerifyModule (UsageGuardService) can inject
 * without circular deps.
 */
@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule, AuditModule],
  controllers: [BillingController],
  providers: [UsageGuardService, StripeService, TrialService],
  exports: [UsageGuardService, StripeService, TrialService],
})
export class BillingModule {}
