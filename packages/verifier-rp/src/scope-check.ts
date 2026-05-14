// Pure scope/spend check helpers. Take a normalized claims object and the
// relying-party-supplied request context, return either `null` (passes) or a
// denial reason.

import type { NormalizedPolicyClaims } from './policy-claims.js';
import type { DenialReason, VerifyContext } from './types.js';

export interface ScopeCheckResult {
  reason: DenialReason;
  detail: string;
}

/**
 * Domain match: case-insensitive, exact host or "*.example.com" wildcard for
 * any subdomain.
 */
function domainMatches(allowed: string, requested: string): boolean {
  const a = allowed.trim().toLowerCase();
  const r = requested.trim().toLowerCase();
  if (a === r) return true;
  if (a.startsWith('*.')) {
    const suffix = a.slice(1); // ".example.com"
    return r.endsWith(suffix) && r.length > suffix.length;
  }
  return false;
}

export function checkScopeAndSpend(
  claims: NormalizedPolicyClaims,
  ctx: VerifyContext,
  requiredScope?: string,
): ScopeCheckResult | null {
  // Required scope category — drives middleware-level coarse access control.
  if (requiredScope !== undefined && claims.scopes.length > 0 && !claims.scopes.includes(requiredScope)) {
    return {
      reason: 'SCOPE_NOT_GRANTED',
      detail: `required scope "${requiredScope}" not in token scopes [${claims.scopes.join(', ')}]`,
    };
  }

  // Action match — if the relying party tells us what action is being
  // performed, the token's `act` claim must match exactly.
  if (ctx.action !== undefined && claims.action !== ctx.action) {
    return {
      reason: 'SCOPE_NOT_GRANTED',
      detail: `token action "${claims.action}" does not match request action "${ctx.action}"`,
    };
  }

  // Domain allowlist — if the token carries `ad`, the requested merchant
  // domain (if any) must be in the list.
  if (ctx.merchantDomain && claims.allowedDomains.length > 0) {
    const merchantDomain = ctx.merchantDomain;
    const ok = claims.allowedDomains.some((d) => domainMatches(d, merchantDomain));
    if (!ok) {
      return {
        reason: 'SCOPE_NOT_GRANTED',
        detail: `merchant domain "${ctx.merchantDomain}" not in allowedDomains`,
      };
    }
  }

  // Spend-limit echo — the token already encodes a per-tx amount limit at
  // issue time via `amt`. A relying party-supplied amount that exceeds it is
  // refused locally; we don't need to round-trip AEGIS. (Per-day/per-month
  // ledgering still requires AEGIS-side enforcement; we don't fabricate it.)
  if (ctx.amount !== undefined && claims.amount !== undefined) {
    if (ctx.amount > claims.amount) {
      return {
        reason: 'SPEND_LIMIT_EXCEEDED',
        detail: `request amount ${String(ctx.amount)} exceeds token amount ${String(claims.amount)}`,
      };
    }
  }

  // Currency mismatch is a scope failure — agents authorized for USD cannot
  // be silently used for EUR purchases.
  if (ctx.currency && claims.currency && ctx.currency !== claims.currency) {
    return {
      reason: 'SCOPE_NOT_GRANTED',
      detail: `request currency "${ctx.currency}" does not match token currency "${claims.currency}"`,
    };
  }

  return null;
}
