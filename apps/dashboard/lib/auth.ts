// Dashboard auth helpers — dual-mode (Auth0 v4 OR operator-pinned).
//
// Mode is selected by `AUTH0_REQUIRED=true` + the AUTH0_* quartet
// (see `lib/auth0.ts:isAuth0Configured`). When Auth0 is configured,
// `getSession()` reads the per-user Auth0 session; the per-principal
// API key is resolved via Auth0 user_metadata.cerniq_api_key (populated
// by the cerniq-audit-login Auth0 Action in `infra/auth0/actions/`).
//
// When Auth0 is NOT configured (dev / operator-pinned mode for v1 launch
// before per-user signups), `getSession()` synthesizes a minimal session
// from CERNIQ_DASHBOARD_PRINCIPAL_ID / CERNIQ_DASHBOARD_API_KEY env vars.
// This is the Path A → Path C bridge: same `getSession()` signature,
// different backing source. Callers (`app/page.tsx`, `app/agents/*`,
// etc.) never need to know which mode is active.

import 'server-only';

import { getAuth0, isAuth0Configured } from './auth0';

export interface DashboardSession {
  email: string;
  principalId: string;
  // Auth0-mode adds the Auth0 sub claim; env-key mode leaves it null.
  auth0Sub?: string;
}

export async function getSession(): Promise<DashboardSession | null> {
  if (isAuth0Configured()) {
    const auth0Session = await getAuth0().getSession();
    if (!auth0Session?.user) return null;
    const principalId = readPrincipalFromAuth0(auth0Session.user);
    if (!principalId) return null;
    return {
      email: typeof auth0Session.user.email === 'string' ? auth0Session.user.email : '',
      principalId,
      auth0Sub: typeof auth0Session.user.sub === 'string' ? auth0Session.user.sub : undefined,
    };
  }

  // Operator-pinned fallback (the pre-M-020 behavior).
  const principalId = process.env.CERNIQ_DASHBOARD_PRINCIPAL_ID;
  const email = process.env.CERNIQ_DASHBOARD_EMAIL ?? 'developer@local';
  if (!principalId) return null;
  return { email, principalId };
}

export async function getSessionApiKey(): Promise<string | null> {
  if (isAuth0Configured()) {
    const auth0Session = await getAuth0().getSession();
    if (!auth0Session?.user) return null;
    const apiKey = readApiKeyFromAuth0(auth0Session.user);
    if (apiKey && apiKey.length > 0) return apiKey;
    return null;
  }

  const fromEnv = process.env.CERNIQ_DASHBOARD_API_KEY;
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

// In Auth0-mode the dashboard is "configured" once the SDK is wired AND
// either (a) an env-key fallback is set (dev) OR (b) the current session's
// user has a principal binding. authConfigured() is used by the page-level
// empty-state branches to decide whether to render the "configure me"
// guide vs the real UI. Conservative: returns true when either path is
// viable.
export function authConfigured(): boolean {
  if (isAuth0Configured()) return true;
  return Boolean(process.env.CERNIQ_DASHBOARD_API_KEY);
}

// --- Auth0 user_metadata readers ------------------------------------------------
//
// The Auth0 v4 session shape uses `user` as an indexed record; we read the
// well-known custom claims namespaced under `https://cerniq.io/` so they
// survive Auth0's claim-namespacing in OIDC tokens.

const PRINCIPAL_CLAIM = 'https://cerniq.io/principal_id';
const API_KEY_CLAIM = 'https://cerniq.io/api_key';

function readPrincipalFromAuth0(user: Record<string, unknown>): string | null {
  const claim = user[PRINCIPAL_CLAIM];
  if (typeof claim === 'string' && claim.length > 0) return claim;
  // Fallback: operator env-pinned principal (allows mixed mode in
  // staging where Auth0 is wired but Action hasn't run yet).
  const fallback = process.env.CERNIQ_DASHBOARD_PRINCIPAL_ID;
  return fallback && fallback.length > 0 ? fallback : null;
}

function readApiKeyFromAuth0(user: Record<string, unknown>): string | null {
  const claim = user[API_KEY_CLAIM];
  if (typeof claim === 'string' && claim.length > 0) return claim;
  const fallback = process.env.CERNIQ_DASHBOARD_API_KEY;
  return fallback && fallback.length > 0 ? fallback : null;
}
