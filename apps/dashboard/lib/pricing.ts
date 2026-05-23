// Public pricing data — build-time **fallback** for the marketing /pricing
// page when `/.well-known/pricing.json` is unreachable.
//
// Round 23: `lib/pricing-source.ts:resolvePricing()` now SSR-fetches the
// canonical API endpoint on every request (with 1h ISR). When that fetch
// succeeds the dashboard renders API-derived tiers and ignores this file.
// When it fails (env unset, network error, malformed response, missing
// tiers) we fall back to PRICING_TIERS below so the marketing page never
// 500s on a backend dependency.
//
// MUST stay in lock-step with `apps/api/src/modules/billing/plans.ts` per
// ADR-0014. The cross-package parity test
// (`tests/cross-package/dashboard-pricing-parity.spec.ts`) guards drift.
//
// Presentation-only fields (`ctaHref`, formatted `price`, the SCALE
// placeholder until the Round-18 PlanTier enum migration) live here and
// only here — the API endpoint deliberately keeps its surface minimal.

export type PublicTierId = 'FREE' | 'DEVELOPER' | 'TEAM' | 'SCALE' | 'ENTERPRISE';

export interface PublicTier {
  /** Stable id used in CTA query strings (`?tier=DEVELOPER`). */
  id: PublicTierId;
  /** Human-readable display name (matches `PlanDefinition.displayName`). */
  displayName: string;
  /** Price label shown in the price row. */
  price: string;
  /** Verifies row label. */
  verifies: string;
  /** Overage row label. Em dash for tiers without metered overage. */
  overage: string;
  /** Agents row label. */
  agents: string;
  /** Audit retention row label. */
  retention: string;
  /** Whether BATE trust scores are exposed. */
  bate: boolean;
  /** Whether webhook subscriptions are available. */
  webhooks: boolean;
  /** SLA target row label. */
  sla: string;
  /** CTA copy. */
  ctaLabel: string;
  /**
   * CTA href. Public-page constraint: paid tiers cannot call
   * `/v1/billing/checkout` directly without auth, so they bounce through
   * `/login?redirect=/billing&intent=checkout&tier=<id>`. The login flow
   * brings the authenticated user back to /billing where checkout fires.
   * Enterprise opens a mailto. Free trial routes to signup.
   */
  ctaHref: string;
}

/** Email used for Enterprise "Contact us" mailto. */
export const SALES_EMAIL = 'sales@okoroapp.com';

export const PRICING_TIERS: readonly PublicTier[] = Object.freeze([
  {
    id: 'FREE',
    displayName: 'Free trial',
    price: '$0',
    verifies: '10K lifetime',
    overage: '—',
    agents: '2',
    retention: '30 days',
    bate: false,
    webhooks: false,
    sla: 'Best effort',
    ctaLabel: 'Sign up',
    ctaHref: '/login?redirect=/agents&intent=signup',
  },
  {
    id: 'DEVELOPER',
    displayName: 'Developer',
    price: '$49 / mo',
    verifies: '50K / mo',
    overage: '$0.0008 ea',
    agents: '10',
    retention: '90 days',
    bate: true,
    webhooks: true,
    sla: 'p99 < 200ms',
    ctaLabel: 'Get started',
    ctaHref: '/login?redirect=/billing&intent=checkout&tier=DEVELOPER',
  },
  {
    id: 'TEAM',
    displayName: 'Team',
    price: '$299 / mo',
    verifies: '500K / mo',
    overage: '$0.0008 ea',
    agents: '100',
    retention: '365 days',
    bate: true,
    webhooks: true,
    sla: 'p99 < 120ms',
    ctaLabel: 'Get started',
    // tier=TEAM maps to PlanTier.GROWTH server-side (ADR-0014 rebrand;
    // Prisma enum migration to add SCALE / rename GROWTH lands in Round 18).
    ctaHref: '/login?redirect=/billing&intent=checkout&tier=TEAM',
  },
  {
    id: 'SCALE',
    displayName: 'Scale',
    price: '$1,499 / mo',
    verifies: '5M / mo',
    overage: '$0.0008 ea',
    agents: '1,000',
    retention: '365 days',
    bate: true,
    webhooks: true,
    sla: 'p99 < 80ms',
    ctaLabel: 'Get started',
    // PENDING server-side: SCALE PlanTier enum value lands in Round 18.
    // The dashboard exposes the CTA now so prospects can express intent;
    // /billing should treat unknown tiers as a contact-sales fallback
    // until the migration ships.
    ctaHref: '/login?redirect=/billing&intent=checkout&tier=SCALE',
  },
  {
    id: 'ENTERPRISE',
    displayName: 'Enterprise',
    price: 'Custom',
    verifies: 'Custom',
    overage: 'Negotiated',
    agents: 'Unlimited',
    retention: '7 years',
    bate: true,
    webhooks: true,
    sla: 'Custom',
    ctaLabel: 'Contact us',
    ctaHref: `mailto:${SALES_EMAIL}?subject=OKORO%20Enterprise%20inquiry`,
  },
]);

export interface FeatureRow {
  /** Row label shown in the leftmost column. */
  label: string;
  /** Cell renderer per tier — string for value rows, boolean for ✓/— rows. */
  cells: readonly (string | boolean)[];
}

/**
 * The 8 feature-matrix rows in display order. Cell index aligns with
 * `PRICING_TIERS` index (FREE, DEVELOPER, TEAM, SCALE, ENTERPRISE).
 */
export const FEATURE_ROWS: readonly FeatureRow[] = Object.freeze([
  { label: 'Price', cells: PRICING_TIERS.map((t) => t.price) },
  { label: 'Verifies', cells: PRICING_TIERS.map((t) => t.verifies) },
  { label: 'Overage', cells: PRICING_TIERS.map((t) => t.overage) },
  { label: 'Agents', cells: PRICING_TIERS.map((t) => t.agents) },
  { label: 'Audit retention', cells: PRICING_TIERS.map((t) => t.retention) },
  { label: 'BATE trust scores', cells: PRICING_TIERS.map((t) => t.bate) },
  { label: 'Webhooks', cells: PRICING_TIERS.map((t) => t.webhooks) },
  { label: 'SLA', cells: PRICING_TIERS.map((t) => t.sla) },
]);
