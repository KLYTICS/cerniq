/**
 * OnboardingController — unit tests
 *
 * Coverage:
 *   status()          — delegates req.principalId to onboarding.getStatus
 *   markStep()        — delegates principalId + step to onboarding.markStep
 *   triggerBackfill() — admin-only gate (X-CERNIQ-Admin header), delegates to backfill.run
 *   lastReport()      — admin-only gate, delegates to backfill.getLastReport
 */

import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

import type { OnboardingBackfill } from './onboarding.backfill';
import { OnboardingController } from './onboarding.controller';
import type { OnboardingService } from './onboarding.service';

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeOnboarding(): jest.Mocked<Pick<OnboardingService, 'getStatus' | 'markStep'>> {
  return {
    getStatus: jest.fn().mockResolvedValue({ completed: [], pending: [] }),
    markStep: jest.fn().mockResolvedValue(undefined),
  };
}

function makeBackfill(): jest.Mocked<Pick<OnboardingBackfill, 'run' | 'getLastReport'>> {
  return {
    run: jest.fn().mockResolvedValue({ ranAt: new Date().toISOString(), processed: 5, updated: 2 }),
    getLastReport: jest
      .fn()
      .mockReturnValue({ ranAt: new Date().toISOString(), processed: 3, updated: 1 }),
  };
}

function makeReq(opts: { principalId?: string; adminHeader?: string } = {}): Request {
  return {
    principalId: opts.principalId,
    headers: opts.adminHeader !== undefined ? { 'x-cerniq-admin': opts.adminHeader } : {},
  } as unknown as Request;
}

function makeController() {
  const onboarding = makeOnboarding();
  const backfill = makeBackfill();
  const controller = new OnboardingController(
    onboarding as unknown as OnboardingService,
    backfill as unknown as OnboardingBackfill,
  );
  return { controller, onboarding, backfill };
}

const ADMIN_TOKEN = 'super_secret_admin';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OnboardingController', () => {
  // Save and restore process.env.CERNIQ_ADMIN_TOKEN
  const originalToken = process.env.CERNIQ_ADMIN_TOKEN;
  beforeAll(() => {
    process.env.CERNIQ_ADMIN_TOKEN = ADMIN_TOKEN;
  });
  afterAll(() => {
    if (originalToken === undefined) delete process.env.CERNIQ_ADMIN_TOKEN;
    else process.env.CERNIQ_ADMIN_TOKEN = originalToken;
  });

  describe('status()', () => {
    it('delegates to onboarding.getStatus with req.principalId', async () => {
      const { controller, onboarding } = makeController();
      await controller.status(makeReq({ principalId: 'prn_A' }));
      expect(onboarding.getStatus).toHaveBeenCalledWith('prn_A');
    });

    it('throws when req.principalId is missing', async () => {
      const { controller } = makeController();
      await expect(controller.status(makeReq({}))).rejects.toThrow('principal_missing');
    });

    it('returns the service result', async () => {
      const { controller } = makeController();
      const result = await controller.status(makeReq({ principalId: 'prn_A' }));
      expect(result).toBeDefined();
    });
  });

  describe('markStep()', () => {
    it('delegates to onboarding.markStep with principalId and step', async () => {
      const { controller, onboarding } = makeController();
      await controller.markStep(makeReq({ principalId: 'prn_A' }), {
        step: 'CREATE_AGENT',
      } as never);
      expect(onboarding.markStep).toHaveBeenCalledWith('prn_A', 'CREATE_AGENT');
    });

    it('throws when req.principalId is missing', async () => {
      const { controller } = makeController();
      await expect(
        controller.markStep(makeReq({}), { step: 'CREATE_AGENT' } as never),
      ).rejects.toThrow('principal_missing');
    });
  });

  describe('triggerBackfill() — admin-only', () => {
    it('runs backfill when admin token matches', async () => {
      const { controller, backfill } = makeController();
      await controller.triggerBackfill(makeReq({ adminHeader: ADMIN_TOKEN }));
      expect(backfill.run).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException when admin header is wrong', async () => {
      const { controller } = makeController();
      await expect(
        controller.triggerBackfill(makeReq({ adminHeader: 'wrong_token' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when admin header is missing', async () => {
      const { controller } = makeController();
      await expect(controller.triggerBackfill(makeReq({}))).rejects.toThrow(ForbiddenException);
    });

    it('returns the backfill report', async () => {
      const { controller } = makeController();
      const result = await controller.triggerBackfill(makeReq({ adminHeader: ADMIN_TOKEN }));
      expect(result).toHaveProperty('ranAt');
    });
  });

  describe('lastReport() — admin-only', () => {
    it('returns the last backfill report for valid admin header', () => {
      const { controller, backfill } = makeController();
      const result = controller.lastReport(makeReq({ adminHeader: ADMIN_TOKEN }));
      expect(backfill.getLastReport).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('returns { ranAt: null } when no report exists', () => {
      const { controller, backfill } = makeController();
      (backfill.getLastReport as jest.Mock).mockReturnValue(null);
      const result = controller.lastReport(makeReq({ adminHeader: ADMIN_TOKEN }));
      expect(result).toEqual({ ranAt: null });
    });

    it('throws ForbiddenException when admin header is wrong', () => {
      const { controller } = makeController();
      expect(() => controller.lastReport(makeReq({ adminHeader: 'bad' }))).toThrow(
        ForbiddenException,
      );
    });
  });
});
