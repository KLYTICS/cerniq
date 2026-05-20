// Billing — current plan, usage snapshot, trial countdown, and upgrade /
// manage entry-points. Bloomberg-density layout (MetricStrip + DataRow
// patterns, no card grid).
//
// Reads from `GET /v1/billing/plan` (controller in
// apps/api/src/modules/billing). Upgrade actions POST to
// `/v1/billing/checkout`; manage actions POST to `/v1/billing/portal`.
// Card data never touches AEGIS — see ADR-0011.

import type { ReactElement } from 'react';
import type { Metadata } from 'next';

import { authConfigured } from '../../lib/auth';
import { loadPlan } from '../../lib/billing';
import type { PlanSummary } from '../../lib/api-client';

import { PastDueBanner } from './_components/PastDueBanner';
import { TrialCliffBanner } from './_components/TrialCliffBanner';
import { TrialCountdown } from './_components/TrialCountdown';
import { UpgradeButton } from './_components/UpgradeButton';
import { UsageStrip } from './_components/UsageStrip';
import { ManageButton } from './_components/ManageButton';
import { AutoCheckout } from './_components/AutoCheckout';

export const metadata: Metadata = {
  title: 'Billing · AEGIS',
};

const NUM = new Intl.NumberFormat('en-US');

// Round 21: the pricing page (apps/dashboard/app/pricing) routes paid-tier
// CTAs through `/login?redirect=/billing&intent=checkout&tier=DEVELOPER` so
// new prospects authenticate first. When they land here with `intent=checkout`
// AND a valid tier, auto-trigger Stripe checkout — closing the conversion
// funnel at one click instead of two.
type IntentSearchParams = {
  intent?: string | string[];
  tier?: string | string[];
};

const ALLOWED_CHECKOUT_TIERS = ['DEVELOPER', 'GROWTH', 'TEAM', 'SCALE'] as const;
type AllowedCheckoutTier = (typeof ALLOWED_CHECKOUT_TIERS)[number];

function pickTierIntent(sp: IntentSearchParams | undefined): AllowedCheckoutTier | null {
  if (!sp) return null;
  const intent = Array.isArray(sp.intent) ? sp.intent[0] : sp.intent;
  if (intent !== 'checkout') return null;
  const tierRaw = Array.isArray(sp.tier) ? sp.tier[0] : sp.tier;
  if (typeof tierRaw !== 'string') return null;
  const tier = tierRaw.toUpperCase() as AllowedCheckoutTier;
  return (ALLOWED_CHECKOUT_TIERS as readonly string[]).includes(tier) ? tier : null;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: Promise<IntentSearchParams> | IntentSearchParams;
}): Promise<ReactElement> {
  // Next 16 made `searchParams` async; await is a no-op if a plain object is passed.
  const sp = searchParams instanceof Promise ? await searchParams : searchParams;
  const checkoutTier = pickTierIntent(sp);

  if (!authConfigured()) {
    return (
      <section className="aegis-page">
        <header className="aegis-page-header">
          <h1>Billing</h1>
          <p className="muted">
            Plan tier, monthly verify usage, and Stripe linkage.
          </p>
        </header>
        <div className="data-empty">
          <p>
            Set <code>AEGIS_DASHBOARD_API_KEY</code> to populate this view.
          </p>
        </div>
      </section>
    );
  }

  const outcome = await loadPlan();

  return (
    <section className="aegis-page">
      <header className="aegis-page-header">
        <h1>Billing</h1>
        <p className="muted">
          Plan tier, monthly verify usage, and Stripe linkage. AEGIS stores
          only customer/subscription identifiers — card data never leaves
          Stripe.
        </p>
      </header>

      {checkoutTier ? <AutoCheckout tier={checkoutTier} /> : null}

      {!outcome.ok ? (
        <div className="data-empty error" role="alert">
          <p>
            <strong>{outcome.code}</strong> — {outcome.message}
          </p>
        </div>
      ) : (
        <BillingBody plan={outcome.plan} />
      )}
    </section>
  );
}

function BillingBody({ plan }: { plan: PlanSummary }): ReactElement {
  return (
    <>
      <PastDueBanner plan={plan} />
      <TrialCliffBanner plan={plan} />

      <PlanMetricStrip plan={plan} />

      {plan.planTier === 'FREE' ? (
        <TrialCountdown plan={plan} />
      ) : (
        <UsageStrip plan={plan} />
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginBottom: 24,
        }}
      >
        {plan.planTier === 'FREE' || plan.planTier === 'DEVELOPER' ? (
          <UpgradeButton currentTier={plan.planTier} />
        ) : null}
        {plan.planTier === 'DEVELOPER' || plan.planTier === 'GROWTH' ? (
          <ManageButton />
        ) : null}
      </div>

      <h2>Stripe linkage</h2>
      <dl className="kv">
        <dt>customer id</dt>
        <dd className="break">
          {plan.stripeCustomerId ?? (
            <span className="muted">— (no Stripe customer yet)</span>
          )}
        </dd>
        <dt>subscription id</dt>
        <dd className="break">
          {plan.stripeSubscriptionId ?? <span className="muted">—</span>}
        </dd>
        <dt>status</dt>
        <dd>{plan.subscriptionStatus ?? <span className="muted">—</span>}</dd>
      </dl>
    </>
  );
}

// ── Top metric strip (TIER · STATUS · QUOTA · HARD-STOP) ────────────────

function PlanMetricStrip({ plan }: { plan: PlanSummary }): ReactElement {
  const statusToneClass = statusTone(plan.subscriptionStatus);
  const quotaLabel =
    plan.monthlyQuota === -1 ? 'unlimited' : `${NUM.format(plan.monthlyQuota)}/mo`;
  return (
    <dl
      className="metric-strip"
      style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
      aria-label="Plan summary"
    >
      <div
        className={`metric ${plan.planTier === 'FREE' ? 'metric-muted' : 'metric-ok'}`}
      >
        <dt>tier</dt>
        <dd>{plan.planTier}</dd>
      </div>
      <div className={`metric ${statusToneClass}`}>
        <dt>status</dt>
        <dd>{plan.subscriptionStatus ?? '—'}</dd>
      </div>
      <div className="metric">
        <dt>quota</dt>
        <dd>{quotaLabel}</dd>
      </div>
      <div className={`metric ${plan.hardStop ? 'metric-warn' : 'metric-ok'}`}>
        <dt>hard stop</dt>
        <dd>{plan.hardStop ? 'YES' : 'metered'}</dd>
      </div>
    </dl>
  );
}

function statusTone(status: string | null): string {
  if (!status) return 'metric-muted';
  const s = status.toUpperCase();
  if (s === 'ACTIVE' || s === 'TRIALING') return 'metric-ok';
  if (s === 'PAST_DUE' || s === 'UNPAID') return 'metric-warn';
  if (s === 'CANCELED' || s === 'INCOMPLETE_EXPIRED') return 'metric-crit';
  return 'metric-muted';
}
