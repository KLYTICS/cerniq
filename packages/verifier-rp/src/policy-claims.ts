// Helpers for extracting and reasoning about AEGIS policy claims encoded in
// agent JWTs. Pure functions — no I/O — so they're cheap to call on the hot
// path.

import type { AegisJwtClaims, TrustBand } from './types.js';

export interface NormalizedPolicyClaims {
  agentId: string;
  policyId: string;
  jti: string;
  action: string;
  amount?: number;
  currency?: string;
  merchantDomain?: string;
  merchantId?: string;
  principalId: string | null;
  scopes: string[];
  allowedDomains: string[];
  trustBand: TrustBand | null;
  iat: number;
  exp: number;
}

export function normalizeClaims(claims: AegisJwtClaims): NormalizedPolicyClaims {
  return {
    agentId: claims.sub,
    policyId: claims.pid,
    jti: claims.jti,
    action: claims.act,
    amount: claims.amt,
    currency: claims.cur,
    merchantDomain: claims.dom,
    merchantId: claims.mid,
    principalId: claims.iss ?? null,
    scopes: Array.isArray(claims.scopes) ? claims.scopes.slice() : [],
    allowedDomains: Array.isArray(claims.ad) ? claims.ad.slice() : [],
    trustBand: claims.tb ?? null,
    iat: claims.iat,
    exp: claims.exp,
  };
}

/** Remaining lifetime of a token in seconds, given epoch-second exp. */
export function remainingTtlSeconds(exp: number, nowSeconds: number): number {
  return Math.max(0, exp - nowSeconds);
}
