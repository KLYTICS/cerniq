// TrialCliffBanner — Round 24. Warns the operator before either of the
// two AEGIS trial cliffs converts to a hard `TRIAL_EXHAUSTED` denial:
//
//   1. **Counter cliff** (FREE tier): `trialUsedCount / trialCap` is at
//      or above `TRIAL_WARN_THRESHOLD_PERCENT` (default 80%). Drives the
//      PLG funnel from "exploring" → "convert" before the cap actually
//      fires.
//
//   2. **Stripe-trial cliff** (paid tier with a Stripe-side trial):
//      `stripeTrialEndsAt` is within `TRIAL_WARN_THRESHOLD_DAYS` (default
//      7). Stripe itself only emits `customer.subscription.trial_will_end`
//      3 days before the deadline; pre-warning earlier gives the operator
//      time to update card details without urgency.
//
// Reads both thresholds from `@aegis/types` so the API + dashboard never
// disagree on when the banner should appear. The cross-package parity
// test asserts the import.
//
// Renders nothing when neither cliff applies — the calling page can safely
// invoke this on every render.

import type { ReactElement } from 'react';
import {
  TRIAL_WARN_THRESHOLD_DAYS,
  TRIAL_WARN_THRESHOLD_PERCENT,
} from '@aegis/types';

import type { PlanSummary } from '../../../lib/api-client';

interface Props {
  plan: PlanSummary;
  /**
   * When true, render a compact strip suitable for sitting above a data
   * table (used on /agents). The /billing variant is the default — wider
   * with a CTA-style action panel.
   */
  compact?: boolean;
}

type CliffState =
  | { kind: 'counter'; usedPct: number; remaining: number }
  | { kind: 'stripe'; daysRemaining: number; endsAt: string }
  | null;

function evaluate(plan: PlanSummary, now: Date): CliffState {
  // Counter cliff — FREE tier only, requires non-null cap.
  if (
    plan.planTier === 'FREE' &&
    typeof plan.trialUsedCount === 'number' &&
    typeof plan.trialCap === 'number' &&
    plan.trialCap > 0 &&
    !plan.trialExhaustedAt
  ) {
    const pct = (plan.trialUsedCount / plan.trialCap) * 100;
    if (pct >= TRIAL_WARN_THRESHOLD_PERCENT) {
      return {
        kind: 'counter',
        usedPct: pct,
        remaining: Math.max(0, plan.trialCap - plan.trialUsedCount),
      };
    }
  }

  // Stripe-trial cliff — any tier with a Stripe trial deadline in the future
  // but inside the warn window. Past deadlines collapse to no-banner (the
  // subscription has already transitioned via the standard webhooks).
  if (plan.stripeTrialEndsAt) {
    const endsAt = new Date(plan.stripeTrialEndsAt);
    if (!Number.isNaN(endsAt.getTime())) {
      const msRemaining = endsAt.getTime() - now.getTime();
      if (msRemaining > 0) {
        const daysRemaining = Math.ceil(msRemaining / 86_400_000);
        if (daysRemaining <= TRIAL_WARN_THRESHOLD_DAYS) {
          return {
            kind: 'stripe',
            daysRemaining,
            endsAt: plan.stripeTrialEndsAt,
          };
        }
      }
    }
  }

  return null;
}

const NUM = new Intl.NumberFormat('en-US');

export function TrialCliffBanner({ plan, compact = false }: Props): ReactElement | null {
  const state = evaluate(plan, new Date());
  if (!state) return null;

  const isCounter = state.kind === 'counter';
  const headline = isCounter ? 'Trial nearing limit' : 'Trial ending soon';
  const detail =
    state.kind === 'counter'
      ? `${NUM.format(state.remaining)} verifies remaining (${state.usedPct.toFixed(1)}% used). Upgrade to keep verifying without interruption.`
      : `Your trial ends in ${state.daysRemaining} day${state.daysRemaining === 1 ? '' : 's'} (${state.endsAt.split('T')[0]}). Confirm a payment method to continue without interruption.`;

  // Amber palette — distinct from PastDueBanner red so operators can
  // distinguish "act now" (red) from "act soon" (amber) at a glance.
  const border = '#5a4a22';
  const bg = '#1a160d';
  const fg = '#ffd58a';

  return (
    <div
      role="status"
      aria-label={headline}
      data-trial-cliff={state.kind}
      style={{
        border: `1px solid ${border}`,
        background: bg,
        color: fg,
        padding: compact ? '8px 12px' : '10px 14px',
        marginBottom: compact ? 12 : 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        fontSize: compact ? 12 : 13,
      }}
    >
      <span>
        <strong style={{ marginRight: 8 }}>{headline}</strong>
        {detail}
      </span>
      {!compact && (
        <a
          href="/billing"
          aria-label="Open billing to upgrade or confirm payment"
          style={{
            border: `1px solid ${fg}`,
            color: fg,
            padding: '4px 10px',
            textDecoration: 'none',
            fontSize: 12,
            whiteSpace: 'nowrap',
          }}
        >
          {isCounter ? 'Upgrade ▶' : 'Confirm payment ▶'}
        </a>
      )}
    </div>
  );
}
