/**
 * Auth0 Action — deny logins where an `okoro:admin`-roled user tried to
 * skip MFA. Pre-condition for ADR-0009 §4.
 *
 * Implementation note: Auth0's MFA challenge is normally requested via
 * `api.multifactor.enable('any')`. If a user with `okoro:admin` reaches
 * post-login WITHOUT having satisfied MFA, deny.
 */
exports.onExecutePostLogin = async (event, api) => {
  const roles = event.authorization?.roles ?? [];
  if (!roles.includes('okoro:admin')) return;

  const methods = event.authentication?.methods ?? [];
  const hasMfa = methods.some((m) => m.name === 'mfa');
  if (hasMfa) return;

  api.access.deny('okoro_admin_mfa_required');
};
