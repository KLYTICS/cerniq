// Dashboard pricing parity — guards against drift between the
// `apps/api/src/modules/billing/plans.ts` source of truth, the
// `/.well-known/pricing.json` API response shape, the dashboard's
// SSR-fetch mapper (`resolvePricing`), and the build-time fallback
// (`PRICING_TIERS` in `apps/dashboard/lib/pricing.ts`).
//
// Round 23: the dashboard now SSR-fetches the API pricing endpoint with
// the hardcoded fallback as a backstop. This spec ensures (a) the mapper
// produces the same display strings as the fallback, and (b) when fetch
// fails, the page still renders fallback data.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLANS, TRIAL_LIFETIME_CAP, getPlan } from '../../apps/api/src/modules/billing/plans';
import { PRICING_TIERS as FALLBACK_TIERS } from '../../apps/dashboard/lib/pricing';
import { resolvePricing } from '../../apps/dashboard/lib/pricing-source';

// Reconstructs the same shape `WellknownService.getPricing()` would return.
// Kept here (not imported from the API service) to keep this spec free of
// Nest DI bootstrap. If the API service shape changes, the parity test
// should fail — that's the point.
function synthesizeApiBody() {
  const tiers: Record<string, unknown> = {};
  for (const tier of Object.keys(PLANS)) {
    const plan = getPlan(tier as keyof typeof PLANS);
    tiers[tier] = {
      tier: plan.tier,
      display_name: plan.displayName,
      monthly_price_cents: plan.monthlyPriceCents,
      monthly_verify_quota: Number.isFinite(plan.monthlyVerifyQuota)
        ? plan.monthlyVerifyQuota
        : null,
      lifetime_verify_quota: tier === 'FREE' ? TRIAL_LIFETIME_CAP : null,
      overage_per_call_e4: plan.overagePerCallE4,
      agent_cap: Number.isFinite(plan.agentCap) ? plan.agentCap : null,
      audit_retention_days: plan.auditRetentionDays,
      bate_access: plan.bateAccess,
      webhooks: plan.webhooks,
      verify_p99_target_ms: plan.verifyP99TargetMs,
    };
  }
  return {
    spec_version: '1.0.0',
    generated_at: '2026-05-06T00:00:00.000Z',
    currency: 'USD',
    tiers,
    currency_overage_unit: 'USD × 10⁻⁴ (i.e. ten-thousandths of a dollar)',
    adr: 'ADR-0014',
    billing_endpoints: {
      checkout: '/v1/billing/checkout',
      portal: '/v1/billing/portal',
      plan: '/v1/billing/plan',
    },
  };
}

