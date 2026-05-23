'use client';

// UpgradeButton — opens a small inline tier picker, then POSTs to
// /v1/billing/checkout (via the existing `startCheckout` Server Action so
// the API key stays server-side per CLAUDE.md invariant 1) and redirects
// the browser to the Stripe-hosted Checkout URL.
//
// Why a Server Action and not a direct `fetch('/v1/billing/checkout')`:
// the dashboard's API key lives in a server env var; a client fetch
// against the CERNIQ API would either need to proxy through a route
// handler or expose the key. The Server Action is the proxy.

import { useState, useTransition, type ReactElement } from 'react';

import { startCheckout } from '../components/actions';

type PaidTier = 'DEVELOPER' | 'GROWTH';

interface Props {
  /** Currently active plan; we hide it from the picker. */
  currentTier: 'FREE' | 'DEVELOPER' | 'GROWTH' | 'ENTERPRISE';
}

const TIER_LABEL: Record<PaidTier, string> = {
  DEVELOPER: 'Developer · $49/mo',
  GROWTH: 'Growth · $299/mo',
};

export function UpgradeButton({ currentTier }: Props): ReactElement {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<PaidTier>(currentTier === 'DEVELOPER' ? 'GROWTH' : 'DEVELOPER');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tiers: PaidTier[] = (['DEVELOPER', 'GROWTH'] as const).filter((t) => t !== currentTier);

  function go(): void {
    setError(null);
    startTransition(async () => {
      const result = await startCheckout(tier);
      if (!result.url) {
        setError(result.error ?? 'Checkout returned no URL.');
        return;
      }
      window.location.href = result.url;
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className="cerniq-button"
        aria-label="Upgrade plan"
        onClick={() => {
          setOpen(true);
        }}
      >
        Upgrade ▶
      </button>
    );
  }

  return (
    <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <label htmlFor="upgrade-tier" className="muted" style={{ fontSize: 12 }}>
        Tier
      </label>
      <select
        id="upgrade-tier"
        aria-label="Select plan tier"
        value={tier}
        onChange={(e) => {
          setTier(e.target.value as PaidTier);
        }}
        disabled={pending}
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          padding: '4px 8px',
          fontFamily: 'var(--mono)',
          fontSize: 12,
        }}
      >
        {tiers.map((t) => (
          <option key={t} value={t}>
            {TIER_LABEL[t]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="cerniq-button"
        aria-label="Continue to Stripe Checkout"
        disabled={pending}
        onClick={go}
      >
        {pending ? 'Opening Stripe…' : 'Continue ▶'}
      </button>
      <button
        type="button"
        className="cerniq-button-ghost"
        aria-label="Cancel upgrade"
        disabled={pending}
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
      >
        Cancel
      </button>
      {error ? (
        <span className="form-error" role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
