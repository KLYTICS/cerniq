# CERNIQ — Immutability Invariants

> The properties below are inviolable. They are the contract every component,
> deployment, and operator decision must respect. Each row lists the
> invariant, the runtime mechanism that enforces it, and the CI gate that
> catches violations before they ship.

---

## I-1 — Audit log is append-only and signed

**Why:** SOC2 / FINRA / EU AI Act all require a tamper-evident audit trail.
A relying party (or auditor) with the public key must be able to verify the
entire chain offline — without contacting CERNIQ, without trusting our DB.

**Mechanism:**

- `audit.service.append()` is the **only** writer. No `UPDATE` or `DELETE`
  against `AuditEvent` exists in the codebase or in any operational runbook.
- Each row carries `cerniqSignature = sign(prevSig || RFC8785_canonical(payload))`
  signed with the active KMS key (Ed25519, kid stamped on every row).
- GDPR Art-17 redaction is supported via `*Hash` commitment columns
  (ADR-0006): nulling the raw value preserves the signature.

**Enforcement:**

- Code review: any direct `prisma.auditEvent.{update,delete*}` call is blocked
  in PR review.
- Test: `audit-chain-integrity.yml` workflow verifies a sample chain nightly.
- Spec: `docs/decisions/0006-audit-redactability.md` is the canon.

CLAUDE.md invariant **#3**.

---

## I-2 — Migrations are forward-only and content-immutable once committed

**Why:** Prisma replays migrations by content hash. Mutating an applied
migration silently breaks `prisma migrate deploy` on every target that has
already run the previous version. There is no automated rollback path.

**Rule:**

- Once `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql` is
  committed to git, its bytes are frozen. Corrections go in a NEW migration.
- Renaming or deleting a committed migration directory is also a violation
  — it's equivalent to mutation from Prisma's perspective.

**Enforcement:**

- Pre-commit hook (`.husky/pre-commit`) runs
  `pnpm check:migrations` whenever the migrations directory is touched.
- CI runs the same check on every PR.
- Script: `scripts/check-migration-immutability.ts` — exits 1 on any
  modified or deleted committed migration.

**Forced reconciliation:** The single legitimate exception is when two
parallel sessions land conflicting schema migrations on the same column
within the same hour. The recipe is:

