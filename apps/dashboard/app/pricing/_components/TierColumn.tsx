// Per-tier column header. Server component — no interactivity.
//
// Renders the tier name, price, and CTA in a tight stack. The feature
// matrix below renders the per-row values; we deliberately do NOT
// re-render values inside the column header to keep the table the single
// source of truth for the visible numbers.

import type { ReactElement } from 'react';

import type { PublicTier } from '../../../lib/pricing';
import { CTAButton } from './CTAButton';

interface TierColumnProps {
  tier: PublicTier;
}

export function TierColumn({ tier }: TierColumnProps): ReactElement {
  // Free trial uses ghost; paid tiers use the primary fill so the
  // upgrade path is visually obvious without being shouty.
  const primary = tier.id !== 'FREE';
  return (
    <div className="pricing-tier-head">
      <div className="pricing-tier-name">{tier.displayName}</div>
      <div className="pricing-tier-price">{tier.price}</div>
      <CTAButton href={tier.ctaHref} label={tier.ctaLabel} primary={primary} />
    </div>
  );
}
