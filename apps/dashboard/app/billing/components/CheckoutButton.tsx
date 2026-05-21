'use client';

// Checkout button — POSTs to /v1/billing/checkout via a Server Action,
// then redirects the browser to the Stripe-hosted Checkout URL.
//
// Why a client component: the redirect itself is a browser action.
// Server Actions can return the URL but can't initiate `window.location`
// for the user — only a button click handler can do that under modern
// browser pop-up policies.

import { useState, useTransition } from 'react';

import { startCheckout } from './actions';

interface Props {
  planTier: 'DEVELOPER' | 'GROWTH';
  label: string;
}

export function CheckoutButton({ planTier, label }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick(): void {
    setError(null);
    startTransition(async () => {
      const result = await startCheckout(planTier);
      if (!result.url) {
        setError(result.error ?? 'Checkout returned no URL.');
        return;
      }
      window.location.href = result.url;
    });
  }

  return (
    <>
      <button type="button" className="aegis-button" disabled={pending} onClick={onClick}>
        {pending ? 'Opening Stripe…' : label}
      </button>
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
