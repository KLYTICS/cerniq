// StripeService unit tests.
//
// We inject a fake Stripe SDK via the optional `STRIPE_FACTORY` seam so
// the real `require('stripe')` is never invoked — this keeps the suite
// runnable even when the npm package is not yet installed.

import { Logger } from '@nestjs/common';

import { ServiceUnavailableError, ValidationError } from '../../common/errors/okoro-error';

import {
  StripeService,
  type StripeEvent,
  type StripeFactory,
} from './stripe.service';

// ─────────────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────────────

interface FakePrincipalRow {
  id: string;
  email: string;
  planTier: 'FREE' | 'DEVELOPER' | 'GROWTH' | 'ENTERPRISE';
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus?: string | null;
  stripeOverageItemId?: string | null;
}

function makePrismaStub(initial: FakePrincipalRow[]) {
  const rows = new Map(initial.map((p) => [p.id, { ...p }]));

  return {
    rows,
    principal: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        // Return a snapshot (clone) so subsequent updates don't mutate the
        // caller's reference — real Prisma returns plain objects, not row
        // refs, and the audit-emission logic relies on the pre-update
        // planTier read.
        const row = rows.get(where.id);
        return row ? { ...row } : null;
      }),
      findFirst: jest.fn(
        async ({ where }: { where: Partial<FakePrincipalRow> }) => {
          for (const row of rows.values()) {
            if (
              where.stripeSubscriptionId &&
              row.stripeSubscriptionId === where.stripeSubscriptionId
            ) {
              return { ...row }; // snapshot — see findUnique comment
            }
            if (
              where.stripeCustomerId &&
              row.stripeCustomerId === where.stripeCustomerId
            ) {
              return { ...row }; // snapshot
            }
          }
          return null;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<FakePrincipalRow> & { subscriptionStatus?: string };
        }) => {
          const row = rows.get(where.id);
          if (!row) throw new Error('row not found');
          Object.assign(row, data);
          return row;
        },
      ),
      updateMany: jest.fn(),
    },
  };
}

