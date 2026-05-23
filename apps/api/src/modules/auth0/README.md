# Auth0 module — human identity bridge for CERNIQ

This module implements ADR-0009: human (operator/admin) identity is
delegated to Auth0; agent identity stays in CERNIQ. The two never mix on
the same request.

## Endpoints

| Method | Path                     | Auth                                     | Purpose                                                                                |
| ------ | ------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| POST   | `/v1/idp/auth0/action`   | shared secret in `X-Auth0-Action-Secret` | Auth0 Action calls this on every login event for CERNIQ-side audit + principal binding |
| POST   | `/v1/idp/auth0/exchange` | Auth0 access token in body               | Dashboard swaps an Auth0 token for an CERNIQ API key                                   |

## Files

- `idp.adapter.ts` — provider-agnostic `IdpAdapter` interface. The whole
  rest of the codebase depends on this, NOT on Auth0 directly.
- `auth0.adapter.ts` — Auth0 implementation. JWKS-cached RS256 verify,
  org→principal mapping. EdDSA path stubbed for when Auth0 GAs.
- `auth0.service.ts` — orchestrates Action callbacks and token exchange.
- `auth0.controller.ts` — HTTP surface; timing-safe Action secret check.
- `auth0.dto.ts` — wire-shape DTOs.
- `auth0.module.ts` — Nest wiring.

## Files to add (claimed under M-019)

- `auth0.adapter.spec.ts` — unit tests with a mocked JWKS endpoint.
- `auth0.service.spec.ts` — unit tests with mocked Audit + Adapter.
- `auth0-controller.e2e.spec.ts` — full-stack test with supertest.

## Operator decisions still pending

- **OD-009**: which Auth0 custom claim namespace (current: `https://cerniq.dev/`).
- **OD-010**: whether to require MFA for `cerniq:admin` role at Action
  time (current default: warn-only via `decision: 'FLAGGED'`).

## Config required at runtime

Schema additions (ADR-0009 §3) — these belong to peer's
`config.schema.ts` work but are listed here for the runbook:

```ts
AUTH0_ISSUER; // e.g. https://cerniq.us.auth0.com/
AUTH0_AUDIENCE; // e.g. https://api.cerniq.dev
AUTH0_ACTION_SECRET; // shared secret with the Action; rotate via cerniq-cli
```

## Reference

- ADR-0009: `docs/decisions/0009-auth0-bridge.md`
- Action source (deferred): `infra/auth0/actions/cerniq-audit-login.js`
- Migration spec (deferred): `apps/api/scripts/migrate-idp.ts.template`
