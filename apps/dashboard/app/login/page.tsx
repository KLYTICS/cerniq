// Login landing page. The actual auth flow uses Auth0's Universal Login;
// this page is the local landing the user sees if they hit a protected
// page without a session and `AUTH0_REQUIRED=true`.
//
// Round 22: preserve the `?redirect=...` searchParam through to Auth0 as
// `returnTo`, so the conversion funnel from the public pricing page
// (pricing → /login?redirect=/billing&intent=checkout&tier=DEVELOPER →
// Auth0 → /billing) survives the auth round-trip and Round 21's
// AutoCheckout component can fire.

import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { buildLoginHref, safeRedirect } from '../../lib/safe-redirect';

export const metadata: Metadata = {
  title: 'Sign in · OKORO',
};

interface LoginSearchParams { redirect?: string | string[] }

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<LoginSearchParams> | LoginSearchParams;
}): Promise<ReactElement> {
  const sp = searchParams instanceof Promise ? await searchParams : searchParams;
  const redirectRaw = sp?.redirect;
  const loginHref = buildLoginHref(redirectRaw);
  const validatedRedirect = safeRedirect(redirectRaw);
  const showRedirectNotice = validatedRedirect !== '/';

  return (
    <section className="okoro-page">
      <header className="okoro-page-header">
        <h1>Sign in</h1>
        <p className="muted">
          OKORO uses Auth0 for human identity (ADR-0009). Click through to your
          organization&apos;s tenant.
        </p>
      </header>
      {showRedirectNotice ? (
        <p className="muted" data-testid="login-return-notice">
          You&apos;ll be returned to <code>{validatedRedirect}</code> after sign-in.
        </p>
      ) : null}
      <p>
        <a className="okoro-button" href={loginHref}>
          Continue with Auth0 →
        </a>
      </p>
      <p className="muted">
        First time here? Your administrator must invite your email to the
        Auth0 organization mapped to your OKORO principal.
      </p>
    </section>
  );
}
