// pricing-source — resolves the marketing /pricing page table from either
// the canonical API endpoint (`/.well-known/pricing.json`, shipped by Round 21
// Lane A) or the hardcoded fallback in `lib/pricing.ts`. Round 23 closes the
// dual-source drift risk that Round 21 explicitly deferred.
//
// Strategy
// ────────
//   1. If `CERNIQ_API_BASE_URL` is set at request time, SSR-fetch the JSON.
//      The response has the same `Cache-Control: public, max-age=3600` as
//      `next: { revalidate: 3600 }`, so the two cache layers compose.
//   2. Map the API shape (snake_case, normalized E4 / cents / null
//      sentinels) to the dashboard's `PublicTier` (formatted price strings,
//      CTA hrefs, presentation-only fields).
//   3. On any failure — env unset, network error, malformed response,
//      missing tiers — fall back to the hardcoded `PRICING_TIERS` so the
//      marketing page never fails to render.
//
// The `source` discriminator on the return shape lets the page render an
// operator-visible footer so silent drift between the API and fallback
// becomes a one-glance diagnostic instead of a production-only mystery.

import 'server-only';

import {
  FEATURE_ROWS as FALLBACK_FEATURE_ROWS,
  PRICING_TIERS as FALLBACK_PRICING_TIERS,
  SALES_EMAIL,
  type FeatureRow,
  type PublicTier,
  type PublicTierId,
} from './pricing';

export type PricingSource = 'api' | 'fallback';

export interface ResolvedPricing {
  source: PricingSource;
  /** Reason for falling back; populated only when `source === 'fallback'`. */
  reason?: string;
  tiers: readonly PublicTier[];
  rows: readonly FeatureRow[];
  /** ISO-8601 timestamp from the API; null when fallback. */
  generatedAt: string | null;
  /** Spec version from the API; null when fallback. */
  specVersion: string | null;
}

interface ApiTier {
  tier: string;
  display_name: string;
  monthly_price_cents: number | null;
  monthly_verify_quota: number | null;
  lifetime_verify_quota: number | null;
  overage_per_call_e4: number | null;
  agent_cap: number | null;
  audit_retention_days: number;
  bate_access: boolean;
  webhooks: boolean;
  verify_p99_target_ms: number;
}

interface ApiPricing {
  spec_version: string;
  generated_at: string;
  currency: string;
  tiers: Record<string, ApiTier>;
}

const PRESENTATION_TIER_ORDER: PublicTierId[] = [
  'FREE',
  'DEVELOPER',
  'TEAM',
  'SCALE',
  'ENTERPRISE',
];

// API uses canonical PlanTier enum (FREE/DEVELOPER/GROWTH/ENTERPRISE).
// Marketing exposes ADR-0014 display tiers (FREE/DEVELOPER/TEAM/SCALE/ENTERPRISE).
// TEAM is GROWTH renamed; SCALE has no server-side enum yet (Round 18 migration).
function apiKeyForDisplay(id: PublicTierId): string {
  if (id === 'TEAM') return 'GROWTH';
  return id;
}

const NUM = new Intl.NumberFormat('en-US');

function formatPrice(cents: number | null): string {
  if (cents === null) return 'Custom';
  if (cents === 0) return '$0';
  const dollars = cents / 100;
  return `$${NUM.format(dollars)} / mo`;
}