describe('dashboard pricing — SSR-fetch happy path', () => {
  const ORIG_FETCH = global.fetch;
  const ORIG_BASE = process.env.OKORO_API_BASE_URL;

  beforeEach(() => {
    process.env.OKORO_API_BASE_URL = 'http://api.local';
  });
  afterEach(() => {
    global.fetch = ORIG_FETCH;
    if (ORIG_BASE === undefined) delete process.env.OKORO_API_BASE_URL;
    else process.env.OKORO_API_BASE_URL = ORIG_BASE;
  });

  it('reports source=api when the endpoint returns a valid body', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(synthesizeApiBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const result = await resolvePricing();
    expect(result.source).toBe('api');
    expect(result.specVersion).toBe('1.0.0');
    expect(result.tiers).toHaveLength(5);
    expect(result.tiers.map((t) => t.id)).toEqual([
      'FREE',
      'DEVELOPER',
      'TEAM',
      'SCALE',
      'ENTERPRISE',
    ]);
  });

  it('mapped FREE/DEVELOPER/ENTERPRISE display strings match the fallback', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(synthesizeApiBody()), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await resolvePricing();

    for (const id of ['FREE', 'DEVELOPER', 'ENTERPRISE'] as const) {
      const api = result.tiers.find((t) => t.id === id)!;
      const fb = FALLBACK_TIERS.find((t) => t.id === id)!;
      expect({
        id: api.id,
        price: api.price,
        verifies: api.verifies,
        overage: api.overage,
        agents: api.agents,
        retention: api.retention,
        bate: api.bate,
        webhooks: api.webhooks,
        sla: api.sla,
        ctaLabel: api.ctaLabel,
        ctaHref: api.ctaHref,
      }).toEqual({
        id: fb.id,
        price: fb.price,
        verifies: fb.verifies,
        overage: fb.overage,
        agents: fb.agents,
        retention: fb.retention,
        bate: fb.bate,
        webhooks: fb.webhooks,
        sla: fb.sla,
        ctaLabel: fb.ctaLabel,
        ctaHref: fb.ctaHref,
      });
    }
  });

  it('TEAM is mapped from the API GROWTH tier and matches the fallback labels', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(synthesizeApiBody()), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await resolvePricing();
    const team = result.tiers.find((t) => t.id === 'TEAM')!;
    const fb = FALLBACK_TIERS.find((t) => t.id === 'TEAM')!;
    expect(team.price).toBe(fb.price);
    expect(team.verifies).toBe(fb.verifies);
    expect(team.agents).toBe(fb.agents);
    expect(team.ctaHref).toBe(fb.ctaHref);
  });

  it('SCALE falls back to the hardcoded placeholder (no server enum yet)', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(synthesizeApiBody()), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await resolvePricing();
    const scale = result.tiers.find((t) => t.id === 'SCALE')!;
    const fb = FALLBACK_TIERS.find((t) => t.id === 'SCALE')!;
    expect(scale).toEqual(fb);
  });

  it('builds 8 feature rows in the same order as the fallback', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(synthesizeApiBody()), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await resolvePricing();
    expect(result.rows.map((r) => r.label)).toEqual([
      'Price',
      'Verifies',
      'Overage',
      'Agents',
      'Audit retention',
      'BATE trust scores',
      'Webhooks',
      'SLA',
    ]);
  });
});

describe('dashboard pricing — fallback paths', () => {
  const ORIG_FETCH = global.fetch;
  const ORIG_BASE = process.env.OKORO_API_BASE_URL;
  afterEach(() => {
    global.fetch = ORIG_FETCH;
    if (ORIG_BASE === undefined) delete process.env.OKORO_API_BASE_URL;
    else process.env.OKORO_API_BASE_URL = ORIG_BASE;
  });

  it('falls back when OKORO_API_BASE_URL is unset', async () => {
    delete process.env.OKORO_API_BASE_URL;
    const result = await resolvePricing();
    expect(result.source).toBe('fallback');
    expect(result.reason).toContain('OKORO_API_BASE_URL');
    expect(result.tiers).toBe(FALLBACK_TIERS);
  });

  it('falls back when fetch throws (network error)', async () => {
    process.env.OKORO_API_BASE_URL = 'http://api.local';
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await resolvePricing();
    expect(result.source).toBe('fallback');
    expect(result.reason).toContain('ECONNREFUSED');
  });

  it('falls back on non-2xx status', async () => {
    process.env.OKORO_API_BASE_URL = 'http://api.local';
    global.fetch = vi.fn(async () =>
      new Response('upstream broken', { status: 503 }),
    ) as unknown as typeof fetch;
    const result = await resolvePricing();
    expect(result.source).toBe('fallback');
    expect(result.reason).toContain('503');
  });

  it('falls back on malformed JSON', async () => {
    process.env.OKORO_API_BASE_URL = 'http://api.local';
    global.fetch = vi.fn(async () =>
      new Response('<<not json>>', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const result = await resolvePricing();
    expect(result.source).toBe('fallback');
    expect(result.reason).toMatch(/malformed JSON|JSON/);
  });

  it('falls back when tiers field is missing', async () => {
    process.env.OKORO_API_BASE_URL = 'http://api.local';
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ spec_version: '1.0.0' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await resolvePricing();
    expect(result.source).toBe('fallback');
    expect(result.reason).toContain('tiers');
  });
});
