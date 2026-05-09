// BillingController — checkout sessions, webhook intake, plan summary.
//
// Webhook signature verification depends on the Stripe-Signature header
// being computed against the EXACT bytes Stripe sent. Express's JSON
// body-parser canonicalizes whitespace and breaks the signature, so
// `apps/api/src/main.ts` enables `rawBody: true` on `NestFactory.create`
// and we read the raw buffer here via `@RawBody()`.
//
// Public surface:
//   POST /v1/billing/checkout   — auth required (FULL key)
//   POST /v1/billing/webhook    — public, signed by Stripe
//   GET  /v1/billing/plan       — auth required, returns plan + usage
//
// CLAUDE.md invariants:
//   #4 — webhook handler errors throw → 500 → Stripe retries; the SETNX
//        idempotency key in StripeService is rolled back on throw so the
//        retry actually re-fires the dispatch.
//   #5 — every authenticated method takes `auth.principalId` as the
//        identity key. Webhook is special: principalId is recovered from
//        Stripe metadata, never accepted from the request body.

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBody,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUrl, MaxLength } from 'class-validator';
import type { PlanTier } from '@prisma/client';

import { Auth } from '../../common/decorators/auth.decorator';
import { Public } from '../auth/api-key.guard';
import type { AuthenticatedKey } from '../auth/api-key.service';
import {
  ServiceUnavailableError,
  ValidationError,
} from '../../common/errors/aegis-error';
import { AppConfigService } from '../../config/config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getPlan } from './plans';
import { StripeService } from './stripe.service';
import { TrialService } from './trial.service';
import { UsageGuardService } from './usage-guard.service';

// ── DTOs ─────────────────────────────────────────────────────────────────

const PAID_TIERS = ['DEVELOPER', 'GROWTH'] as const;
type PaidTier = (typeof PAID_TIERS)[number];

export class CreateCheckoutDto {
  @ApiProperty({
    description:
      'Plan tier to subscribe to. ENTERPRISE is sales-led and not self-serve via this endpoint.',
    enum: PAID_TIERS,
    example: 'DEVELOPER',
  })
  @IsEnum(PAID_TIERS)
  planTier!: PaidTier;

