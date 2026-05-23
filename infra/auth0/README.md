# Auth0 Actions for CERNIQ

Two Actions ship here. Both run in the Auth0 Actions sandbox and have
their own secrets, completely separate from CERNIQ's API keys.

## `cerniq-audit-login.js`

**Trigger**: `post-login`.

Posts the login event to CERNIQ at
`POST /v1/idp/auth0/action` so CERNIQ audits every human login as a
hash-chain event (ADR-0009 §4).

**Required secrets**:

- `CERNIQ_API_BASE` — e.g. `https://api.cerniq.dev`
- `CERNIQ_ACTION_SECRET` — shared HMAC secret with the CERNIQ API
  (`AUTH0_ACTION_SECRET` env on the API side)

**Failure semantics**: action errors do NOT block login. The dashboard's
token-exchange call (also audited) catches dropped events on next login.

## `cerniq-block-non-admin-mfa-skip.js`

**Trigger**: `post-login`.

Denies logins where a user with the `cerniq:admin` role hasn't satisfied
MFA. Belt-and-suspenders to Auth0's tenant-level MFA settings.

## Deployment

Auth0 Actions can be deployed via Terraform (`auth0_action` resource) or
through the dashboard. We recommend Terraform — see
`infra/auth0/terraform/main.tf` (deferred to M-020-tf).

## Reference

- ADR-0009: `docs/decisions/0009-auth0-bridge.md`
- Auth0 Actions docs: https://auth0.com/docs/customize/actions
- WORK_BOARD: M-020
