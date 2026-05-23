# CERNIQ API - Claude contract

This directory owns the NestJS control plane, origin verify path, Prisma data
model, billing enforcement, audit chain, policy evaluation, identity, Auth0,
KMS adapters, webhooks, and production observability.

## Hard rules

- Carry `principalId` through every service method, Prisma query, cache key,
  queue job, webhook delivery, and audit event. Tenant isolation is not optional.
- Keep verify decision logic portable. NestJS controllers/services may orchestrate
  dependencies, but signature, policy, spend, denial, and trust-score logic must
  remain framework-free when possible.
- Never update or delete audit events. Append through the audit service and keep
  signatures/hash chaining verifiable.
- Do not swallow errors in security, billing, policy, webhooks, KMS, or audit
  paths. If a non-blocking failure is intentional, log it with structured
  context and make sure the operational consequence is documented.
- Use the shared error catalog and `CerniqError` family. Do not invent stringly
  typed errors.
- Keep config changes in the Zod schema, config service, `.env.example`, docs,
  and tests together.

## Module ownership

| Path                        | Responsibility                              | Extra care                                   |
| --------------------------- | ------------------------------------------- | -------------------------------------------- |
| `src/modules/verify/`       | `/v1/verify`, replay/spend/trust decisions  | denial precedence, p99 latency, portability  |
| `src/modules/audit/`        | signed append-only audit records and export | chain integrity, canonicalization            |
| `src/modules/identity/`     | agent registration, revocation, handshake   | public-key-only boundary                     |
| `src/modules/policy/`       | policy create/list/revoke/expiry            | immutable policy semantics                   |
| `src/modules/billing/`      | plans, usage, Stripe, trial limits          | under/over-billing, webhook authenticity     |
| `src/modules/webhooks/`     | subscriptions and delivery                  | HMAC signing, retries, DLQ semantics         |
| `src/modules/wellknown/`    | public discovery endpoints                  | cache headers, additive evolution            |
| `src/common/crypto/`        | Ed25519, JWT, audit signing, PQ helpers     | paired specs required                        |
| `src/common/policy-engine/` | built-in, Cedar, OPA evaluators             | deterministic decisions and fallback clarity |
| `prisma/`                   | schema and migrations                       | append-only migrations after deploy          |

## API implementation standards

- Controllers validate and translate; services own business rules; pure helpers
  own reusable decision logic.
- Prisma access must be scoped and explicit. Avoid broad `findMany` calls
  without principal and pagination constraints.
- Redis/BullMQ work must be idempotent. Queue payloads need enough identity to
  deduplicate and enough context to audit failures.
- Webhook and Stripe handlers must verify signatures before parsing trusted
  business meaning.
- Observability code must redact API keys, bearer tokens, webhook secrets,
  private keys, and tenant-private payloads.
- Public discovery responses are additive. Do not remove or rename fields unless
  the API versioning plan is updated.

## Current API facts from latest sessions

- Billing now includes trial counters, lifetime free-trial exhaustion, Stripe
  checkout, Stripe subscription webhooks, and non-blocking paid overage metering.
- `GET /.well-known/pricing.json` is a public no-auth discovery endpoint derived
  from billing plans. Keep it DB-free, cacheable, additive, and parity-tested.
- `PlanTier` naming still has a dashboard/API boundary for TEAM/SCALE/GROWTH
  mapping. Do not remove mapper special-cases until the enum migration lands.
- Stripe overage recording is intentionally non-blocking after usage increments:
  log under-billing risks, but do not add a Stripe round-trip to verify p99.
- Customer-journey e2e covers free verify, trial exhaustion, paid upgrade,
  continued verify, subscription deletion, and returning to trial exhaustion.

## How parallel sessions claim work

Use the root `CLAUDE.md` claim protocol before broad API edits. API work often
conflicts at `app.module.ts`, Prisma schema/migrations, shared DTOs, config, and
generated catalogs, so check `WORK_BOARD.md` and `docs/SESSION_HANDOFF.md`
before touching cross-cutting files.

## Required verification

Choose the narrowest relevant set:

- API typecheck: `pnpm --filter @cerniq/api typecheck`
- API tests: `pnpm --filter @cerniq/api test -- --passWithNoTests`
- E2E tests: `pnpm --filter @cerniq/api test:e2e`
- Prisma generate: `pnpm --filter @cerniq/api prisma:generate`
- OpenAPI/Prisma parity: `pnpm check:openapi-prisma`
- Migration immutability: `pnpm check:migrations`

For crypto, audit-chain, auth, billing, policy, and verify changes, name the
specific test file or pattern you ran in the handoff/final report.
