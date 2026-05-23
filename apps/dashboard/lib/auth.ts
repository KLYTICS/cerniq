// Dashboard auth helpers.
//
// Phase 1 reads `CERNIQ_DASHBOARD_API_KEY` from env (the dashboard's own
// management key against its own principal). When Auth0 wiring lands
// (M-020), this module switches to reading the per-user session and
// looking up the principal-bound key.
//
// The shape of `getSessionApiKey()` is what the dashboard treats as
// stable — its internals can change without touching every page.

import 'server-only';

export interface DashboardSession {
  email: string;
  principalId: string;
  // When Auth0 lands: subject claim, org id, scopes — all available here.
}

export async function getSession(): Promise<DashboardSession | null> {
  // Auth0 hookup is M-020; until then we synthesize a minimal session from
  // env so the dashboard renders against the dev API.
  const principalId = process.env.CERNIQ_DASHBOARD_PRINCIPAL_ID;
  const email = process.env.CERNIQ_DASHBOARD_EMAIL ?? 'developer@local';
  if (!principalId) return null;
  return { email, principalId };
}

export async function getSessionApiKey(): Promise<string | null> {
  // Auth0 hookup will resolve a per-session key from the principal binding;
  // for now we use a single dashboard-tier management key.
  const fromEnv = process.env.CERNIQ_DASHBOARD_API_KEY;
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

export function authConfigured(): boolean {
  return Boolean(process.env.CERNIQ_DASHBOARD_API_KEY);
}
