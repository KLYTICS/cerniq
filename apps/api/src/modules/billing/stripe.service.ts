// StripeService — checkout + webhook handler for CERNIQ billing (G-3).
//
// Design notes:
//
//   - Stripe SDK is lazy-`require`d (same pattern as `kms.module.ts`'s
//     cloud SDKs). This keeps unit-test bundles import-safe and lets the
//     service NO-OP cleanly when STRIPE_SECRET_KEY is absent.
//
//   - The webhook *controller* is owned by the parallel session (G-4).
//     This file ships only the pure service surface:
//       - signature verification
//       - event dispatch
//       - idempotency (Redis SETNX, 7-day TTL)
//       - plan-cache invalidation via UsageGuardService.
//
//   - When Stripe is disabled (no secret key), `isEnabled()` returns false
//     and `createCheckoutSession()` throws. `handleWebhookEvent()` is still
//     callable for tests, but in production the controller will refuse to
//     route events when the webhook secret is absent.
//
//   - Stripe is OPTIONAL even at runtime: principals can still have their
//     planTier set manually via admin tooling. See `docs/SESSION_HANDOFF.md`
//     and OD-003 for the operator's "Stripe-disabled but plans enforced"
//     mode.
//
// Operator decision OD-003 (pricing tiers) is OPEN. The defaults in
// `plans.ts` are correct enough to scaffold against; price ids come from
// env vars so the operator can flip live ids without a code change.

import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PlanTier } from '@prisma/client';

import {
  CerniqError,
  ServiceUnavailableError,
  ValidationError,
} from '../../common/errors/cerniq-error';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import {
  CIRCUIT_STATE_NUMERIC,
  CircuitBreaker,
  type BreakerMetricsSink,
} from '../../common/resilience/circuit-breaker';
import { AppConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';

import { getPlan, PLANS } from './plans';
import { UsageGuardService } from './usage-guard.service';

// We avoid `import Stripe from 'stripe'` at module-eval time because the
// dependency is optional in dev. The factory below resolves the SDK on
// first use; tests can inject a mock via the optional `stripeFactory` arg.
//
// type-rationale: The Stripe SDK ships its own types but we don't want a
// hard import-time dependency. We re-declare the minimum surface area we
// touch as `unknown`-tolerant interfaces, then narrow with runtime guards.
interface StripeSdk {
  // type-rationale: Stripe.Stripe constructor signature; we only need the
  // shape for the methods we call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customers: { create: (params: any) => Promise<{ id: string }> };
  checkout: {
    sessions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: (params: any) => Promise<{ id: string; url: string | null }>;
    };
  };
  billingPortal: {
    sessions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: (params: any) => Promise<{ id: string; url: string }>;
    };
  };
  subscriptions: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    retrieve: (id: string) => Promise<any>;
  };
  subscriptionItems: {
    createUsageRecord: (
      subscriptionItemId: string,

      params: { quantity: number; timestamp?: number; action?: 'increment' | 'set' },
    ) => Promise<{ id: string }>;
  };
  webhooks: {
    constructEvent: (payload: string | Buffer, sigHeader: string, secret: string) => StripeEvent;
  };
}

/** Minimal shape of a Stripe.Event we depend on. */
export interface StripeEvent {
  id: string;
  type: string;
  // type-rationale: Stripe.Event.data.object is a tagged union over all
  // resource types; we narrow per-handler instead of importing the entire
  // Stripe namespace. `unknown` forces the narrowing.
  data: { object: unknown };
}

/** Constructs a Stripe client. Default factory uses `require('stripe')`. */
export type StripeFactory = (secretKey: string) => StripeSdk;

const defaultStripeFactory: StripeFactory = (secretKey) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const StripeCtor = require('stripe') as new (
    key: string,
    opts?: { apiVersion?: string },
  ) => StripeSdk;
  return new StripeCtor(secretKey, { apiVersion: '2024-12-18.acacia' });
};

/** DI token — tests pass a mock factory through the module providers. */
export const STRIPE_FACTORY = Symbol('STRIPE_FACTORY');

