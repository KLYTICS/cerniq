import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingBackfill } from './onboarding.backfill';

/**
 * Onboarding module (OD-012). Exports `OnboardingService` for direct
 * `markStep` calls and `OnboardingBackfill` for periodic reconciliation.
 *
 * Two complementary patterns ship today:
 *  1. **Direct `markStep` hooks** — service-internal code paths can call
 *     `OnboardingService.markStep(principalId, '<step>')` for instant
 *     onboarding rollup. Sub-millisecond. Wired by the consuming module.
 *  2. **Periodic backfill** — `OnboardingBackfill.run()` is a single-pass
 *     SQL reconciler that catches dropped events. Idempotent; safe to
 *     trigger from a scheduler, admin endpoint, or `aegis-cli onboarding
 *     backfill`.
 *
 * Operators run BOTH: hooks give live feedback for the dashboard wizard;
 * backfill gives self-healing for the activation funnel telemetry.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingBackfill],
  exports: [OnboardingService, OnboardingBackfill],
})
export class OnboardingModule {}