// Match the fallback's abbreviated style ("10K lifetime", "50K / mo", "5M / mo").
// Drop trailing .0 so 50,000 → "50K" not "50.0K".
function abbreviateCount(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1).replace(/\.0$/, '')}K`;
  }
  return NUM.format(n);
}

function formatVerifies(monthly: number | null, lifetime: number | null): string {
  if (lifetime !== null) return `${abbreviateCount(lifetime)} lifetime`;
  if (monthly === null) return 'Custom';
  return `${abbreviateCount(monthly)} / mo`;
}

function formatOverage(e4: number | null): string {
  if (e4 === null) return '—';
  // E4 = ten-thousandths of a dollar. e4=8 => $0.0008
  const dollars = e4 / 10_000;
  return `$${dollars.toFixed(4)} ea`;
}

function formatAgents(cap: number | null): string {
  if (cap === null) return 'Unlimited';
  return NUM.format(cap);
}

function formatRetention(days: number): string {
  if (days >= 365 * 7) return '7 years';
  if (days >= 365) return `${Math.round(days / 365)} year${days >= 730 ? 's' : ''}`;
  return `${days} days`;
}

function formatSla(p99: number): string {
  if (p99 <= 0) return 'Custom';
  if (p99 >= 10_000) return 'Best effort';
  return `p99 < ${p99}ms`;
}

function ctaForTier(id: PublicTierId): { label: string; href: string } {
  if (id === 'FREE') {
    return { label: 'Sign up', href: '/login?redirect=/agents&intent=signup' };
  }
  if (id === 'ENTERPRISE') {
    return {
      label: 'Contact us',
      href: `mailto:${SALES_EMAIL}?subject=CERNIQ%20Enterprise%20inquiry`,
    };
  }
  // BILLING_LADDER_ENABLED gate (LAUNCH.md Path C). When the ladder is
  // dark at launch, paid-tier CTAs route to a waitlist signal instead of
  // a checkout that the API would 503. The mailto carries the tier id in
  // the subject so the operator can prioritise outreach.
  if (process.env.NEXT_PUBLIC_BILLING_LADDER_ENABLED !== 'true') {
    return {
      label: 'Join waitlist',
      href: `mailto:${SALES_EMAIL}?subject=CERNIQ%20${encodeURIComponent(id)}%20waitlist`,
    };
  }
  return {
    label: 'Get started',
    href: `/login?redirect=/billing&intent=checkout&tier=${id}`,
  };
}

function mapApiToPublicTier(id: PublicTierId, t: ApiTier): PublicTier {
  const cta = ctaForTier(id);
  return {
    id,
    displayName: id === 'TEAM' ? 'Team' : id === 'SCALE' ? 'Scale' : t.display_name,
    price: id === 'SCALE' ? '$1,499 / mo' : formatPrice(t.monthly_price_cents),
    verifies:
      id === 'SCALE' ? '5M / mo' : formatVerifies(t.monthly_verify_quota, t.lifetime_verify_quota),
    // ENTERPRISE overage is "Negotiated" copy — the API returns null for
    // hard-stop tiers, but FREE shows "—" while ENTERPRISE shows "Negotiated".
    overage: id === 'ENTERPRISE' ? 'Negotiated' : formatOverage(t.overage_per_call_e4),
    agents: id === 'SCALE' ? '1,000' : formatAgents(t.agent_cap),
    retention: formatRetention(t.audit_retention_days),
    bate: t.bate_access,
    webhooks: t.webhooks,
    // FREE has an internal p99 target (250ms) but the marketing label is
    // "Best effort" — we never promise a free-tier SLA. SCALE uses the
    // hardcoded placeholder until the Round-18 enum migration ships.
    sla:
      id === 'FREE'
        ? 'Best effort'
        : id === 'ENTERPRISE'
          ? 'Custom'
          : id === 'SCALE'
            ? 'p99 < 80ms'
            : formatSla(t.verify_p99_target_ms),
    ctaLabel: cta.label,
    ctaHref: cta.href,
  };
}

function buildFeatureRows(tiers: readonly PublicTier[]): FeatureRow[] {
  return [
    { label: 'Price', cells: tiers.map((t) => t.price) },
    { label: 'Verifies', cells: tiers.map((t) => t.verifies) },
    { label: 'Overage', cells: tiers.map((t) => t.overage) },
    { label: 'Agents', cells: tiers.map((t) => t.agents) },
    { label: 'Audit retention', cells: tiers.map((t) => t.retention) },
    { label: 'BATE trust scores', cells: tiers.map((t) => t.bate) },
    { label: 'Webhooks', cells: tiers.map((t) => t.webhooks) },
    { label: 'SLA', cells: tiers.map((t) => t.sla) },
  ];
}

function fallback(reason: string): ResolvedPricing {
  return {
    source: 'fallback',
    reason,
    tiers: FALLBACK_PRICING_TIERS,
    rows: FALLBACK_FEATURE_ROWS,
    generatedAt: null,
    specVersion: null,
  };
}

export async function resolvePricing(): Promise<ResolvedPricing> {
  const base = process.env.CERNIQ_API_BASE_URL;
  if (!base || base.length === 0) {
    return fallback('CERNIQ_API_BASE_URL unset');
  }
  const url = `${base.replace(/\/$/, '')}/.well-known/pricing.json`;

  let res: Response;
  try {
    res = await fetch(url, {
      // Match the API's Cache-Control: public, max-age=3600.
      next: { revalidate: 3600 },
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    return fallback(`fetch failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    return fallback(`HTTP ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return fallback(`malformed JSON: ${(err as Error).message}`);
  }

  if (typeof body !== 'object' || body === null) {
    return fallback('non-object body');
  }
  const api = body as Partial<ApiPricing>;
  if (typeof api.tiers !== 'object' || api.tiers === null) {
    return fallback('missing tiers');
  }

  const tiers: PublicTier[] = [];
  for (const id of PRESENTATION_TIER_ORDER) {
    const apiKey = apiKeyForDisplay(id);
    const t = api.tiers[apiKey];
    if (!t) {
      // SCALE has no server-side enum yet — fall back to the hardcoded
      // SCALE row (presentational placeholder) instead of failing the page.
      const placeholder = FALLBACK_PRICING_TIERS.find((p) => p.id === id);
      if (placeholder) {
        tiers.push(placeholder);
        continue;
      }
      return fallback(`API missing tier ${apiKey} (display ${id})`);
    }
    tiers.push(mapApiToPublicTier(id, t));
  }

  return {
    source: 'api',
    tiers: Object.freeze(tiers),
    rows: Object.freeze(buildFeatureRows(tiers)),
    generatedAt: api.generated_at ?? null,
    specVersion: api.spec_version ?? null,
  };
}