export interface CreateCheckoutSessionInput {
  principalId: string;
  planTier: PlanTier;
  successUrl: string;
  cancelUrl: string;
}

export interface HandleWebhookResult {
  handled: boolean;
  principalId?: string;
  planTier?: PlanTier;
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripeFactory: StripeFactory;
  private stripeClient: StripeSdk | null = null;

  /** SETNX idempotency key for Stripe events. 7-day TTL. */
  private readonly EVENT_IDEMPOTENCY_PREFIX = 'cerniq:stripe:event';
  private readonly EVENT_IDEMPOTENCY_TTL_S = 7 * 86_400;

  /**
   * Single shared breaker around all outbound Stripe API calls. We do NOT
   * wrap `verifyWebhookSignature` because `constructEvent` is local-CPU
   * (HMAC over the payload) — it never touches the network and a "slow"
   * verify would be an indication of a CPU bug, not a Stripe outage. See
   * `verifyWebhookSignature` for the documented carve-out.
   */
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    // forwardRef pairs with the matching forwardRef in UsageGuardService.
    // The two services circularly inject each other (overage metering ↔
    // plan cache invalidation) — Nest requires BOTH sides to declare the
    // cycle for the resolution to succeed at boot.
    @Inject(forwardRef(() => UsageGuardService))
    private readonly usageGuard: UsageGuardService,
    private readonly audit: AuditService,
    @Optional() @Inject(STRIPE_FACTORY) stripeFactory?: StripeFactory,
    @Optional() metrics?: MetricsService,
  ) {
    this.stripeFactory = stripeFactory ?? defaultStripeFactory;
    const sink: BreakerMetricsSink | undefined = metrics
      ? {
          setState: (name, numeric) => {
            metrics.circuitBreakerStateGauge.set({ breaker: name }, numeric);
          },
          recordTrip: (name) => {
            metrics.circuitBreakerTripsTotal.inc({ breaker: name });
          },
        }
      : undefined;
    this.breaker = new CircuitBreaker<unknown>({
      name: 'stripe.api',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxCalls: 1,
      onStateChange: sink
        ? (from, to) => {
            sink.setState('stripe.api', CIRCUIT_STATE_NUMERIC[to]);
            if (to === 'OPEN' && from !== 'OPEN') sink.recordTrip('stripe.api');
          }
        : undefined,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────

  /** True iff a Stripe secret key is configured. */
  isEnabled(): boolean {
    return Boolean(this.config.stripeSecretKey);
  }

  /**
   * Create a Stripe Checkout Session for a paid tier.
   *
   * - Looks up `principal.stripeCustomerId`; creates a Stripe customer on
   *   first checkout and persists the id on the principal row.
   * - Maps `planTier` → priceId via `plans.ts`'s `stripeEnvSuffix` field.
   * - Throws on FREE / ENTERPRISE (FREE: no purchase needed; ENTERPRISE:
   *   custom invoiced — sales-led, not self-serve).
   */
  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ url: string }> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableError('Stripe billing is not configured.');
    }
    if (input.planTier === 'FREE' || input.planTier === 'ENTERPRISE') {
      throw new ValidationError(
        `Plan tier ${input.planTier} is not self-serve via Stripe checkout.`,
      );
    }

    const priceId = this.planTierToPriceId(input.planTier);
    if (!priceId) {
      throw new ServiceUnavailableError(`Stripe price id for ${input.planTier} is not configured.`);
    }

    const principal = await this.prisma.principal.findUnique({
      where: { id: input.principalId },
      select: { id: true, email: true, stripeCustomerId: true },
    });
    if (!principal) {
      throw new ValidationError(`Principal ${input.principalId} not found.`);
    }

    const stripe = this.client();

    // ── 1. Resolve / create Stripe customer ──────────────────────────
    let customerId = principal.stripeCustomerId;
    if (!customerId) {
      const customer = await this.breaker.exec(() =>
        stripe.customers.create({
          email: principal.email,
          metadata: { principalId: principal.id },
        }),
      );
      customerId = customer.id;
      await this.prisma.principal.update({
        where: { id: principal.id },
        data: { stripeCustomerId: customerId },
      });
    }

    // ── 2. Create the checkout session ───────────────────────────────
    const session = await this.breaker.exec(() =>
      stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: principal.id,
        metadata: { principalId: principal.id, planTier: input.planTier },
        subscription_data: {
          metadata: { principalId: principal.id, planTier: input.planTier },
        },
      }),
    );

    if (!session.url) {
      throw new ServiceUnavailableError('Stripe returned a checkout session without a URL.');
    }
    return { url: session.url };
  }

  /**
   * Verify an inbound webhook signature. Throws on bad signature.
   * The controller is responsible for capturing the raw body — we cannot
   * reconstruct the canonicalization downstream.
   *
   * Circuit-breaker carve-out: `constructEvent` is a local HMAC over the
   * raw body — it never touches the network. Wrapping it would only
   * surface CPU regressions, never Stripe-API health, so we deliberately
   * skip the breaker here. Outbound calls (`createCheckoutSession`,
   * `syncSubscriptionFromStripe`, the `subscriptions.retrieve` inside
   * webhook handlers) are wrapped instead.
   */
  verifyWebhookSignature(rawBody: string | Buffer, sigHeader: string): StripeEvent {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableError('Stripe billing is not configured.');
    }
    const secret = this.config.stripeWebhookSecret;
    if (!secret) {
      throw new ServiceUnavailableError('Stripe webhook secret is not configured.');
    }
    try {
      return this.client().webhooks.constructEvent(rawBody, sigHeader, secret);
    } catch (err) {
      throw new ValidationError('Invalid Stripe webhook signature.', {
        cause: err,
      });
    }
  }

  /**
   * Pure event handler — no HTTP. Idempotent on `event.id`.
   * Returns `{handled:false}` for unknown event types (no error) and for
   * duplicate events (already processed within the 7-day window).
   */
  async handleWebhookEvent(event: StripeEvent): Promise<HandleWebhookResult> {
    // Idempotency: SETNX with 7-day TTL.
    const idempKey = `${this.EVENT_IDEMPOTENCY_PREFIX}:${event.id}`;
    const isNew = await this.redis
      .raw()
      .set(idempKey, '1', 'EX', this.EVENT_IDEMPOTENCY_TTL_S, 'NX');
    if (isNew !== 'OK') {
      this.logger.debug(`Stripe event ${event.id} already processed; skipping.`);
      return { handled: false };
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          return await this.onCheckoutCompleted(event);
        case 'customer.subscription.updated':
        case 'customer.subscription.created':
          return await this.onSubscriptionUpdated(event);
        case 'customer.subscription.deleted':
          return await this.onSubscriptionDeleted(event);
        case 'invoice.payment_failed':
          return await this.onPaymentFailed(event);
        case 'invoice.payment_succeeded':
          return await this.onPaymentSucceeded(event);
        default:
          this.logger.debug(`Stripe event ${event.type} not handled.`);
          return { handled: false };
      }
    } catch (err) {
      // Roll back the idempotency key so the event can be retried — Stripe
      // will replay on non-2xx responses. Surface the error to the caller
      // (no silent swallow per CLAUDE.md invariant #4).
      await this.redis.del(idempKey);
      this.logger.error(
        `Stripe event ${event.id} (${event.type}) failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Sync a subscription's plan tier from Stripe. Useful as a recovery path
   * (e.g. operator-triggered after a webhook delivery outage).
   */
  async syncSubscriptionFromStripe(stripeSubId: string): Promise<void> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableError('Stripe billing is not configured.');
    }
    const stripe = this.client();
    const sub = await this.breaker.exec(() => stripe.subscriptions.retrieve(stripeSubId));
    const result = this.deriveSubscriptionState(sub);
    if (!result) {
      this.logger.warn(
        `Stripe subscription ${stripeSubId} could not be reconciled — no matching price id.`,
      );
      return;
    }

    const updated = await this.prisma.principal.updateMany({
      where: { stripeSubscriptionId: stripeSubId },
      data: { planTier: result.planTier },
    });
    if (updated.count === 0) {
      // Try metadata.principalId fallback — subscription may not be linked yet.
      const metaPrincipalId = this.readMetadataPrincipalId(sub);
      if (metaPrincipalId) {
        await this.prisma.principal.update({
          where: { id: metaPrincipalId },
          data: {
            stripeSubscriptionId: stripeSubId,
            planTier: result.planTier,
          },
        });
        await this.usageGuard.invalidatePlanCache(metaPrincipalId);
      } else {
        this.logger.warn(`Stripe subscription ${stripeSubId} not linked to any principal.`);
      }
      return;
    }

    // Find the principalId for cache invalidation.
    const principal = await this.prisma.principal.findFirst({
      where: { stripeSubscriptionId: stripeSubId },
      select: { id: true },
    });
    if (principal) {
      await this.usageGuard.invalidatePlanCache(principal.id);
    }
  }

  /**
   * Reverse-map a Stripe price id back to an internal `PlanTier`.
   * Returns `null` if no env var matches; caller logs a warning.
   */
  priceIdToPlanTier(priceId: string): PlanTier | null {
    if (!priceId) return null;
    const map: { tier: PlanTier; priceId: string | undefined }[] = [
      { tier: 'DEVELOPER', priceId: this.config.stripePriceDeveloper },
      { tier: 'GROWTH', priceId: this.config.stripePriceGrowth },
      { tier: 'ENTERPRISE', priceId: this.config.stripePriceEnterprise },
    ];
    for (const entry of map) {
      if (entry.priceId && entry.priceId === priceId) return entry.tier;
    }
    return null;
  }

  /**
   * Round 21 Lane B — emit one Stripe metered usage record for an
   * over-quota verify call. Fire-and-forget from the verify hot path.
   *
   * Behaviour matrix:
   *   - Stripe disabled OR count < 1            → silent no-op
   *   - principal not found                     → silent no-op
   *   - FREE tier                               → silent no-op (defence in
   *     depth; UsageGuard already short-circuits FREE per F-08)
   *   - paid tier WITHOUT stripeOverageItemId   → WARN log + no-op
   *     (under-billing > blocking verify)
   *   - paid tier WITH    stripeOverageItemId   → POST usage_records.create
   *
   * Stripe API errors are caught and logged at ERROR level (CLAUDE.md
   * invariant 4: no silent failure — but the verify request must succeed
   * regardless, so the error is surfaced via logs/metrics rather than
   * thrown). Stripe rate-limits `usage_records` to 100/hr per item; if
   * we exceed that, the operator backfills via `syncSubscriptionFromStripe`.
   */
  async recordOverage(principalId: string, count = 1): Promise<void> {
    if (!this.isEnabled() || count < 1) return;
    const principal = await this.prisma.principal.findUnique({
      where: { id: principalId },
      select: { stripeOverageItemId: true, planTier: true },
    });
    if (!principal) return;
    if (principal.planTier === 'FREE') return; // defence in depth (Invariant 2)
    if (!principal.stripeOverageItemId) {
      if (principal.planTier === 'DEVELOPER' || principal.planTier === 'GROWTH') {
        // Paid tier without a metered line — operator hasn't wired the
        // STRIPE_PRICE_OVERAGE_VERIFY price onto the subscription yet, or
        // the webhook hasn't backfilled it. Log so ops can reconcile.
        this.logger.warn(
          `recordOverage: paid principal ${principalId} (${principal.planTier}) has no stripeOverageItemId — overage will be under-billed.`,
        );
      }
      return;
    }
    const itemId = principal.stripeOverageItemId;
    try {
      await this.breaker.exec(() =>
        this.client().subscriptionItems.createUsageRecord(itemId, {
          quantity: count,
          timestamp: Math.floor(Date.now() / 1000),
          action: 'increment',
        }),
      );
    } catch (err) {
      // Under-billing is preferable to a verify-path failure. Surface the
      // error to logs/metrics so ops can replay missed records via
      // `syncSubscriptionFromStripe` or a manual usage_records.create.
      this.logger.error(
        `Stripe usage_records.create failed for principal=${principalId} item=${itemId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Walk a Stripe Subscription's `items.data` and return the
   * `subscription_item.id` whose `price.id` matches
   * `STRIPE_PRICE_OVERAGE_VERIFY`. Returns null when no such item is
   * present — not all paid subscriptions have the metered line.
   */
  private extractOverageItemId(sub: unknown): string | null {
    const overagePriceId = this.config.stripePriceOverageVerify;
    if (!overagePriceId) return null;
    if (typeof sub !== 'object' || sub === null) return null;
    // type-rationale: traversing untyped Stripe response shape; mirrors
    // `deriveSubscriptionState`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (sub as any).items?.data;
    if (!Array.isArray(items)) return null;
    for (const item of items) {
      const priceId = (item as { price?: { id?: string } }).price?.id;
      const itemId = (item as { id?: string }).id;
      if (typeof priceId === 'string' && priceId === overagePriceId && typeof itemId === 'string') {
        return itemId;
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────

  /** Lazy Stripe-SDK accessor. Throws if disabled. */
  private client(): StripeSdk {
    if (this.stripeClient) return this.stripeClient;
    const secret = this.config.stripeSecretKey;
    if (!secret) {
      throw new ServiceUnavailableError('Stripe billing is not configured.');
    }
    this.stripeClient = this.stripeFactory(secret);
    return this.stripeClient;
  }

  /** Map `PlanTier` → env-driven Stripe price id (`null` if not configured). */
  private planTierToPriceId(tier: PlanTier): string | null {
    const def = getPlan(tier);
    if (!def.stripeEnvSuffix) return null;
    switch (def.stripeEnvSuffix) {
      case 'DEVELOPER':
        return this.config.stripePriceDeveloper ?? null;
      case 'GROWTH':
        return this.config.stripePriceGrowth ?? null;
      case 'ENTERPRISE':
        return this.config.stripePriceEnterprise ?? null;
      default:
        // Defensive — keeps us honest if a new tier is added to plans.ts
        // without a corresponding env getter here.
        this.logger.warn(
          `planTierToPriceId: unrecognized stripeEnvSuffix "${def.stripeEnvSuffix}" for tier ${tier}.`,
        );
        return null;
    }
  }

  // ── Webhook handlers ─────────────────────────────────────────────────

  private async onCheckoutCompleted(event: StripeEvent): Promise<HandleWebhookResult> {
    const session = event.data.object as {
      id?: string;
      customer?: string | null;
      subscription?: string | null;
      client_reference_id?: string | null;
      metadata?: Record<string, string> | null;
    };
    const principalId = session.metadata?.principalId ?? session.client_reference_id ?? null;
    if (!principalId) {
      throw new ValidationError(
        `Stripe checkout.session.completed (event ${event.id}) missing principalId metadata.`,
      );
    }

    // Resolve plan tier: prefer subscription line items, fall back to metadata.
    let planTier: PlanTier | null = null;
    let subscriptionStatus: string | null = null;
    let overageItemId: string | null = null;
    if (session.subscription) {
      const stripe = this.client();
      const subId = session.subscription;
      const sub = await this.breaker.exec(() => stripe.subscriptions.retrieve(subId));
      planTier = this.deriveSubscriptionState(sub)?.planTier ?? null;
      subscriptionStatus = this.readSubscriptionStatus(sub);
      overageItemId = this.extractOverageItemId(sub);
    }
    if (!planTier && session.metadata?.planTier) {
      const candidate = session.metadata.planTier as PlanTier;
      if (candidate in PLANS) planTier = candidate;
    }
    if (!planTier) {
      throw new ValidationError(
        `Stripe checkout.session.completed (event ${event.id}) could not derive plan tier.`,
      );
    }

    // Read previous planTier BEFORE the update so the audit event captures
    // the from/to transition. NOTE: TrialService.reset() exists but is
    // admin-only — DO NOT call it here. Per Round 19 F-02 the trial cap is
    // a lifetime cap and exhausted state must NOT clear on a plan upgrade.
    const previous = await this.prisma.principal.findUnique({
      where: { id: principalId },
      select: { planTier: true },
    });
    const previousTier = previous?.planTier ?? null;

    await this.prisma.principal.update({
      where: { id: principalId },
      data: {
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
        stripeSubscriptionId:
          typeof session.subscription === 'string' ? session.subscription : undefined,
        planTier,
        ...(subscriptionStatus !== null ? { subscriptionStatus } : {}),
        // Always write the overage-item id (including null) so a downgrade
        // / mid-cycle remove of the metered line clears the stale id.
        stripeOverageItemId: overageItemId,
      },
    });
    await this.usageGuard.invalidatePlanCache(principalId);

    if (previousTier !== planTier) {
      await this.emitPlanChangedAudit({
        principalId,
        from: previousTier,
        to: planTier,
        stripeEventId: event.id,
        subscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
      });
    }

    return { handled: true, principalId, planTier };
  }

  private async onSubscriptionUpdated(event: StripeEvent): Promise<HandleWebhookResult> {
    const sub = event.data.object as {
      id?: string;
      customer?: string | null;
      metadata?: Record<string, string> | null;
    };
    const subId = sub.id;
    if (!subId) {
      throw new ValidationError(
        `Stripe ${event.type} (event ${event.id}) missing subscription id.`,
      );
    }
    const state = this.deriveSubscriptionState(sub);
    if (!state) {
      this.logger.warn(`Stripe ${event.type} for ${subId}: no matching price id; ignoring.`);
      return { handled: false };
    }

    // Look up principal by stripeSubscriptionId.
    const subscriptionStatus = this.readSubscriptionStatus(sub);
    const overageItemId = this.extractOverageItemId(sub);
    const principal = await this.prisma.principal.findFirst({
      where: { stripeSubscriptionId: subId },
      select: { id: true, planTier: true },
    });
    if (!principal) {
      const metaPid = this.readMetadataPrincipalId(sub);
      if (metaPid) {
        const prior = await this.prisma.principal.findUnique({
          where: { id: metaPid },
          select: { planTier: true },
        });
        await this.prisma.principal.update({
          where: { id: metaPid },
          data: {
            stripeSubscriptionId: subId,
            planTier: state.planTier,
            stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : undefined,
            ...(subscriptionStatus !== null ? { subscriptionStatus } : {}),
            stripeOverageItemId: overageItemId,
          },
        });
        await this.usageGuard.invalidatePlanCache(metaPid);
        if ((prior?.planTier ?? null) !== state.planTier) {
          await this.emitPlanChangedAudit({
            principalId: metaPid,
            from: prior?.planTier ?? null,
            to: state.planTier,
            stripeEventId: event.id,
            subscriptionId: subId,
          });
        }
        return { handled: true, principalId: metaPid, planTier: state.planTier };
      }
      this.logger.warn(`Stripe ${event.type} for ${subId}: no principal linked; ignoring.`);
      return { handled: false };
    }

    await this.prisma.principal.update({
      where: { id: principal.id },
      data: {
        planTier: state.planTier,
        ...(subscriptionStatus !== null ? { subscriptionStatus } : {}),
        stripeOverageItemId: overageItemId,
      },
    });
    await this.usageGuard.invalidatePlanCache(principal.id);
    if (principal.planTier !== state.planTier) {
      await this.emitPlanChangedAudit({
        principalId: principal.id,
        from: principal.planTier,
        to: state.planTier,
        stripeEventId: event.id,
        subscriptionId: subId,
      });
    }
    return { handled: true, principalId: principal.id, planTier: state.planTier };
  }

  private async onSubscriptionDeleted(event: StripeEvent): Promise<HandleWebhookResult> {
    const sub = event.data.object as { id?: string };
    if (!sub.id) {
      throw new ValidationError(
        `Stripe customer.subscription.deleted (event ${event.id}) missing subscription id.`,
      );
    }
    const principal = await this.prisma.principal.findFirst({
      where: { stripeSubscriptionId: sub.id },
      select: { id: true, planTier: true },
    });
    if (!principal) {
      this.logger.warn(`Stripe customer.subscription.deleted for ${sub.id}: no principal linked.`);
      return { handled: false };
    }
    await this.prisma.principal.update({
      where: { id: principal.id },
      data: { planTier: 'FREE', stripeSubscriptionId: null, stripeOverageItemId: null },
    });
    await this.usageGuard.invalidatePlanCache(principal.id);
    if (principal.planTier !== 'FREE') {
      await this.emitPlanChangedAudit({
        principalId: principal.id,
        from: principal.planTier,
        to: 'FREE',
        stripeEventId: event.id,
        subscriptionId: sub.id,
      });
    }
    return { handled: true, principalId: principal.id, planTier: 'FREE' };
  }

  // ── Payment lifecycle handlers ───────────────────────────────────────

  private async onPaymentFailed(event: StripeEvent): Promise<HandleWebhookResult> {
    const invoice = event.data.object as {
      subscription?: string | null;
      customer?: string | null;
    };
    const subId = typeof invoice.subscription === 'string' ? invoice.subscription : null;
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
    const principal = await this.findPrincipalForInvoice(subId, customerId);
    if (!principal) {
      this.logger.warn(
        `Stripe invoice.payment_failed (event ${event.id}) — no principal linked (sub=${subId ?? '-'}, cus=${customerId ?? '-'}).`,
      );
      return { handled: false };
    }
    // Grace period: NO planTier change. Only mark subscriptionStatus so the
    // dashboard can prompt "Payment failed — update card".
    await this.prisma.principal.update({
      where: { id: principal.id },
      data: { subscriptionStatus: 'past_due' },
    });
    // subscriptionStatus is observability, not a plan-tier change — emit a
    // dedicated billing.payment_failed audit event but NOT plan_changed.
    await this.audit.append({
      agentId: null,
      principalId: principal.id,
      action: 'billing.payment_failed',
      decision: 'APPROVED',
      policySnapshot: {
        stripeEventId: event.id,
        subscriptionId: subId,
        customerId,
      },
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'VERIFIED',
    });
    return { handled: true, principalId: principal.id };
  }

  private async onPaymentSucceeded(event: StripeEvent): Promise<HandleWebhookResult> {
    const invoice = event.data.object as {
      subscription?: string | null;
      customer?: string | null;
    };
    const subId = typeof invoice.subscription === 'string' ? invoice.subscription : null;
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
    const principal = await this.findPrincipalForInvoice(subId, customerId);
    if (!principal) {
      this.logger.warn(
        `Stripe invoice.payment_succeeded (event ${event.id}) — no principal linked (sub=${subId ?? '-'}, cus=${customerId ?? '-'}).`,
      );
      return { handled: false };
    }
    if (principal.subscriptionStatus !== 'past_due') {
      // No-op on routine renewals — avoids audit-event spam every cycle.
      return { handled: true, principalId: principal.id };
    }
    await this.prisma.principal.update({
      where: { id: principal.id },
      data: { subscriptionStatus: 'active' },
    });
    await this.audit.append({
      agentId: null,
      principalId: principal.id,
      action: 'billing.payment_recovered',
      decision: 'APPROVED',
      policySnapshot: {
        stripeEventId: event.id,
        subscriptionId: subId,
        customerId,
      },
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'VERIFIED',
    });
    return { handled: true, principalId: principal.id };
  }

  private async findPrincipalForInvoice(
    subscriptionId: string | null,
    customerId: string | null,
  ): Promise<{ id: string; subscriptionStatus: string | null } | null> {
    if (subscriptionId) {
      const bySub = await this.prisma.principal.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
        select: { id: true, subscriptionStatus: true },
      });
      if (bySub) return bySub;
    }
    if (customerId) {
      const byCus = await this.prisma.principal.findFirst({
        where: { stripeCustomerId: customerId },
        select: { id: true, subscriptionStatus: true },
      });
      if (byCus) return byCus;
    }
    return null;
  }

  /**
   * Emit a `billing.plan_changed` audit event. Fired on every Principal
   * planTier mutation through the webhook handlers (CLAUDE.md invariant 3).
   * Caller is responsible for guarding with a from !== to check — we do not
   * want plan_changed events for no-op writes.
   *
   * Per CLAUDE.md invariant 4 (no silent failures): we deliberately do NOT
   * try/catch here. If the audit chain rejects the append, the webhook
   * dispatch throws, the SETNX idempotency key is rolled back upstream, and
   * Stripe retries.
   */
  private async emitPlanChangedAudit(input: {
    principalId: string;
    from: PlanTier | null;
    to: PlanTier;
    stripeEventId: string;
    subscriptionId: string | null;
  }): Promise<void> {
    await this.audit.append({
      agentId: null,
      principalId: input.principalId,
      action: 'billing.plan_changed',
      decision: 'APPROVED',
      policySnapshot: {
        from: input.from,
        to: input.to,
        stripeEventId: input.stripeEventId,
        subscriptionId: input.subscriptionId,
      },
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'VERIFIED',
    });
  }

  // ── Customer Portal ─────────────────────────────────────────────────

  /**
   * Create a Stripe Customer Portal session. The caller redirects the
   * browser to the returned URL; Stripe routes it back to `returnUrl`
   * (passed in by the dashboard so the customer lands on a tier-specific
   * success page).
   */
  async createPortalSession(principalId: string, returnUrl: string): Promise<{ url: string }> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableError('Stripe billing is not configured.');
    }
    const principal = await this.prisma.principal.findUnique({
      where: { id: principalId },
      select: { stripeCustomerId: true },
    });
    if (!principal) {
      throw new ValidationError(`Principal ${principalId} not found.`);
    }
    if (!principal.stripeCustomerId) {
      throw new ValidationError(
        'Principal has no Stripe customer; subscribe via /billing/checkout first.',
      );
    }
    const customerId = principal.stripeCustomerId;
    const session = await this.breaker.exec(() =>
      this.client().billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      }),
    );
    return { url: session.url };
  }

  // ── Pure helpers ─────────────────────────────────────────────────────

  /**
   * Derive the active plan tier from a Stripe subscription resource.
   * type-rationale: Stripe.Subscription.items.data[].price.id is deeply
   * nested; we narrow with optional chaining instead of importing the type.
   */
  private deriveSubscriptionState(sub: unknown): { planTier: PlanTier; priceId: string } | null {
    if (typeof sub !== 'object' || sub === null) return null;
    // type-rationale: traversing untyped Stripe response shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (sub as any).items?.data;
    if (!Array.isArray(items) || items.length === 0) return null;
    const first = items[0] as { price?: { id?: string } };
    const priceId = first.price?.id;
    if (!priceId) return null;
    const tier = this.priceIdToPlanTier(priceId);
    if (!tier) return null;
    return { planTier: tier, priceId };
  }

  private readSubscriptionStatus(sub: unknown): string | null {
    if (typeof sub !== 'object' || sub === null) return null;
    // type-rationale: Stripe.Subscription.status is a string enum; we
    // persist the raw value verbatim.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (sub as any).status;
    return typeof status === 'string' ? status : null;
  }

  private readMetadataPrincipalId(sub: unknown): string | null {
    if (typeof sub !== 'object' || sub === null) return null;
    // type-rationale: Stripe.Subscription.metadata is Record<string,string>.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (sub as any).metadata;
    if (md && typeof md === 'object' && typeof md.principalId === 'string') {
      return md.principalId;
    }
    return null;
  }
}

// Re-export the error type so callers can `instanceof` against the public
// surface without importing the deep path.
export { CerniqError };