function makeRedisStub() {
  const store = new Map<string, string>();
  const setMock = jest.fn(
    async (
      key: string,
      _val: string,
      _exMode?: string,
      _ttl?: number,
      nxFlag?: string,
    ) => {
      if (nxFlag === 'NX' && store.has(key)) return null;
      store.set(key, _val);
      return 'OK';
    },
  );
  return {
    store,
    setMock,
    raw: () => ({ set: setMock }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function makeConfigStub(overrides: Partial<Record<string, string | undefined>> = {}) {
  const cfg: Record<string, string | undefined> = {
    stripeSecretKey: 'sk_test_x',
    stripeWebhookSecret: 'whsec_test_x',
    stripePriceDeveloper: 'price_dev',
    stripePriceGrowth: 'price_growth',
    stripePriceEnterprise: 'price_ent',
    stripePriceOverageVerify: 'price_overage_verify',
    ...overrides,
  };
  // type-rationale: minimal stub of AppConfigService — only the getters
  // StripeService reads.
  return cfg as unknown as import('../../config/config.service').AppConfigService;
}

function makeUsageGuardStub() {
  return {
    invalidatePlanCache: jest.fn(async () => {}),
  };
}

function makeAuditStub() {
  // type-rationale: jest infers `jest.fn(async () => 'x')` as having an
  // empty parameter tuple, which then breaks `mock.calls[i][0]` access.
  // Annotate explicitly so the call-tuple typing reflects reality.
  const append = jest.fn<Promise<string>, [Record<string, unknown>]>(async () => 'evt_audit_1');
  return { append };
}

interface FakeStripe {
  customers: { create: jest.Mock };
  checkout: { sessions: { create: jest.Mock } };
  billingPortal: { sessions: { create: jest.Mock } };
  subscriptions: { retrieve: jest.Mock };
  subscriptionItems: { createUsageRecord: jest.Mock };
  webhooks: { constructEvent: jest.Mock };
}

function makeFakeStripe(): FakeStripe {
  return {
    customers: {
      create: jest.fn(async (params: { email: string }) => ({
        id: `cus_for_${params.email}`,
      })),
    },
    checkout: {
      sessions: {
        create: jest.fn(async () => ({
          id: 'cs_test_1',
          url: 'https://stripe.test/checkout/cs_test_1',
        })),
      },
    },
    billingPortal: {
      sessions: {
        create: jest.fn(async (params: { customer: string; return_url: string }) => ({
          id: 'bps_test_1',
          url: `https://billing.stripe.test/p/${params.customer}`,
        })),
      },
    },
    subscriptions: {
      retrieve: jest.fn(async (id: string) => ({
        id,
        status: 'active',
        items: { data: [{ id: 'si_base_default', price: { id: 'price_dev' } }] },
        metadata: {},
      })),
    },
    subscriptionItems: {
      createUsageRecord: jest.fn(async (_itemId: string, _params: { quantity: number }) => ({
        id: 'mbur_test_1',
      })),
    },
    webhooks: {
      constructEvent: jest.fn((_body: unknown, _sig: string, _secret: string) => {
        throw new Error('default mock — override per test');
      }),
    },
  };
}

function build(overrides: {
  config?: Partial<Record<string, string | undefined>>;
  principals?: FakePrincipalRow[];
  fakeStripe?: FakeStripe;
} = {}) {
  const fakeStripe = overrides.fakeStripe ?? makeFakeStripe();
  const factory: StripeFactory = jest.fn(() => fakeStripe);
  const prisma = makePrismaStub(overrides.principals ?? []);
  const redis = makeRedisStub();
  const config = makeConfigStub(overrides.config);
  const usage = makeUsageGuardStub();
  const audit = makeAuditStub();

  // type-rationale: passing test stubs to a constructor that expects the
  // real Nest services. Cast through unknown to satisfy TS without
  // pulling in the full DI graph.
  const svc = new StripeService(
    prisma as unknown as import('../../common/prisma/prisma.service').PrismaService,
    redis as unknown as import('../../common/redis/redis.service').RedisService,
    config,
    usage as unknown as import('./usage-guard.service').UsageGuardService,
    audit as unknown as import('../audit/audit.service').AuditService,
    factory,
  );

  return { svc, fakeStripe, prisma, redis, config, usage, audit, factory };
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('StripeService', () => {
  describe('isEnabled()', () => {
    it('false when STRIPE_SECRET_KEY absent', () => {
      const { svc } = build({ config: { stripeSecretKey: undefined } });
      expect(svc.isEnabled()).toBe(false);
    });
    it('true when STRIPE_SECRET_KEY set', () => {
      const { svc } = build();
      expect(svc.isEnabled()).toBe(true);
    });
  });

  describe('createCheckoutSession()', () => {
    it('throws when isEnabled()=false', async () => {
      const { svc } = build({ config: { stripeSecretKey: undefined } });
      await expect(
        svc.createCheckoutSession({
          principalId: 'p1',
          planTier: 'DEVELOPER',
          successUrl: 'https://okoro.test/ok',
          cancelUrl: 'https://okoro.test/no',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
    });

    it('throws on FREE planTier', async () => {
      const { svc } = build({
        principals: [
          { id: 'p1', email: 'a@b', planTier: 'FREE', stripeCustomerId: null, stripeSubscriptionId: null },
        ],
      });
      await expect(
        svc.createCheckoutSession({
          principalId: 'p1',
          planTier: 'FREE',
          successUrl: 'https://okoro.test/ok',
          cancelUrl: 'https://okoro.test/no',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws on ENTERPRISE planTier', async () => {
      const { svc } = build({
        principals: [
          { id: 'p1', email: 'a@b', planTier: 'FREE', stripeCustomerId: null, stripeSubscriptionId: null },
        ],
      });
      await expect(
        svc.createCheckoutSession({
          principalId: 'p1',
          planTier: 'ENTERPRISE',
          successUrl: 'https://okoro.test/ok',
          cancelUrl: 'https://okoro.test/no',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('creates customer + session for DEVELOPER tier and passes metadata.principalId', async () => {
      const { svc, fakeStripe, prisma } = build({
        principals: [
          { id: 'p1', email: 'erwin@okoro.test', planTier: 'FREE', stripeCustomerId: null, stripeSubscriptionId: null },
        ],
      });

      const out = await svc.createCheckoutSession({
        principalId: 'p1',
        planTier: 'DEVELOPER',
        successUrl: 'https://okoro.test/ok',
        cancelUrl: 'https://okoro.test/no',
      });
      expect(out.url).toBe('https://stripe.test/checkout/cs_test_1');
      expect(fakeStripe.customers.create).toHaveBeenCalledTimes(1);
      const sessionArgs = fakeStripe.checkout.sessions.create.mock.calls[0][0];
      expect(sessionArgs.metadata).toEqual({ principalId: 'p1', planTier: 'DEVELOPER' });
      expect(sessionArgs.client_reference_id).toBe('p1');
      expect(sessionArgs.line_items[0].price).toBe('price_dev');
      // Customer id persisted on the principal.
      expect(prisma.rows.get('p1')?.stripeCustomerId).toBe('cus_for_erwin@okoro.test');
    });

    it('reuses existing principal.stripeCustomerId', async () => {
      const { svc, fakeStripe } = build({
        principals: [
          {
            id: 'p1',
            email: 'erwin@okoro.test',
            planTier: 'FREE',
            stripeCustomerId: 'cus_existing',
            stripeSubscriptionId: null,
          },
        ],
      });

      await svc.createCheckoutSession({
        principalId: 'p1',
        planTier: 'DEVELOPER',
        successUrl: 'https://okoro.test/ok',
        cancelUrl: 'https://okoro.test/no',
      });
      expect(fakeStripe.customers.create).not.toHaveBeenCalled();
      const sessionArgs = fakeStripe.checkout.sessions.create.mock.calls[0][0];
      expect(sessionArgs.customer).toBe('cus_existing');
    });
  });

  describe('verifyWebhookSignature()', () => {
    it('happy path returns the parsed event', () => {
      const fakeStripe = makeFakeStripe();
      fakeStripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { object: {} },
      });
      const { svc } = build({ fakeStripe });
      const evt = svc.verifyWebhookSignature('raw', 'sig');
      expect(evt.id).toBe('evt_1');
    });

    it('tampered signature throws ValidationError', () => {
      const fakeStripe = makeFakeStripe();
      fakeStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('bad sig');
      });
      const { svc } = build({ fakeStripe });
      expect(() => svc.verifyWebhookSignature('raw', 'sig')).toThrow(ValidationError);
    });
  });

  describe('handleWebhookEvent()', () => {
    function ev(over: Partial<StripeEvent>): StripeEvent {
      return {
        id: 'evt_default',
        type: 'unknown',
        data: { object: {} },
        ...over,
      };
    }

    it('checkout.session.completed updates planTier and invalidates cache', async () => {
      const { svc, prisma, usage } = build({
        principals: [
          {
            id: 'p1',
            email: 'erwin@okoro.test',
            planTier: 'FREE',
            stripeCustomerId: null,
            stripeSubscriptionId: null,
          },
        ],
      });
      const out = await svc.handleWebhookEvent(
        ev({
          id: 'evt_co_1',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_1',
              customer: 'cus_x',
              subscription: 'sub_x',
              client_reference_id: 'p1',
              metadata: { principalId: 'p1', planTier: 'DEVELOPER' },
            },
          },
        }),
      );
      expect(out).toEqual({ handled: true, principalId: 'p1', planTier: 'DEVELOPER' });
      expect(prisma.rows.get('p1')?.planTier).toBe('DEVELOPER');
      expect(prisma.rows.get('p1')?.stripeCustomerId).toBe('cus_x');
      expect(prisma.rows.get('p1')?.stripeSubscriptionId).toBe('sub_x');
      expect(usage.invalidatePlanCache).toHaveBeenCalledWith('p1');
    });

    it('idempotency: a second call with the same event.id returns handled=false', async () => {
      const { svc, usage } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'FREE',
            stripeCustomerId: null,
            stripeSubscriptionId: null,
          },
        ],
      });
      const event = ev({
        id: 'evt_dup',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_1',
            customer: 'cus_x',
            subscription: 'sub_x',
            client_reference_id: 'p1',
            metadata: { principalId: 'p1', planTier: 'DEVELOPER' },
          },
        },
      });
      const first = await svc.handleWebhookEvent(event);
      expect(first.handled).toBe(true);
      usage.invalidatePlanCache.mockClear();
      const second = await svc.handleWebhookEvent(event);
      expect(second).toEqual({ handled: false });
      expect(usage.invalidatePlanCache).not.toHaveBeenCalled();
    });

    it('customer.subscription.deleted downgrades to FREE', async () => {
      const { svc, prisma, usage } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'GROWTH',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
          },
        ],
      });
      const out = await svc.handleWebhookEvent(
        ev({
          id: 'evt_del_1',
          type: 'customer.subscription.deleted',
          data: { object: { id: 'sub_x' } },
        }),
      );
      expect(out).toEqual({ handled: true, principalId: 'p1', planTier: 'FREE' });
      expect(prisma.rows.get('p1')?.planTier).toBe('FREE');
      expect(prisma.rows.get('p1')?.stripeSubscriptionId).toBeNull();
      expect(usage.invalidatePlanCache).toHaveBeenCalledWith('p1');
    });

    it('unknown event type returns handled=false (no error)', async () => {
      const { svc } = build();
      const out = await svc.handleWebhookEvent(
        ev({ id: 'evt_unknown_1', type: 'customer.created' }),
      );
      expect(out).toEqual({ handled: false });
    });

    it('invoice.payment_failed marks past_due, no plan change, audit emitted', async () => {
      const { svc, prisma, audit } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'GROWTH',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            subscriptionStatus: 'active',
          },
        ],
      });
      const out = await svc.handleWebhookEvent(
        ev({
          id: 'evt_pay_fail',
          type: 'invoice.payment_failed',
          data: { object: { subscription: 'sub_x', customer: 'cus_x' } },
        }),
      );
      expect(out).toEqual({ handled: true, principalId: 'p1' });
      // No plan change — grace period.
      expect(prisma.rows.get('p1')?.planTier).toBe('GROWTH');
      expect(prisma.rows.get('p1')?.subscriptionStatus).toBe('past_due');
      const failCalls = audit.append.mock.calls.filter(
        (c) => c[0].action === 'billing.payment_failed',
      );
      expect(failCalls).toHaveLength(1);
      expect(failCalls[0][0]).toMatchObject({
        principalId: 'p1',
        action: 'billing.payment_failed',
        policySnapshot: {
          stripeEventId: 'evt_pay_fail',
          subscriptionId: 'sub_x',
          customerId: 'cus_x',
        },
      });
    });

    it('invoice.payment_failed falls back to stripeCustomerId when subscription id is missing', async () => {
      const { svc, prisma } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'GROWTH',
            stripeCustomerId: 'cus_solo',
            stripeSubscriptionId: null,
            subscriptionStatus: 'active',
          },
        ],
      });
      const out = await svc.handleWebhookEvent(
        ev({
          id: 'evt_pay_fail_nosub',
          type: 'invoice.payment_failed',
          data: { object: { customer: 'cus_solo' } },
        }),
      );
      expect(out).toEqual({ handled: true, principalId: 'p1' });
      expect(prisma.rows.get('p1')?.subscriptionStatus).toBe('past_due');
    });

    it('invoice.payment_succeeded clears past_due → active and audits payment_recovered', async () => {
      const { svc, prisma, audit } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'GROWTH',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            subscriptionStatus: 'past_due',
          },
        ],
      });
      const out = await svc.handleWebhookEvent(
        ev({
          id: 'evt_pay_ok',
          type: 'invoice.payment_succeeded',
          data: { object: { subscription: 'sub_x', customer: 'cus_x' } },
        }),
      );
      expect(out).toEqual({ handled: true, principalId: 'p1' });
      expect(prisma.rows.get('p1')?.subscriptionStatus).toBe('active');
      const recoveryCalls = audit.append.mock.calls.filter(
        (c) => c[0].action === 'billing.payment_recovered',
      );
      expect(recoveryCalls).toHaveLength(1);
    });

    it('invoice.payment_succeeded is a no-op when status is already active', async () => {
      const { svc, prisma, audit } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'GROWTH',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            subscriptionStatus: 'active',
          },
        ],
      });
      const out = await svc.handleWebhookEvent(
        ev({
          id: 'evt_pay_ok_renew',
          type: 'invoice.payment_succeeded',
          data: { object: { subscription: 'sub_x', customer: 'cus_x' } },
        }),
      );
      expect(out).toEqual({ handled: true, principalId: 'p1' });
      expect(prisma.rows.get('p1')?.subscriptionStatus).toBe('active');
      // No audit event — avoid spam on every monthly renewal.
      const recoveryCalls = audit.append.mock.calls.filter(
        (c) => c[0].action === 'billing.payment_recovered',
      );
      expect(recoveryCalls).toHaveLength(0);
    });

    it('emits billing.plan_changed audit event on subscription.created', async () => {
      const { svc, audit, fakeStripe } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'FREE',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
          },
        ],
      });
      fakeStripe.subscriptions.retrieve.mockResolvedValueOnce({
        id: 'sub_x',
        status: 'active',
        items: { data: [{ price: { id: 'price_growth' } }] },
        metadata: {},
      });
      const out = await svc.handleWebhookEvent(
        ev({
          id: 'evt_sub_created',
          type: 'customer.subscription.created',
          data: {
            object: {
              id: 'sub_x',
              customer: 'cus_x',
              status: 'active',
              items: { data: [{ price: { id: 'price_growth' } }] },
              metadata: {},
            },
          },
        }),
      );
      expect(out).toEqual({ handled: true, principalId: 'p1', planTier: 'GROWTH' });
      const planChanges = audit.append.mock.calls.filter(
        (c) => c[0].action === 'billing.plan_changed',
      );
      expect(planChanges).toHaveLength(1);
      expect(planChanges[0][0]).toMatchObject({
        action: 'billing.plan_changed',
        principalId: 'p1',
        policySnapshot: {
          from: 'FREE',
          to: 'GROWTH',
          stripeEventId: 'evt_sub_created',
          subscriptionId: 'sub_x',
        },
      });
    });

    it('idempotency: duplicate webhook does NOT re-emit audit events', async () => {
      const { svc, audit, fakeStripe } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'FREE',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
          },
        ],
      });
      fakeStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_x',
        status: 'active',
        items: { data: [{ price: { id: 'price_dev' } }] },
        metadata: {},
      });
      const event = ev({
        id: 'evt_dedup_audit',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_x',
            customer: 'cus_x',
            items: { data: [{ price: { id: 'price_dev' } }] },
            metadata: {},
          },
        },
      });
      await svc.handleWebhookEvent(event);
      const firstCount = audit.append.mock.calls.length;
      await svc.handleWebhookEvent(event);
      // SETNX gate skips the whole handler — no additional audit emits.
      expect(audit.append.mock.calls.length).toBe(firstCount);
    });
  });

  describe('createPortalSession()', () => {
    it('returns a portal URL for the principal customer', async () => {
      const { svc, fakeStripe } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'DEVELOPER',
            stripeCustomerId: 'cus_existing',
            stripeSubscriptionId: 'sub_x',
          },
        ],
      });
      const out = await svc.createPortalSession(
        'p1',
        'https://app.okorolabs.io/billing/back',
      );
      expect(out.url).toBe('https://billing.stripe.test/p/cus_existing');
      expect(fakeStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_existing',
        return_url: 'https://app.okorolabs.io/billing/back',
      });
    });

    it('throws ValidationError when principal has no stripeCustomerId', async () => {
      const { svc } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'FREE',
            stripeCustomerId: null,
            stripeSubscriptionId: null,
          },
        ],
      });
      await expect(
        svc.createPortalSession('p1', 'https://app.okorolabs.io/back'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws ServiceUnavailableError when Stripe is disabled', async () => {
      const { svc } = build({
        config: { stripeSecretKey: undefined },
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'DEVELOPER',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
          },
        ],
      });
      await expect(
        svc.createPortalSession('p1', 'https://app.okorolabs.io/back'),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
    });
  });

  describe('priceIdToPlanTier()', () => {
    it('maps each configured env price → tier', () => {
      const { svc } = build();
      expect(svc.priceIdToPlanTier('price_dev')).toBe('DEVELOPER');
      expect(svc.priceIdToPlanTier('price_growth')).toBe('GROWTH');
      expect(svc.priceIdToPlanTier('price_ent')).toBe('ENTERPRISE');
    });
    it('returns null for unknown price', () => {
      const { svc } = build();
      expect(svc.priceIdToPlanTier('price_garbage')).toBeNull();
    });
    it('returns null for empty string', () => {
      const { svc } = build();
      expect(svc.priceIdToPlanTier('')).toBeNull();
    });
  });

  // ── Circuit breaker ───────────────────────────────────────────────────────
  // The breaker trips to OPEN after `failureThreshold` (5) consecutive
  // failures. While OPEN, calls are fast-rejected with CircuitOpenError
  // without touching the Stripe SDK. After `resetTimeoutMs` (30 s) the
  // breaker moves to HALF_OPEN and allows a single probe call.

  describe('Circuit breaker (OPEN state)', () => {
    it('trips to OPEN after failureThreshold consecutive errors', async () => {
      const fakeStripe = makeFakeStripe();
      const { svc } = build({ fakeStripe, principals: [{ id: 'p_ho', email: 'ho@test.com', planTier: 'FREE' as const, stripeCustomerId: null, stripeSubscriptionId: null }] });

      // Make checkout session creation fail every time
      const boom = new Error('stripe network error');
      fakeStripe.checkout.sessions.create.mockRejectedValue(boom);

      const principalId = 'p_cb';

      // Drive 5 failures (= failureThreshold)
      for (let i = 0; i < 5; i++) {
        await expect(
          svc.createCheckoutSession({
            principalId,
            planTier: 'DEVELOPER',
            successUrl: 'https://example.com/ok',
            cancelUrl: 'https://example.com/cancel',
          }),
        ).rejects.toThrow();
      }

      // 6th call: breaker should be OPEN — fast-reject without calling Stripe
      fakeStripe.checkout.sessions.create.mockClear();
      await expect(
        svc.createCheckoutSession({
          principalId,
          planTier: 'DEVELOPER',
          successUrl: 'https://example.com/ok',
          cancelUrl: 'https://example.com/cancel',
        }),
      ).rejects.toThrow();

      // When OPEN, the underlying Stripe call is NOT made
      expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('counts only consecutive failures — a success resets the counter', async () => {
      const fakeStripe = makeFakeStripe();
      const { svc } = build({
        fakeStripe,
        principals: [{ id: 'p_reset', email: 'reset@test.com', planTier: 'FREE', stripeCustomerId: null, stripeSubscriptionId: null }],
      });

      const boom = new Error('stripe error');

      // 4 failures (below threshold)
      fakeStripe.checkout.sessions.create.mockRejectedValue(boom);
      for (let i = 0; i < 4; i++) {
        await expect(
          svc.createCheckoutSession({
            principalId: 'p_reset', planTier: 'DEVELOPER',
            successUrl: 'https://x.com/ok', cancelUrl: 'https://x.com/cancel',
          }),
        ).rejects.toThrow();
      }

      // 1 success — resets failure counter
      fakeStripe.checkout.sessions.create.mockResolvedValueOnce({ id: 'cs_ok', url: 'https://x.com/cs_ok' });
      await expect(
        svc.createCheckoutSession({
          principalId: 'p_reset', planTier: 'DEVELOPER',
          successUrl: 'https://x.com/ok', cancelUrl: 'https://x.com/cancel',
        }),
      ).resolves.toMatchObject({ url: 'https://x.com/cs_ok' });

      // Now 4 more failures — should NOT yet trip (counter was reset)
      fakeStripe.checkout.sessions.create.mockRejectedValue(boom);
      for (let i = 0; i < 4; i++) {
        await expect(
          svc.createCheckoutSession({
            principalId: 'p_reset', planTier: 'DEVELOPER',
            successUrl: 'https://x.com/ok', cancelUrl: 'https://x.com/cancel',
          }),
        ).rejects.toThrow();
      }

      // 5th failure in the new run — trips the breaker
      await expect(
        svc.createCheckoutSession({
          principalId: 'p_reset', planTier: 'DEVELOPER',
          successUrl: 'https://x.com/ok', cancelUrl: 'https://x.com/cancel',
        }),
      ).rejects.toThrow();

      // Next call: OPEN — Stripe not called
      fakeStripe.checkout.sessions.create.mockClear();
      await expect(
        svc.createCheckoutSession({
          principalId: 'p_reset', planTier: 'DEVELOPER',
          successUrl: 'https://x.com/ok', cancelUrl: 'https://x.com/cancel',
        }),
      ).rejects.toThrow();
      expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('moves to HALF_OPEN after resetTimeoutMs elapses and allows one probe', async () => {
      jest.useFakeTimers();
      const fakeStripe = makeFakeStripe();
      const { svc } = build({
        fakeStripe,
        principals: [{ id: 'p_ho', email: 'ho@test.com', planTier: 'FREE' as const, stripeCustomerId: null, stripeSubscriptionId: null }],
      });

      const boom = new Error('stripe error');
      fakeStripe.checkout.sessions.create.mockRejectedValue(boom);

      // Trip the breaker
      for (let i = 0; i < 5; i++) {
        await expect(
          svc.createCheckoutSession({
            principalId: 'p_ho', planTier: 'DEVELOPER',
            successUrl: 'https://x.com/ok', cancelUrl: 'https://x.com/cancel',
          }),
        ).rejects.toThrow();
      }

      // Advance past resetTimeoutMs (30 s)
      jest.advanceTimersByTime(31_000);

      // The next call should be a HALF_OPEN probe — allow the Stripe call.
      // Clear call history so toHaveBeenCalledTimes(1) measures only the probe.
      fakeStripe.checkout.sessions.create.mockClear();
      fakeStripe.checkout.sessions.create.mockResolvedValueOnce({ id: 'cs_probe', url: 'https://x.com/probe' });
      await expect(
        svc.createCheckoutSession({
          principalId: 'p_ho', planTier: 'DEVELOPER',
          successUrl: 'https://x.com/ok', cancelUrl: 'https://x.com/cancel',
        }),
      ).resolves.toMatchObject({ url: 'https://x.com/probe' });

      expect(fakeStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  // ── Round 21 Lane B: metered overage ──────────────────────────────────
  describe('recordOverage()', () => {
    it('no-ops when Stripe is disabled', async () => {
      const { svc, fakeStripe } = build({
        config: { stripeSecretKey: undefined },
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'DEVELOPER',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            stripeOverageItemId: 'si_overage_1',
          },
        ],
      });
      await svc.recordOverage('p1', 1);
      expect(fakeStripe.subscriptionItems.createUsageRecord).not.toHaveBeenCalled();
    });

    it('no-ops for FREE tier (defence in depth)', async () => {
      const { svc, fakeStripe } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'FREE',
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            stripeOverageItemId: null,
          },
        ],
      });
      await svc.recordOverage('p1', 1);
      expect(fakeStripe.subscriptionItems.createUsageRecord).not.toHaveBeenCalled();
    });

    it('no-ops with WARN log when paid tier has no stripeOverageItemId', async () => {
      const { svc, fakeStripe } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'DEVELOPER',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            stripeOverageItemId: null,
          },
        ],
      });
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      try {
        await svc.recordOverage('p1', 1);
        expect(fakeStripe.subscriptionItems.createUsageRecord).not.toHaveBeenCalled();
        const matched = warnSpy.mock.calls.some(
          (c) => typeof c[0] === 'string' && c[0].includes('p1') && c[0].includes('stripeOverageItemId'),
        );
        expect(matched).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('calls subscriptionItems.createUsageRecord with the right shape for paid+metered tier', async () => {
      const { svc, fakeStripe } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'DEVELOPER',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            stripeOverageItemId: 'si_overage_dev',
          },
        ],
      });
      await svc.recordOverage('p1', 1);
      expect(fakeStripe.subscriptionItems.createUsageRecord).toHaveBeenCalledTimes(1);
      const [itemId, params] = fakeStripe.subscriptionItems.createUsageRecord.mock.calls[0];
      expect(itemId).toBe('si_overage_dev');
      expect(params.quantity).toBe(1);
      expect(params.action).toBe('increment');
      expect(typeof params.timestamp).toBe('number');
    });

    it('swallows Stripe API errors (under-billing > verify-path failure)', async () => {
      const fakeStripe = makeFakeStripe();
      fakeStripe.subscriptionItems.createUsageRecord.mockRejectedValueOnce(
        new Error('Stripe rate limited'),
      );
      const { svc } = build({
        fakeStripe,
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'GROWTH',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            stripeOverageItemId: 'si_overage_growth',
          },
        ],
      });
      const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      try {
        await expect(svc.recordOverage('p1', 1)).resolves.toBeUndefined();
        expect(errSpy).toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
      }
    });

    it('no-ops on count < 1', async () => {
      const { svc, fakeStripe } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'DEVELOPER',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            stripeOverageItemId: 'si_overage_dev',
          },
        ],
      });
      await svc.recordOverage('p1', 0);
      expect(fakeStripe.subscriptionItems.createUsageRecord).not.toHaveBeenCalled();
    });
  });

  describe('onSubscriptionUpdated() — stripeOverageItemId population', () => {
    function ev(over: Partial<StripeEvent>): StripeEvent {
      return { id: 'evt_default', type: 'unknown', data: { object: {} }, ...over };
    }

    it('populates stripeOverageItemId when the subscription has the metered price line', async () => {
      const { svc, prisma } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'FREE',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            stripeOverageItemId: null,
          },
        ],
      });
      await svc.handleWebhookEvent(
        ev({
          id: 'evt_sub_with_overage',
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_x',
              customer: 'cus_x',
              status: 'active',
              items: {
                data: [
                  { id: 'si_base', price: { id: 'price_dev' } },
                  { id: 'si_meter', price: { id: 'price_overage_verify' } },
                ],
              },
              metadata: {},
            },
          },
        }),
      );
      expect(prisma.rows.get('p1')?.stripeOverageItemId).toBe('si_meter');
    });

    it('leaves stripeOverageItemId null when subscription has no metered line', async () => {
      const { svc, prisma } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'FREE',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            stripeOverageItemId: null,
          },
        ],
      });
      await svc.handleWebhookEvent(
        ev({
          id: 'evt_sub_no_overage',
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_x',
              customer: 'cus_x',
              status: 'active',
              items: { data: [{ id: 'si_base', price: { id: 'price_dev' } }] },
              metadata: {},
            },
          },
        }),
      );
      // null reads back as null/undefined depending on stub; both are fine.
      expect(prisma.rows.get('p1')?.stripeOverageItemId ?? null).toBeNull();
    });

    it('clears stripeOverageItemId on customer.subscription.deleted', async () => {
      const { svc, prisma } = build({
        principals: [
          {
            id: 'p1',
            email: 'a@b',
            planTier: 'GROWTH',
            stripeCustomerId: 'cus_x',
            stripeSubscriptionId: 'sub_x',
            stripeOverageItemId: 'si_meter_old',
          },
        ],
      });
      await svc.handleWebhookEvent(
        ev({
          id: 'evt_sub_del_clear',
          type: 'customer.subscription.deleted',
          data: { object: { id: 'sub_x' } },
        }),
      );
      expect(prisma.rows.get('p1')?.stripeOverageItemId).toBeNull();
    });
  });
});