  @ApiPropertyOptional({
    description:
      'Override the configured success URL. Useful for staging/preview environments. ' +
      'Defaults to STRIPE_CHECKOUT_SUCCESS_URL.',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  successUrl?: string;

  @ApiPropertyOptional({
    description:
      'Override the configured cancel URL. Defaults to STRIPE_CHECKOUT_CANCEL_URL.',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  cancelUrl?: string;
}

export class CheckoutSessionDto {
  @ApiProperty({ description: 'Stripe-hosted Checkout URL. Redirect the user to this.' })
  url!: string;
}

export class CreatePortalSessionDto {
  @ApiProperty({
    description:
      'Where Stripe should redirect after the customer closes the billing portal. ' +
      'Provided by the dashboard so the customer lands on a tier-specific success page.',
  })
  // require_tld:false → allow http://localhost:* in dev.
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  returnUrl!: string;
}

export class PortalSessionDto {
  @ApiProperty({ description: 'Stripe-hosted Customer Portal URL. Redirect the user to this.' })
  url!: string;
}

export class PlanSummaryDto {
  @ApiProperty({ enum: ['FREE', 'DEVELOPER', 'GROWTH', 'ENTERPRISE'] })
  planTier!: PlanTier;

  @ApiProperty({
    description: 'Monthly verify-call quota. -1 means unlimited (ENTERPRISE).',
  })
  monthlyQuota!: number;

  @ApiProperty({
    description: 'Verify calls remaining in the current calendar month.',
  })
  remaining!: number;

  @ApiProperty({
    description: 'Verify calls already consumed in the current calendar month.',
  })
  monthVerifyCount!: number;

  @ApiProperty({
    description: 'Whether the plan is hard-stop on quota exhaustion (FREE) or metered (paid).',
  })
  hardStop!: boolean;

  @ApiPropertyOptional({
    description:
      'Mirror of Stripe Subscription.status (e.g. ACTIVE, PAST_DUE, CANCELED). Null until first checkout.',
  })
  subscriptionStatus!: string | null;

  @ApiPropertyOptional({ description: 'Stripe customer id (cus_*) when one exists.' })
  stripeCustomerId!: string | null;

  @ApiPropertyOptional({
    description: 'Stripe subscription id (sub_*) when an active subscription exists.',
  })
  stripeSubscriptionId!: string | null;

  // ── Trial counter (FREE-tier only; null on paid tiers) ──────────────────
  // Round 21: surface the lifetime trial counter so the dashboard can show
  // exact numbers ("8,432 / 10,000") instead of the Round-20 (approx.) proxy
  // via monthVerifyCount. ADR-0014 enforces lifetime cap, not monthly.

  @ApiPropertyOptional({
    description:
      'Lifetime verifies consumed by this principal (FREE tier only). Null for paid tiers and Enterprise.',
  })
  trialUsedCount!: number | null;

  @ApiPropertyOptional({
    description:
      'Trial cap (10,000 per ADR-0014) — null for paid tiers and Enterprise.',
  })
  trialCap!: number | null;

  @ApiPropertyOptional({
    description:
      'ISO timestamp at which the lifetime cap was first hit. Null while still inside the cap.',
  })
  trialExhaustedAt!: string | null;
}

export class WebhookAckDto {
  @ApiProperty({ description: 'Always true. Stripe only inspects the HTTP status code.' })
  received!: boolean;
}

// ── Controller ───────────────────────────────────────────────────────────

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly usage: UsageGuardService,
    private readonly trial: TrialService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * POST /v1/billing/checkout
   *
   * Returns a Stripe-hosted Checkout URL. The caller redirects the
   * browser there. Cancel and success URLs default to the configured
   * env values; the request body may override for staging.
   */
  @Post('checkout')
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({
    summary: 'Create a Stripe Checkout session for a paid plan tier.',
    description:
      'Creates (or reuses) the Stripe customer for the calling principal, then opens a ' +
      'subscription Checkout session. Returns the redirect URL. ENTERPRISE is sales-led ' +
      'and rejected here; FREE has no purchase flow.',
  })
  async checkout(
    @Auth() auth: AuthenticatedKey,
    @Body() dto: CreateCheckoutDto,
  ): Promise<CheckoutSessionDto> {
    const successUrl = dto.successUrl ?? this.config.stripeCheckoutSuccessUrl;
    const cancelUrl = dto.cancelUrl ?? this.config.stripeCheckoutCancelUrl;
    if (!successUrl || !cancelUrl) {
      throw new ServiceUnavailableError(
        'Checkout URLs not configured. Set STRIPE_CHECKOUT_SUCCESS_URL and ' +
          'STRIPE_CHECKOUT_CANCEL_URL or pass them in the request body.',
      );
    }
    return this.stripe.createCheckoutSession({
      principalId: auth.principalId,
      planTier: dto.planTier,
      successUrl,
      cancelUrl,
    });
  }

  /**
   * POST /v1/billing/portal
   *
   * Returns a Stripe-hosted Customer Portal URL — the customer can update
   * payment method, cancel, or download invoices there. Requires a prior
   * successful checkout (the principal must have a `stripeCustomerId`).
   */
  @Post('portal')
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({
    summary: 'Create a Stripe Customer Portal session URL.',
    description:
      'Returns a one-time URL into the Stripe-hosted billing portal where the customer ' +
      'can update card, cancel subscription, or view invoices. The principal must already ' +
      'have a Stripe customer (i.e. has run /billing/checkout at least once).',
  })
  async portal(
    @Auth() auth: AuthenticatedKey,
    @Body() dto: CreatePortalSessionDto,
  ): Promise<PortalSessionDto> {
    return this.stripe.createPortalSession(auth.principalId, dto.returnUrl);
  }

  /**
   * POST /v1/billing/webhook
   *
   * Public route — authenticated by the Stripe-Signature HMAC against
   * STRIPE_WEBHOOK_SECRET. Reads the raw body (untouched bytes) so the
   * signature canonicalization matches Stripe's. On dispatch failure,
   * StripeService rolls back its idempotency SETNX so the next retry
   * actually re-runs the handler — silent loss is impossible.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stripe webhook intake (signed; no API key).',
    description:
      'Verifies the Stripe-Signature header, dispatches the event idempotently, and ' +
      'returns 200. On signature failure returns 400; on dispatch failure returns 500 ' +
      'so Stripe retries.',
  })
  async webhook(
    @Headers('stripe-signature') signature: string | undefined,
    @RawBody() rawBody: Buffer | undefined,
  ): Promise<WebhookAckDto> {
    if (!signature) {
      throw new ValidationError('Missing Stripe-Signature header.');
    }
    if (!rawBody || rawBody.length === 0) {
      throw new ValidationError('Empty webhook body.');
    }
    const event = this.stripe.verifyWebhookSignature(rawBody, signature);
    const result = await this.stripe.handleWebhookEvent(event);
    this.logger.log(
      `stripe.webhook event=${event.type} id=${event.id} handled=${result.handled}` +
        (result.principalId ? ` principal=${result.principalId}` : '') +
        (result.planTier ? ` planTier=${result.planTier}` : ''),
    );
    return { received: true };
  }

  /**
   * GET /v1/billing/plan
   *
   * Plan tier + monthly usage snapshot. Reads from Postgres + the
   * Redis-backed verify counter via UsageGuardService — no Stripe round-trip.
   */
  @Get('plan')
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({
    summary: 'Current plan tier, usage, and Stripe linkage for the calling principal.',
  })
  async plan(@Auth() auth: AuthenticatedKey): Promise<PlanSummaryDto> {
    const principal = await this.prisma.principal.findUnique({
      where: { id: auth.principalId },
      select: {
        planTier: true,
        subscriptionStatus: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });
    if (!principal) {
      // Should be impossible — the API key resolved to this principalId.
      throw new ServiceUnavailableError('Principal record missing for authenticated key.');
    }
    const quota = await this.usage.checkQuota(auth.principalId);
    const plan = getPlan(principal.planTier);
    const monthlyQuota =
      plan.monthlyVerifyQuota === Number.POSITIVE_INFINITY ? -1 : plan.monthlyVerifyQuota;
    const monthVerifyCount =
      monthlyQuota === -1 || quota.remaining < 0
        ? -1
        : Math.max(0, monthlyQuota - quota.remaining);

    // Round 21: surface the lifetime trial counter for the dashboard so it
    // can render exact numbers without the "(approx.)" disclaimer.
    // TrialService.getStatus returns null on principal-not-found (Round 19
    // F-04 fix); maps to all-null trial fields here.
    const trial = await this.trial.getStatus(auth.principalId);
    const trialFields =
      trial === null || trial.cap === -1
        ? { trialUsedCount: null, trialCap: null, trialExhaustedAt: null }
        : {
            trialUsedCount: trial.used,
            trialCap: trial.cap,
            trialExhaustedAt: trial.exhaustedAt ? trial.exhaustedAt.toISOString() : null,
          };

    return {
      planTier: principal.planTier,
      monthlyQuota,
      remaining: quota.remaining,
      monthVerifyCount,
      hardStop: plan.overagePerCallE4 === null,
      subscriptionStatus: principal.subscriptionStatus,
      stripeCustomerId: principal.stripeCustomerId,
      stripeSubscriptionId: principal.stripeSubscriptionId,
      ...trialFields,
    };
  }
}
