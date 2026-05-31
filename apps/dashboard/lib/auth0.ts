// Auth0 v4 client instance.
//
// Single source-of-truth for the dashboard's Auth0 wiring. Imported by
// `middleware.ts` (route mounting + session gate) and by `lib/auth.ts`
// (per-request session resolution). All env-var reads happen here so
// the rest of the dashboard treats Auth0 as a typed dependency.
//
// Route prefix is `/api/auth/*` per `lib/safe-redirect.ts:38-42` — the
// safe-redirect contract (`buildLoginHref`) returns `/api/auth/login`,
// so the SDK's default `/auth/*` prefix is remapped here. Don't change
// these paths without updating safe-redirect at the same time.

import 'server-only';

import { Auth0Client } from '@auth0/nextjs-auth0/server';

// Mark Auth0 as effectively configured only when the minimum production
// set is present. `AUTH0_DOMAIN` + `AUTH0_CLIENT_ID` + `AUTH0_CLIENT_SECRET`
// + `AUTH0_SECRET` are the v4 SDK's required quartet.
//
// `AUTH0_REQUIRED=true` is the operator's intent toggle — set it to
// flip the dashboard from operator-pinned mode to per-user sessions.
// Even with credentials present, AUTH0_REQUIRED=false keeps the
// legacy CERNIQ_DASHBOARD_API_KEY path active for safe-rollout.
export function isAuth0Configured(): boolean {
  return (
    process.env.AUTH0_REQUIRED === 'true' &&
    !!process.env.AUTH0_DOMAIN &&
    !!process.env.AUTH0_CLIENT_ID &&
    !!process.env.AUTH0_CLIENT_SECRET &&
    !!process.env.AUTH0_SECRET
  );
}

// Instantiated lazily so the dashboard can boot in dev without an Auth0
// tenant. Calling getAuth0() when Auth0 is not configured throws — the
// caller is responsible for branching on isAuth0Configured() first.
let _client: Auth0Client | undefined;

export function getAuth0(): Auth0Client {
  if (!isAuth0Configured()) {
    throw new Error(
      'getAuth0() called but Auth0 is not configured. Check isAuth0Configured() first, ' +
        'or set AUTH0_REQUIRED=true and the AUTH0_* env vars.',
    );
  }
  if (!_client) {
    _client = new Auth0Client({
      domain: process.env.AUTH0_DOMAIN!,
      clientId: process.env.AUTH0_CLIENT_ID!,
      clientSecret: process.env.AUTH0_CLIENT_SECRET!,
      appBaseUrl: process.env.AUTH0_BASE_URL ?? 'http://localhost:3000',
      secret: process.env.AUTH0_SECRET!,
      authorizationParameters: {
        audience: process.env.AUTH0_AUDIENCE,
        scope: 'openid profile email offline_access',
      },
      routes: {
        login: '/api/auth/login',
        logout: '/api/auth/logout',
        callback: '/api/auth/callback',
        profile: '/api/auth/me',
        accessToken: '/api/auth/access-token',
        backChannelLogout: '/api/auth/backchannel-logout',
      },
    });
  }
  return _client;
}
