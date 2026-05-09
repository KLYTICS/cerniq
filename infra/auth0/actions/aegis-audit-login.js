/**
 * Auth0 Action — log every successful login as an AEGIS audit event.
 * Hook: post-login (event.transaction.protocol === 'oidc-basic-profile').
 *
 * Configuration (Action secrets):
 *   AEGIS_API_BASE   — e.g. https://api.aegis.dev
 *   AEGIS_ACTION_SECRET — shared secret matching `AUTH0_ACTION_SECRET` on the AEGIS API.
 *
 * The Action runs server-side in Auth0; it has no AEGIS API key — only
 * the shared HMAC secret in the `X-Auth0-Action-Secret` header.
 *
 * Failure mode: Action errors do NOT block login. We log to console
 * (visible in Auth0 dashboard) and let the user through. The dashboard's
 * exchange call (POST /v1/idp/auth0/exchange) re-creates the audit row
 * if this Action's call dropped — idempotent.
 */
exports.onExecutePostLogin = async (event, api) => {
  const base = event.secrets.AEGIS_API_BASE;
  const secret = event.secrets.AEGIS_ACTION_SECRET;
  if (!base || !secret) {
    console.warn('aegis-audit-login: AEGIS_API_BASE or AEGIS_ACTION_SECRET not configured; skipping audit emit.');
    return;
  }

  const orgId =
    event.organization?.id ??
    event.user.app_metadata?.organization_id ??
    'org_default';

  const mfaSatisfied = Array.isArray(event.authentication?.methods)
    ? event.authentication.methods.some((m) => m.name === 'mfa')
    : false;

  const roles = (event.authorization?.roles ?? []).filter(
    (r) => typeof r === 'string' && r.startsWith('aegis:'),
  );

  try {
    const res = await fetch(`${base}/v1/idp/auth0/action`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-auth0-action-secret': secret,
      },
      body: JSON.stringify({
        user_id: event.user.user_id,
        organization_id: orgId,
        email: event.user.email,
        email_verified: event.user.email_verified === true,
        mfa: mfaSatisfied,
        roles,
        occurred_at: new Date().toISOString(),
        ip: event.request?.ip ?? '',
        user_agent: event.request?.user_agent ?? '',
      }),
    });
    if (!res.ok) {
      console.warn(`aegis-audit-login: AEGIS returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`aegis-audit-login: post failed: ${err && err.message ? err.message : err}`);
  }
};
