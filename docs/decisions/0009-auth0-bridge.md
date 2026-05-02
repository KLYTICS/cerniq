# ADR-0009 — Auth0 bridges human identity; AEGIS owns agent identity

**Status**: accepted
**Date**: 2026-05-02
**Deciders**: sid=enterprise-backbone-arch (operator: erwin)
**Supersedes**: none

## Context

AEGIS authenticates agents. It does not authenticate humans. But every
production deployment needs *someone* — a human operator, an SRE, a
compliance officer — to log into the dashboard, manage agents, rotate
keys, audit events.

Building a human-identity stack (passwords, MFA, SSO, SCIM, password
reset, session management, audit-of-admins) is a 6–12 month effort with
its own SOC2 implications. Off-the-shelf is the right call.

We pick **Auth0** as the default human-identity provider for AEGIS for
five reasons:
1. SOC2 Type II / ISO 27001 / HIPAA / GDPR compliance is theirs, not ours.
2. Native enterprise SSO (SAML, OIDC, Azure AD, Okta, Google Workspace).
3. Tenant model maps cleanly: Auth0 Organizations ↔ AEGIS Principals.
4. Auth0 Actions allow runtime hooks — perfect for "every human-issued
   API key gets logged into the AEGIS audit chain."
5. Customers already deploy it; we don't ask them to add a vendor.

What this ADR is *not*: a commitment that Auth0 is the only IdP we'll
ever support. We design the bridge against an `IdpAdapter` interface so
Clerk, Stytch, WorkOS, or a self-hosted Keycloak slots in later.

## Decision

1. **Auth0 is the default IdP for AEGIS dashboard + admin API access.**
   Bootstrap defaults document Auth0; an `aegis bootstrap --idp clerk`
   path remains open.
2. **Auth0 Organization ↔ AEGIS Principal binding.** Every AEGIS
   Principal carries `idpProvider` + `idpOrganizationId` + `idpDomain`.
   Created automatically when a human first authenticates via the IdP.
3. **JWKS-based token verification.** AEGIS API verifies Auth0 access
   tokens via the org's JWKS endpoint, cached in Redis (TTL = `cacheControl`
   max-age). RS256 only — Ed25519 (EdDSA) accepted when Auth0 supports it
   as GA (currently Action-only); we hot-swap then.
4. **Auth0 Actions for AEGIS-side enforcement.** Two Actions ship in
   `infra/auth0/actions/`:
   - `aegis-audit-login.js` — logs every human login as an AEGIS
     audit event with decision=APPROVED, principal=Auth0 user.
   - `aegis-block-non-admin-mfa-skip.js` — denies MFA-skipped logins for
     users with `aegis:admin` role.
5. **Human identity is OUT of the verify hot path.** `/v1/verify` is for
   agents only. Human admin requests (`POST /v1/agents` etc.) go through
   `Auth0Guard`. Agent verify requests go through `ApiKeyGuard`. Two
   guards, two principals per request type, never mixed.
6. **`IdpAdapter` interface in `apps/api/src/modules/auth0/idp.adapter.ts`.**
   Auth0 implementation in same module. Clerk/Stytch follow as ADR-9-A,
   ADR-9-B if and when needed. The interface is the contract — once an
   adapter implements it, swap is one DI binding change.

## Consequences

### Positive
- Human identity is solved: SSO, SCIM, MFA, password reset all
  inherited from Auth0 within days, not months.
- Org → Principal binding gives multi-tenancy "for free": every Auth0
  customer org maps to one AEGIS principal, isolation guaranteed by
  the existing `principalId` check on every query.
- Auth0 Actions give enterprises a runtime hook for custom policy
  (e.g., "block this human from creating agents during a compliance freeze").
- We can sell to Auth0-using enterprises without a separate identity
  procurement step. Marketplace listing on Auth0 is plausible (M-027).

### Negative
- Hard dependency on a third-party SaaS for dashboard logins. Mitigation:
  the ApiKeyGuard path (per-org API keys) lets a customer whose Auth0
  is down still call the AEGIS API directly via curl/SDK.
- Auth0 vendor lock-in: real, but bounded by `IdpAdapter`. Migration to
  Clerk/WorkOS/self-hosted has a defined exit path (the adapter swap).
- Cost: Auth0 enterprise pricing is non-trivial. We pay for AEGIS-internal
  tenant; customers pay their own. Not a customer-cost decision.

### Neutral
- `infra/auth0/` directory holds Terraform + Action source.
- `apps/dashboard` switches from "no auth" stub to `@auth0/nextjs-auth0`.
- `packages/sdk-ts` gains a thin `Aegis.fromAuth0(accessToken)` helper.

## Alternatives considered

### Alt A: Build human auth in-house
Rejected. 6–12 months. SOC2 audit scope explosion. We'd be reinventing
a commodity. Operator quality bar (FAANG) means SSO+MFA+SCIM are
non-negotiable; building them is a 4-engineer team for a year.

### Alt B: Clerk
Strong product, faster DX, but weaker enterprise SSO story than Auth0
in 2026. Revisit if we hit scale where Auth0 pricing pinches.

### Alt C: WorkOS
Excellent enterprise SSO. Smaller surface than Auth0 (no "Universal
Login," no Actions). For pure SSO it'd be cleaner; we want Actions for
audit-bridge enforcement, so Auth0 wins.

### Alt D: Self-hosted Keycloak
Considered for sovereignty markets (EU, public sector). Defer to
ADR-9-S: ship `IdpAdapter:KEYCLOAK` after first sovereign customer asks.

## How to reverse this decision

`IdpAdapter` swap. Concretely:
1. Implement new adapter in `apps/api/src/modules/auth0/<provider>.adapter.ts`.
2. Switch DI binding in `auth0.module.ts` (rename module if dropping Auth0).
3. Migrate user records: backfill `idpProvider` / `idpOrganizationId`
   from new IdP. Backfill script template at
   `apps/api/scripts/migrate-idp.ts.template`.
4. Customer comms: 90-day notice if it changes the dashboard login URL.
5. Auth0-specific Actions in `infra/auth0/` are deleted; new IdP's
   equivalents (Clerk webhooks, WorkOS events) replace them.

## References

- Auth0 Actions: https://auth0.com/docs/customize/actions
- Auth0 Organizations: https://auth0.com/docs/manage-users/organizations
- ADR-0008 (MCP backbone) — MCP server auth uses ApiKeyGuard, not Auth0.
- ADR-0011 (key rotation) — Auth0 client secret rotation is documented
  in the runbook, separate from AEGIS Ed25519 keys.
- WORK_BOARD M-019 (auth0 module impl), M-020 (dashboard auth wiring).
