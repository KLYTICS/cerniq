import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';

import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';

/**
 * HealthModule wires the operator-facing /health/{live,ready,version} +
 * /metrics surface.
 *
 * Imports rationale:
 *   - PrismaModule and RedisModule are `@Global()` and need no explicit
 *     import here.
 *   - AuditModule exports AuditSignerService — readiness probes the active
 *     kid to surface KMS reachability (CLAUDE.md invariant #3).
 *   - BillingModule exports StripeService — readiness reports stripe
 *     enabled/disabled without making outbound calls.
 */
@Module({
  imports: [AuditModule, BillingModule],
  controllers: [HealthController, MetricsController],
})
export class HealthModule {}
