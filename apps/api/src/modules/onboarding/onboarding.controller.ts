import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { OnboardingBackfill, type BackfillReport } from './onboarding.backfill';
import type { MarkOnboardingStepDto, OnboardingStatusDto } from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

/**
 * Onboarding HTTP surface (OD-012).
 *
 *   GET   /v1/me/onboarding              — fetch checklist for caller's principal
 *   PATCH /v1/me/onboarding/step         — mark one step complete (idempotent)
 *   POST  /v1/me/onboarding/admin/backfill      — admin-only manual trigger
 *   GET   /v1/me/onboarding/admin/backfill/last — admin-only last report
 *
 * Service-internal hooks (agent.create, policy.create, verify success,
 * kms.configure) write directly via OnboardingService.markStep — they
 * don't go through HTTP. The HTTP surface exists for the dashboard
 * wizard and the `cerniq doctor` CLI.
 */
@Controller('v1/me/onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly backfill: OnboardingBackfill,
  ) {}

  @Get()
  async status(@Req() req: Request): Promise<OnboardingStatusDto> {
    const principalId = (req as unknown as { principalId?: string }).principalId;
    if (!principalId) throw new Error('principal_missing');
    return await this.onboarding.getStatus(principalId);
  }

  @Patch('step')
  @HttpCode(204)
  async markStep(@Req() req: Request, @Body() dto: MarkOnboardingStepDto): Promise<void> {
    const principalId = (req as unknown as { principalId?: string }).principalId;
    if (!principalId) throw new Error('principal_missing');
    await this.onboarding.markStep(principalId, dto.step);
  }

  /**
   * Admin-only: trigger an immediate backfill pass and return the
   * report. Used by `cerniq-cli onboarding backfill` and by ops staff
   * rebuilding the activation funnel after an outage. Gated by
   * `X-CERNIQ-Admin` header == `CERNIQ_ADMIN_TOKEN` env.
   */
  @Post('admin/backfill')
  @HttpCode(200)
  async triggerBackfill(@Req() req: Request): Promise<BackfillReport> {
    this.assertAdmin(req);
    return await this.backfill.run();
  }

  /** Last completed backfill report — drives `cerniq doctor` heuristics. */
  @Get('admin/backfill/last')
  lastReport(@Req() req: Request): BackfillReport | { ranAt: null } {
    this.assertAdmin(req);
    return this.backfill.getLastReport() ?? { ranAt: null };
  }

  private assertAdmin(req: Request): void {
    const expected = process.env.CERNIQ_ADMIN_TOKEN;
    const provided = req.headers['x-cerniq-admin'];
    if (!expected || provided !== expected) {
      throw new ForbiddenException('admin_token_invalid');
    }
  }
}
