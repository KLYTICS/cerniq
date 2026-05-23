// Dashboard auth proxy — Auth0 session check (ADR-0009).
//
// (Renamed from middleware.ts to proxy.ts for the Next.js 16 file convention.
// Behavior identical; Next emits a deprecation warning if the "middleware"
// name is used. Both names route the same request-interception API.)
//
// Until @auth0/nextjs-auth0 v4 is wired in (it ships its own middleware),
// this is a guard that redirects unauthenticated users to /login. The
// real session is established in `app/api/auth/[...auth0]/route.ts`
// via the v4 SDK once installed (deferred to M-020-pkg-install).

import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = new Set<string>([
  '/',
  '/login',
  '/api/auth/login',
  '/api/auth/callback',
  '/api/auth/logout',
]);

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Once @auth0/nextjs-auth0 is installed:
  //   const session = await getSession(req);
  //   if (!session?.user) return NextResponse.redirect(new URL('/login', req.url));
  // For now we permit all requests in dev so local development works
  // without an Auth0 tenant. Production deployment MUST set
  // AUTH0_REQUIRED=true to switch to redirect-on-no-session.
  if (process.env.AUTH0_REQUIRED === 'true') {
    const sessionCookie = req.cookies.get('appSession');
    if (!sessionCookie) {
      // Round 22: preserve the original URL so the post-auth redirect can
      // resume the user's intent (e.g. the pricing→billing checkout funnel).
      const loginUrl = new URL('/login', req.url);
      const original = pathname + (req.nextUrl.search || '');
      if (original !== '/login') {
        loginUrl.searchParams.set('redirect', original);
      }
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on every page except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
