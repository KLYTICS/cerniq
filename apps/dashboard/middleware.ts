// Next.js middleware — Auth0 route mount + protected-path gate.
//
// Two responsibilities:
//
// 1. Mount the Auth0 v4 SDK routes (/api/auth/login, /callback, /logout,
//    etc.) by delegating to `auth0.middleware(req)`. The SDK handles
//    every request to its mounted paths and returns a NextResponse;
//    other requests fall through.
//
// 2. Gate the dashboard's protected pages (/agents, /policies, /audit,
//    /webhooks, /billing) when AUTH0_REQUIRED=true. Unauthenticated
//    users are redirected to /login with the originating path preserved
//    via the safe-redirect contract.
//
// When Auth0 is NOT configured (dev mode, AUTH0_REQUIRED=false), this
// middleware is a no-op pass-through — the dashboard continues to read
// CERNIQ_DASHBOARD_API_KEY from env per the existing lib/auth.ts.

import { NextRequest, NextResponse } from 'next/server';

import { getAuth0, isAuth0Configured } from './lib/auth0';

// Routes the user must be authenticated to view. Everything else is
// public (login page, marketing, /api/auth/* itself, static assets).
const PROTECTED_PREFIXES = ['/agents', '/policies', '/audit', '/webhooks', '/billing'];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Pass-through mode when Auth0 is intentionally not wired (dev / staging
  // with operator-pinned key). The dashboard still works via env-key.
  if (!isAuth0Configured()) {
    return NextResponse.next();
  }

  const auth0 = getAuth0();

  // Let the SDK handle its own mounted routes first. It returns a
  // NextResponse for matched paths; non-auth requests come back with
  // status 200 and the original headers — we can fall through.
  const authResponse = await auth0.middleware(req);

  // The Auth0 SDK returns NextResponse.next() for non-auth routes; we
  // detect the auth-route case by checking whether the response has a
  // location header (redirect) or is not a plain pass-through.
  const isAuthRouteHit = pathname.startsWith('/api/auth/');
  if (isAuthRouteHit) {
    return authResponse;
  }

  // Gate protected routes. The SDK's getSession() reads from the
  // signed cookie set during /api/auth/callback.
  if (isProtected(pathname)) {
    const session = await auth0.getSession(req);
    if (!session) {
      // Redirect to /login with the originating path preserved so the
      // conversion funnel from public pages (pricing → /login →
      // /billing) survives the auth round-trip. Matches Round 22's
      // safe-redirect contract.
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('redirect', pathname + (req.nextUrl.search || ''));
      return NextResponse.redirect(loginUrl);
    }
  }

  return authResponse;
}

// Next.js middleware config — match every path EXCEPT static assets and
// Next internals. The SDK + protected-path logic above does the routing
// decisions; this just keeps middleware off the .next/static bundle.
export const config = {
  matcher: [
    /*
     * Skip:
     *   - /_next/static (build assets)
     *   - /_next/image  (image optimizer)
     *   - /favicon.ico, /robots.txt, /sitemap.xml (root files)
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
