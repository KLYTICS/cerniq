// safe-redirect — validates a `?redirect=` query param so the auth flow can
// forward users back to where they started without opening up an open-redirect
// vector. Round 22 closes the conversion-funnel hole where /login dropped
// the original URL and AutoCheckout (Round 21) never fired for new prospects.
//
// Allow only same-origin path-only redirects:
//   - must start with a single '/'
//   - must NOT start with '//' (protocol-relative — bounces to evil.com)
//   - must NOT start with '/\' (some browsers normalize this to '//')
//   - may carry a query string (intent=checkout&tier=...) so the pricing
//     funnel survives the auth round-trip
//
// Anything else collapses to the default landing.

const DEFAULT_LANDING = '/';

function hasControlOrWhitespace(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeRedirect(raw: string | string[] | undefined): string {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== 'string' || candidate.length === 0) return DEFAULT_LANDING;
  if (candidate.length > 512) return DEFAULT_LANDING;
  if (!candidate.startsWith('/')) return DEFAULT_LANDING;
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return DEFAULT_LANDING;
  if (hasControlOrWhitespace(candidate)) return DEFAULT_LANDING;
  return candidate;
}

// Build the Auth0 login URL with `returnTo` populated. The SDK validates
// returnTo is same-origin; we double-validate here so the contract holds
// even if the SDK middleware is mis-configured.
export function buildLoginHref(redirect: string | string[] | undefined): string {
  const target = safeRedirect(redirect);
  if (target === DEFAULT_LANDING) return '/api/auth/login';
  return `/api/auth/login?returnTo=${encodeURIComponent(target)}`;
}
