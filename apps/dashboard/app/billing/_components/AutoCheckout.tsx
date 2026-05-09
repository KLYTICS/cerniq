'use client';

// AutoCheckout — closes the conversion funnel from the public pricing page.
//
// When the user lands on /billing?intent=checkout&tier=DEVELOPER (the redirect
// target from the pricing page CTA after login), this client component fires
// the existing `startCheckout` Server Action exactly once on mount and routes
// the browser to Stripe's hosted checkout URL. Cancelled or failed attempts
// surface a small notice and let the user try again from the manual
// UpgradeButton — no infinite redirect loop.
//
// Why a client component: server components can't trigger window.location
// assignment. Why useEffect-once instead of an immediate redirect in the
// server-side page: server-side `redirect()` to a Stripe URL would short-
// circuit the rest of the billing page render, denying a fallback path if
// Stripe is down. The client-side trigger lets the page render normally and
// progressively-enhances into the auto-redirect.

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { startCheckout } from '../components/actions';

type State =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'failed'; message: string };

// AutoCheckout accepts the union we actually advertise on the pricing page.
// startCheckout currently only wires DEVELOPER/GROWTH — TEAM/SCALE are
// pricing-page nomenclature that map to the existing PlanTier enum until
// Round 18 schema migration lands the SCALE value. Map at the boundary.
type PricingTier = 'DEVELOPER' | 'GROWTH' | 'TEAM' | 'SCALE';
type CheckoutTier = 'DEVELOPER' | 'GROWTH';

function mapToCheckoutTier(t: PricingTier): CheckoutTier {
  // TEAM is the ADR-0014 display name for GROWTH (same Prisma enum).
  // SCALE doesn't exist server-side yet — fall back to GROWTH so the user
  // sees something working; the dashboard pricing page Round-21 followup
  // will surface "SCALE coming soon" once the enum migration lands.
  if (t === 'TEAM' || t === 'SCALE') return 'GROWTH';
  return t;
}

export function AutoCheckout({ tier }: { tier: PricingTier }): ReactElement | null {
  const [state, setState] = useState<State>({ kind: 'starting' });
  // Strict-mode double-mount guard. Without this, dev mode fires startCheckout
  // twice, wasting a Stripe Checkout session id on the floor.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const result = await startCheckout(mapToCheckoutTier(tier));
        if (cancelled) return;
        if (result.url) {
          // Strip the intent query before leaving so the back button doesn't
          // re-trigger checkout.
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/billing');
            window.location.href = result.url;
          }
        } else {
          setState({
            kind: 'failed',
            message: result.error ?? 'Checkout failed; try again from the Upgrade button.',
          });
        }
      } catch (err) {
        if (cancelled) return;
        setState({ kind: 'failed', message: (err as Error).message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  if (state.kind === 'starting') {
    return (
      <div role="status" className="data-empty muted" aria-live="polite">
        Starting Stripe checkout for the <strong>{tier}</strong> tier&hellip;
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <div role="alert" className="data-empty error">
        <strong>Checkout could not start.</strong> {state.message}
      </div>
    );
  }
  return null;
}
