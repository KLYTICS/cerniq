# AEGIS Docs - Claude contract

This directory owns specs, runbooks, threat models, compliance material,
operator handoffs, design prompts, release process, architecture records, and
customer-facing integration guides.

## Documentation rules

- Docs must reflect code, not aspiration. If a feature is planned, label it as
  planned, gated, or not yet wired.
- When older master-state docs conflict with the newest entries in
  `SESSION_HANDOFF.md`, treat the handoff as fresher and reconcile the stale doc
  in the same change when practical.
- Security, billing, policy, public API, denial reasons, and discovery-surface
  docs must move with implementation and tests.
- Runbooks need exact commands, expected output shape, rollback steps, and
  escalation criteria.
- ADRs/decisions should record constraints and rejected alternatives, not just
  conclusions.
- Do not expose secrets, customer data, private financial details, or internal
  credentials.
- Keep dates concrete. Use ISO-style dates when a fact is time-sensitive.

## High-value docs

| File                                 | Purpose                                       |
| ------------------------------------ | --------------------------------------------- |
| `SERVICE_MAP.md`                     | day-one map of surfaces and ownership         |
| `ARCHITECTURE.md`                    | system shape and design rationale             |
| `SECURITY.md` / `THREAT_MODEL.md`    | security model and threat analysis            |
| `OPERATOR_RUNBOOK.md` / `RUNBOOK.md` | operational execution                         |
| `PRODUCTION_CHECKLIST.md`            | release readiness                             |
| `SESSION_HANDOFF.md`                 | latest work and known gaps                    |
| `decisions/`                         | durable architecture decisions                |
| `spec/`                              | product, technical, commercial, and API specs |

## Required verification

- Markdown formatting: `pnpm format:check`
- Contract docs changed with code: run the relevant API/package/dashboard tests.
- OpenAPI docs changed: run `pnpm check:openapi-zod` and
  `pnpm check:openapi-prisma` where applicable.

For meaningful platform changes, add a concise newest-first entry to
`docs/SESSION_HANDOFF.md`.
