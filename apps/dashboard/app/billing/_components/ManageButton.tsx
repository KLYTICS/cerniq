'use client';

// ManageButton — opens the Stripe-hosted Customer Portal for paid tiers.
// On click POSTs to /v1/billing/portal via a Server Action and redirects.
// Degrades gracefully when the portal endpoint isn't yet deployed.

import { useState, useTransition, type ReactElement } from 'react';

import { openPortal } from './portalAction';

interface Props {
  /** Override the default label. Used by PastDueBanner ("Update card ▶"). */
  label?: string;
  /** aria-label override. */
  ariaLabel?: string;
}

export function ManageButton({
  label = 'Manage subscription ▶',
  ariaLabel = 'Manage subscription',
}: Props): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function go(): void {
    setError(null);
    setUnavailable(null);
    const returnUrl = typeof window !== 'undefined' ? window.location.href : '/billing';
    startTransition(async () => {
      const result = await openPortal(returnUrl);
      if ('url' in result) {
        window.location.href = result.url;
        return;
      }
      if ('unavailable' in result) {
        setUnavailable(result.reason);
        return;
      }
      setError(result.error);
    });
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button
        type="button"
        className="cerniq-button"
        aria-label={ariaLabel}
        disabled={pending}
        onClick={go}
      >
        {pending ? 'Opening portal…' : label}
      </button>
      {error ? (
        <span role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>
          {error}
        </span>
      ) : null}
      {unavailable ? (
        <span role="status" className="muted" style={{ fontSize: 12 }}>
          {unavailable}
        </span>
      ) : null}
    </span>
  );
}