1. Add a third "fixup" migration that converges the schema.
2. Replace the two conflicting migrations' SQL with a single `-- superseded
by <timestamp>_<fixup_name>` comment line.
3. Note the reconciliation in `docs/SESSION_HANDOFF.md` AND open an ADR.

Any other mutation requires operator sign-off.

---

## I-3 — Private keys never enter CERNIQ

**Why:** CERNIQ is a verification rail, not a key custodian. Holding agent
private keys would invert the trust model: a compromise of CERNIQ would
compromise every agent that trusted it.

**Mechanism:**

- The SDK (`@cerniq/sdk`) generates keypairs **client-side**. Only the public
  key is sent to `POST /v1/agents/register`.
- The Go CLI's `--generate-keypair` flag enforces the same.
- CERNIQ-held signing keys (audit chain, JWT issuance) are wrapped via the
  KMS adapter (AWS / GCP / Vault). Plaintext keys exist only in process
  memory after KMS decrypt.

**Enforcement:**

- API DTO inspection: no endpoint accepts a private-key field. Reviewers
  reject any DTO that adds one.
- CLAUDE.md invariant **#1** is the project's first line.

---

## I-4 — Verify hot path is portable

**Why:** Phase 3 of the GTM ships `/v1/verify` to Cloudflare Workers for
sub-80 ms global latency. That's a deployment swap, not a rewrite — but
only if the algorithm has zero NestJS / Prisma / Node-specific imports.

**Mechanism:**

- `apps/api/src/modules/verify/algorithm/verify.algorithm.ts` imports only
  from `packages/types`, `apps/api/src/common/crypto/*` pure utilities, and
  `verify.ports.ts` (the framework-free port interface).
- The Nest service (`verify.service.ts`) is the adapter: it implements the
  ports against Prisma + Redis + CERNIQ services. The Cloudflare Worker
  (`workers/cf-verify/src/index.ts`) implements the same ports against KV +
  fetch + WebCrypto.
- OTel manual spans wrap the SERVICE call to the algorithm — the algorithm
  itself never imports `@opentelemetry/api`.

**Enforcement:**

- CI build of the CF Worker bundle catches any framework leak at compile
  time. If the worker bundle fails to import `verify.algorithm.ts`,
  someone added a Nest decorator or Prisma reference to the algorithm.
- CLAUDE.md invariant **#2**.

---

## I-5 — No silent failures, no fabricated data

**Why:** CERNIQ is the trust rail. A silent stub or "empty array means no
results" answer is worse than a loud error — it lets a relying party
proceed against a fabrication.

**Mechanism:**

- Spend Redis outage → ANOMALY_FLAGGED denial (fail-closed). Documented.
- Audit append durability error → response carries `auditEventId: null`
  AND a `degraded` flag. Never silently dropped.
- Health readiness `/health/ready` returns `down` (HTTP 503) when KMS or
  DB is unreachable, so the load balancer drains the pod.
- BATE never returns a synthetic trust score; absent signals = explicit
  cold-start band, never a guessed number.

**Enforcement:**

- Linter rule (project ESLint): `no-empty-catch` is `error`. Catches must
  either re-throw, log + degrade explicitly, or convert to a typed
  `CerniqError`.
- Error hierarchy: every exception in the API descends from
  `CerniqError`; the global filter maps the `code` field. String errors
  are reviewer-rejected.
- CLAUDE.md invariant **#4**.

---

## I-6 — Multi-tenant isolation by `principalId` on every query

**Why:** A single tenant leak in a B2B audit-rail product is an existential
incident. Belt-and-braces is the only acceptable posture.

**Mechanism:**

- Every service method takes `principalId` as the first argument.
- Every Prisma query includes `where: { principalId }` (or its FK
  equivalent).
- Postgres Row-Level Security (3 migrations: 20260502000200,
  20260502000300, ...) provides the second layer.
- The API Key guard sets `req.auth.principalId` and the `@Auth()` decorator
  is the only canonical way to read it inside controllers.

**Enforcement:**

- `apps/api/src/__multi_tenant__/multi-tenant-isolation.spec.ts` —
  cross-tenant integration test that fails the moment a service method
  forgets the `principalId` filter. Round 13b extended this to webhooks.
- Code review: a Prisma query in a service method without a
  `principalId` filter is auto-rejected.
- CLAUDE.md invariant **#5**.

---

## I-7 — Denial precedence is fixed and ordered

**Why:** Relying parties code against the denial reason. A reorder
silently changes their behavior — what was previously `INVALID_SIGNATURE`
might now be `AGENT_NOT_FOUND` for the same input, and their alerting
breaks.

**Order (top wins):**

```
AGENT_NOT_FOUND
AGENT_REVOKED
INVALID_SIGNATURE
POLICY_REVOKED
POLICY_EXPIRED
SCOPE_NOT_GRANTED
SPEND_LIMIT_EXCEEDED
TRUST_SCORE_TOO_LOW
ANOMALY_FLAGGED
```

**Enforcement:**

- CI workflow `spec-sync.yml` job 3: byte-identical denial enum across
  `verify.algorithm.ts`, `packages/verifier-rp/src/types.ts`,
  `packages/types/src/constants.ts`, and `docs/spec/CERNIQ_API_SPEC.yaml`.
- ADR-0004 locks the order. Changes require an API version bump + ADR
  amendment + 90-day customer notice.
- CLAUDE.md invariant **#6**.

---

## I-8 — Webhook idempotency

**Why:** Stripe (and our own delivery worker) retry on any non-2xx. A
non-idempotent handler double-charges, double-revokes, or double-emits an
audit row.

**Mechanism:**

- Inbound (Stripe → CERNIQ): `StripeService.handleWebhookEvent` SETNXes the
  Stripe `event.id` in Redis with a 7-day TTL. Replays return early.
- Outbound (CERNIQ → relying party): `WebhookDelivery.idempotencyKey` is
  the de-duplication anchor; the delivery worker checks before re-firing.
- HMAC-SHA256 signatures on outbound events use a constant-time compare —
  the verifier rejects forged duplicates regardless of timing.

**Enforcement:**

- Spec: `stripe.service.spec.ts` exercises the duplicate-event path.
- Spec: `webhook.delivery.spec.ts` asserts the idempotency key is
  honored on retry.

---

## I-9.5 — Discovery surface is stable and additive

**Why:** `/.well-known/cerniq-configuration` is the OIDC-style discovery doc
that every relying party auto-configures from. If we silently drop or
rename a field, every integration that read it on cold-start breaks at
the next refresh — and we don't see the customer impact until they file
a ticket weeks later.

**Mechanism:**

- The doc shape is the `CerniqConfigurationDto` class in
  `apps/api/src/modules/wellknown/dto/discovery.dto.ts`.
- `spec_version` is bumped on every breaking change. Within a major
  version, evolution is additive only: new fields are added, existing
  fields' types and meanings are immutable.
- Removing a field requires bumping `spec_version` major + 90-day
  customer notice (same posture as the denial-reason enum, ADR-0004).
- The same locked-order denial enum from I-7 is published verbatim in
  the doc — `wellknown.controller.spec.ts` asserts byte-identical
  ordering as a regression gate.

**Enforcement:**

- Spec: `wellknown.controller.spec.ts` exercises every documented
  field. A `delete out.foo` somewhere upstream fails the spec.
- Spec-sync CI (job 3): denial enum byte-identical across
  `verify.algorithm.ts`, `verifier-rp/types.ts`, `CERNIQ_API_SPEC.yaml`,
  AND the discovery doc.
- Reviewer convention: any PR that mutates `discovery.dto.ts` requires
  an ADR.

**Adjacent surfaces in the same discovery contract:**

The full I-9.5 surface is the family of `/.well-known/*` endpoints, all
versioned under their own additive-only `spec_version`:

| Path                                 | DTO                      | Spec version        |
| ------------------------------------ | ------------------------ | ------------------- |
| `/.well-known/cerniq-configuration`  | `CerniqConfigurationDto` | `1.0.0`             |
| `/.well-known/audit-signing-key`     | `AuditSigningKeyDto`     | (key payload)       |
| `/.well-known/jwks.json`             | `JwksDto`                | RFC 8037            |
| `/.well-known/security.txt`          | (RFC 9116)               | (renewed `Expires`) |
| `/.well-known/llms.txt`              | (Markdown)               | n/a                 |
| `/.well-known/retention-policy.json` | `RetentionPolicyDto`     | `1.0.0`             |

`retention-policy.json` is auto-derived from
`apps/api/src/modules/billing/plans.ts` — it never duplicates the
retention windows. The service `onModuleInit` refuses to boot if a
`PlanTier` lacks a positive `auditRetentionDays` (CLAUDE.md invariant
#4: no fabricated data). The discovery doc advertises this URI as
`retention_policy_uri` so a single fetch of `cerniq-configuration` is
enough to discover the entire compliance surface.

---

## I-9 — Configuration validates at boot, never at request time

**Why:** A missing `STRIPE_WEBHOOK_SECRET` discovered at request time means
the customer hits a 500 instead of the operator hitting a deploy failure.
Boot-time validation is the only acceptable posture.

**Mechanism:**

- `apps/api/src/config/config.service.ts` runs the Zod schema in its
  constructor and throws on parse failure. The process exits before the
  HTTP listener starts.
- Production refuses to boot with `in-memory` KMS provider, ephemeral
  audit signing keys, or missing `CERNIQ_WEBHOOK_SECRET_DEK_B64`.
- `.env.example` is the contract — single source of truth for the schema.

**Enforcement:**

- Boot test: `apps/api/src/main.ts` is exercised under the e2e harness with
  a mutated config; missing required envs → boot failure (caught by
  supertest's `agent.listen` rejection).

---

## How to add a new invariant

1. Open an ADR in `docs/decisions/` describing the property and the threat
   model that justifies it.
2. Implement the runtime mechanism (or pick an existing one).
3. Add an enforcement gate: a test, a CI workflow, a lint rule, or a
   pre-commit hook. An invariant without enforcement is a wish.
4. Add a row to this document in the same PR.
5. Reference the invariant from `CLAUDE.md` if it crosses module boundaries.

Drift between this document, `CLAUDE.md`, and the code is itself a
violation — a session that finds drift fixes it in the same commit.
