// IdpAdapter — the contract committed in ADR-0009.
//
// CERNIQ uses Auth0 by default for human (operator/admin) identity. The
// rest of the codebase NEVER imports Auth0 SDKs directly — it imports
// `IdpAdapter` and gets whatever IdP the operator has configured.
//
// Adapters shipped:
//   - Auth0Adapter    (this module, default)
//   - ClerkAdapter    (deferred, ADR-9-A)
//   - WorkOsAdapter   (deferred, ADR-9-B)
//   - KeycloakAdapter (deferred, ADR-9-S, sovereign deployments)
//
// All adapters implement the same surface so swapping is a single DI
// binding change in `auth0.module.ts`.

export type IdpProvider = 'auth0' | 'clerk' | 'workos' | 'keycloak';

export interface IdpUser {
  /** IdP-side stable user id (Auth0: `sub`). Never used as principal id directly. */
  idpUserId: string;
  /** IdP-side organization id. Maps 1:1 to CERNIQ Principal. */
  idpOrganizationId: string;
  /** Tenant domain — used for routing, branding. */
  idpDomain: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  /** CERNIQ roles parsed from custom claims. Empty array if none assigned. */
  roles: string[];
  /** MFA satisfied at this login? Auth0: from `acr` / `amr` claims. */
  mfaSatisfied: boolean;
  /** Raw IdP claims for audit. Subject to redaction policy in ADR-0006. */
  rawClaims: Record<string, unknown>;
}

export interface IdpAdapter {
  readonly provider: IdpProvider;

  /**
   * Verify an access token issued by the IdP. Returns the parsed user on
   * success, null on any failure (signature, expiry, audience, issuer,
   * malformed). Implementations cache JWKS per ADR-0009 §3.
   */
  verifyAccessToken(token: string): Promise<IdpUser | null>;

  /**
   * Upsert the CERNIQ Principal for an IdP organization. Called from the
   * Auth0 Action `cerniq-audit-login.js` and from any first-time login.
   * Returns `{ principalId, created }`.
   *
   * `email` is required on first creation because `Principal.email` is a
   * non-null unique column. On lookup-only (existing principal), `email`
   * is unused.
   */
  ensurePrincipalForOrg(args: {
    idpOrganizationId: string;
    idpDomain: string;
    email: string;
    name?: string | null;
  }): Promise<{ principalId: string; created: boolean }>;
}
