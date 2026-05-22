'use client';

// Client CTA. The button is client-side only because we want a single
// pointer / keyboard activation site that works for both http(s) and
// mailto: links without surprising rel/target side effects. We also keep
// it client so a future analytics ping can hook in here without forcing
// the parent server component to become client.

import type { ReactElement } from 'react';

interface CTAButtonProps {
  href: string;
  label: string;
  /** When true, renders as primary (filled) — used for paid tiers. */
  primary?: boolean;
}

export function CTAButton({ href, label, primary = false }: CTAButtonProps): ReactElement {
  const className = primary ? 'okoro-button' : 'okoro-button-ghost';
  // Mailto links open the user's mail client; everything else is a same-
  // origin nav.
  return (
    <a className={className} href={href} data-cta-tier-label={label}>
      {label}
    </a>
  );
}
