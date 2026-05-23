# CERNIQ Infra - Claude contract

This directory owns deployment, network, Auth0, backup, KMS, Cloudflare,
Railway, Redis/Postgres, and observability infrastructure documentation and
configuration.

## Infra rules

- Treat infrastructure changes as production-risk changes even when they are
  documentation-only.
- Do not commit real secrets, tenant data, private keys, provider tokens, or
  customer endpoints.
- Document rollback, verification, owner, and blast radius for new production
  controls.
- Keep alert rules paired with runbooks. An alert without a clear operator
  action is not enterprise-ready.
- Auth, KMS, network, backup, retention, and observability changes must preserve
  compliance and audit evidence requirements.
- Prefer explicit environment variables and least privilege over implicit
  provider defaults.

## Required verification

- YAML/config formatting where applicable: `pnpm format:check`
- Alert/runbook consistency: inspect `infra/observability/alerts/` and
  `infra/observability/runbooks/` together.
- Platform doctor for local operational assumptions: `pnpm doctor`

If a real provider action is required, document the exact manual step and mark
it `OPERATOR-INPUT-NEEDED` rather than pretending it was executed.
