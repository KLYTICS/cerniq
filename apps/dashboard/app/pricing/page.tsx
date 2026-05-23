// Public pricing page. No auth required.
//
// Round 23: tier table now SSR-fetched from `/.well-known/pricing.json`
// when `CERNIQ_API_BASE_URL` is set, eliminating the dual-source drift
// risk that Round 21 deferred. Falls back to `lib/pricing.ts` when the
// API is unreachable so the marketing page never fails to render.
//
// CERNIQ sells to engineers; the tier table is the value prop. No
// marketing sermon.

import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { resolvePricing } from '../../lib/pricing-source';

import { FeatureMatrix } from './_components/FeatureMatrix';

export const metadata: Metadata = {
  title: 'Pricing · CERNIQ',
  description:
    'CERNIQ pricing — Free trial, Developer ($49/mo), Team ($299/mo), Scale ($1,499/mo), and Enterprise tiers for agent verification, policy enforcement, and audit.',
};

// Match the API endpoint's Cache-Control: public, max-age=3600. Page is
// statically rendered with ISR; cache layers compose.
export const revalidate = 3600;

export default async function PricingPage(): Promise<ReactElement> {
  const pricing = await resolvePricing();
  return (
    <section className="cerniq-page">
      <header className="cerniq-page-header">
        <h1>Pricing</h1>
        <p className="muted">
          Per ADR-0014. Overage on every paid tier is $0.0008 per verify, billed monthly. Annual
          contracts and self-hosted deployments are available on Enterprise.
        </p>
      </header>
      <FeatureMatrix tiers={pricing.tiers} rows={pricing.rows} />
      <PricingProvenance pricing={pricing} />
    </section>
  );
}

// Operator-visible footer. In production, "from /.well-known/pricing.json"
// is the expected state; "fallback (reason: ...)" is a one-glance signal
// that the API contract isn't wired in this environment.
function PricingProvenance({
  pricing,
}: {
  pricing: Awaited<ReturnType<typeof resolvePricing>>;
}): ReactElement {
  if (pricing.source === 'api') {
    return (
      <p className="muted" data-testid="pricing-provenance" data-source="api">
        Pricing data live from <code>/.well-known/pricing.json</code>
        {pricing.specVersion ? ` · spec ${pricing.specVersion}` : ''}
        {pricing.generatedAt ? ` · generated ${pricing.generatedAt}` : ''}.
      </p>
    );
  }
  return (
    <p className="muted" data-testid="pricing-provenance" data-source="fallback">
      Pricing data from build-time fallback ({pricing.reason ?? 'unknown'}).
    </p>
  );
}
