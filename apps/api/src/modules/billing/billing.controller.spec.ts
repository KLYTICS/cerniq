import { Reflector } from '@nestjs/core';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { ServiceUnavailableError, ValidationError } from '../../common/errors/cerniq-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';

import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';
import { TrialService } from './trial.service';
import { UsageGuardService } from './usage-guard.service';

const PRINCIPAL_ID = 'prn_test_001';

describe('BillingController', () => {
  let controller: BillingController;
  let stripe: jest.Mocked<
    Pick<
      StripeService,
      | 'createCheckoutSession'
      | 'createPortalSession'
      | 'verifyWebhookSignature'
      | 'handleWebhookEvent'
    >
  >;
  let usage: jest.Mocked<Pick<UsageGuardService, 'checkQuota'>>;
  let trial: { getStatus: jest.Mock };
  let prisma: { principal: { findUnique: jest.Mock } };
  let config: jest.Mocked<
    Pick<AppConfigService, 'stripeCheckoutSuccessUrl' | 'stripeCheckoutCancelUrl'>
  >;

  beforeEach(async () => {
    stripe = {
      createCheckoutSession: jest.fn(),
      createPortalSession: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      handleWebhookEvent: jest.fn(),
    };
    usage = { checkQuota: jest.fn() };
    // Round 21: BillingController now injects TrialService for the
    // /v1/billing/plan endpoint to surface the lifetime trial counter.
    // Default getStatus to null (principal-not-found / non-FREE returns
    // null per Round 19 F-04 fix) — individual tests override.
    trial = { getStatus: jest.fn().mockResolvedValue(null) };
    prisma = { principal: { findUnique: jest.fn() } };
    config = {} as never;
    Object.defineProperty(config, 'stripeCheckoutSuccessUrl', {
      get: jest.fn(() => 'https://app.cerniqapp.com/billing/success'),
      configurable: true,
    });
    Object.defineProperty(config, 'stripeCheckoutCancelUrl', {
      get: jest.fn(() => 'https://app.cerniqapp.com/billing/cancel'),
      configurable: true,
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: StripeService, useValue: stripe },
        { provide: UsageGuardService, useValue: usage },
        { provide: TrialService, useValue: trial },
        { provide: PrismaService, useValue: prisma },
        { provide: AppConfigService, useValue: config },
        Reflector,
      ],
    }).compile();
    controller = module.get(BillingController);
  });

  describe('POST /billing/checkout', () => {
    it('forwards to StripeService with default URLs', async () => {
      stripe.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/abc' });
      const result = await controller.checkout(
        { principalId: PRINCIPAL_ID, scope: 'FULL' as never } as never,
        { planTier: 'DEVELOPER' },
      );
      expect(result).toEqual({ url: 'https://checkout.stripe.com/c/abc' });
      expect(stripe.createCheckoutSession).toHaveBeenCalledWith({
        principalId: PRINCIPAL_ID,
        planTier: 'DEVELOPER',
        successUrl: 'https://app.cerniqapp.com/billing/success',
        cancelUrl: 'https://app.cerniqapp.com/billing/cancel',
      });
    });

    it('honors body-supplied successUrl/cancelUrl overrides', async () => {
      stripe.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/xyz' });
      await controller.checkout({ principalId: PRINCIPAL_ID, scope: 'FULL' as never } as never, {
        planTier: 'GROWTH',
        successUrl: 'https://staging.example.com/ok',
        cancelUrl: 'https://staging.example.com/no',
      });
      expect(stripe.createCheckoutSession).toHaveBeenCalledWith({
        principalId: PRINCIPAL_ID,
        planTier: 'GROWTH',
        successUrl: 'https://staging.example.com/ok',
        cancelUrl: 'https://staging.example.com/no',
      });
    });

    it('refuses when neither config nor body supply URLs', async () => {
      Object.defineProperty(config, 'stripeCheckoutSuccessUrl', {
        get: () => undefined,
        configurable: true,
      });
      Object.defineProperty(config, 'stripeCheckoutCancelUrl', {
        get: () => undefined,
        configurable: true,
      });
      await expect(
        controller.checkout({ principalId: PRINCIPAL_ID, scope: 'FULL' as never } as never, {
          planTier: 'DEVELOPER',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });
  });

  describe('POST /billing/portal', () => {
    it('forwards principalId + returnUrl to StripeService', async () => {
      stripe.createPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/p/session/abc',
      });
      const out = await controller.portal(
        { principalId: PRINCIPAL_ID, scope: 'FULL' as never } as never,
        { returnUrl: 'https://app.cerniqapp.com/billing/back' },
      );
      expect(out).toEqual({ url: 'https://billing.stripe.com/p/session/abc' });
      expect(stripe.createPortalSession).toHaveBeenCalledWith(
        PRINCIPAL_ID,
        'https://app.cerniqapp.com/billing/back',
      );
    });
  });

  describe('POST /billing/webhook', () => {
    it('rejects missing Stripe-Signature header', async () => {
      await expect(controller.webhook(undefined, Buffer.from('{}'))).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(stripe.verifyWebhookSignature).not.toHaveBeenCalled();
    });

    it('rejects empty body', async () => {
      await expect(controller.webhook('t=1,v1=abc', Buffer.alloc(0))).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(stripe.verifyWebhookSignature).not.toHaveBeenCalled();
    });

    it('verifies signature and dispatches event on the happy path', async () => {
      const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } };
      stripe.verifyWebhookSignature.mockReturnValue(event);
      stripe.handleWebhookEvent.mockResolvedValue({
        handled: true,
        principalId: PRINCIPAL_ID,
        planTier: 'DEVELOPER',
      });
      const buf = Buffer.from(JSON.stringify(event));
      const result = await controller.webhook('t=1,v1=abcd', buf);
      expect(result).toEqual({ received: true });
      expect(stripe.verifyWebhookSignature).toHaveBeenCalledWith(buf, 't=1,v1=abcd');
      expect(stripe.handleWebhookEvent).toHaveBeenCalledWith(event);
    });

    it('lets ValidationError from bad signatures propagate (Stripe retries are idempotent)', async () => {
      stripe.verifyWebhookSignature.mockImplementation(() => {
        throw new ValidationError('Invalid Stripe webhook signature.');
      });
      await expect(
        controller.webhook('t=1,v1=bogus', Buffer.from('{"x":1}')),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(stripe.handleWebhookEvent).not.toHaveBeenCalled();
    });
  });

  describe('GET /billing/plan', () => {
    it('returns tier + usage snapshot', async () => {
      prisma.principal.findUnique.mockResolvedValue({
        planTier: 'DEVELOPER',
        subscriptionStatus: 'ACTIVE',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
      });
      usage.checkQuota.mockResolvedValue({
        allowed: true,
        remaining: 49_700,
        planTier: 'DEVELOPER',
        monthlyQuota: 50_000,
      });
      const result = await controller.plan({
        principalId: PRINCIPAL_ID,
        scope: 'FULL' as never,
      } as never);
      expect(result.planTier).toBe('DEVELOPER');
      expect(result.monthlyQuota).toBe(50_000);
      expect(result.remaining).toBe(49_700);
      expect(result.monthVerifyCount).toBe(300);
      expect(result.hardStop).toBe(false);
      expect(result.subscriptionStatus).toBe('ACTIVE');
      expect(result.stripeCustomerId).toBe('cus_123');
      expect(result.stripeSubscriptionId).toBe('sub_456');
    });

    it('marks FREE as hard-stop and surfaces nullable Stripe linkage', async () => {
      prisma.principal.findUnique.mockResolvedValue({
        planTier: 'FREE',
        subscriptionStatus: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      });
      usage.checkQuota.mockResolvedValue({
        allowed: true,
        remaining: 1_000,
        planTier: 'FREE',
        monthlyQuota: 1_000,
      });
      const result = await controller.plan({
        principalId: PRINCIPAL_ID,
        scope: 'FULL' as never,
      } as never);
      expect(result.planTier).toBe('FREE');
      expect(result.hardStop).toBe(true);
      expect(result.stripeCustomerId).toBeNull();
    });

    it('surfaces -1 quota for ENTERPRISE (unlimited)', async () => {
      prisma.principal.findUnique.mockResolvedValue({
        planTier: 'ENTERPRISE',
        subscriptionStatus: 'ACTIVE',
        stripeCustomerId: 'cus_ent',
        stripeSubscriptionId: 'sub_ent',
      });
      usage.checkQuota.mockResolvedValue({
        allowed: true,
        remaining: -1,
        planTier: 'ENTERPRISE',
        monthlyQuota: -1,
      });
      const result = await controller.plan({
        principalId: PRINCIPAL_ID,
        scope: 'FULL' as never,
      } as never);
      expect(result.monthlyQuota).toBe(-1);
      expect(result.monthVerifyCount).toBe(-1);
      expect(result.remaining).toBe(-1);
    });
  });
});
