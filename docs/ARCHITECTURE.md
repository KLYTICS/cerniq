# AEGIS — Architecture

> Companion to `docs/spec/03_TECHNICAL_SPEC.md` (the canonical reference).
> This document explains *why* the design looks the way it does and where
> the bodies are buried.

---

## 1. Two surfaces, one core

AEGIS is two services joined at the hip:

```
                 ┌─────────────────────┐
                 │ Agent builders       │
                 │ (developers)         │
                 └──────────┬───────────┘
                            │  HTTPS + API key
                            ▼
                 ┌──────────────────────────────┐
                 │  Management surface          │
                 │  (NestJS, apps/api)           │
                 │   • Identity CRUD             │
                 │   • Policy issuance           │
                 │   • Audit retrieval           │
                 │   • Webhooks                  │
                 │   • Billing                   │
                 │   • Dashboard backend         │
                 └──────────┬───────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
       ┌──────────┐  ┌──────────┐  ┌──────────────┐
       │ Postgres │  │  Redis    │  │   BullMQ     │
       │ (Prisma) │  │ (cache,   │  │  (signals,   │
       │          │  │  rate)    │  │  webhooks)   │
       └──────────┘  └──────────┘  └──────────────┘

                 ┌─────────────────────┐
                 │ Relying parties      │
                 │ (Delta, Chase, ...)  │
                 └──────────┬───────────┘
                            │  HTTPS + verify-only key
                            ▼
                 ┌──────────────────────────────┐
                 │  Hot verify path             │
                 │  (NestJS Phase 1,            │
                 │   Cloudflare Worker Phase 3) │
                 │   • POST /v1/verify           │
                 │   • GET  /agents/:id/status   │
                 │   • POST /agents/:id/report   │
                 └──────────────────────────────┘
```

The two surfaces share **the same Postgres + Redis**. They differ in
latency budget, deployment cadence, and write authority:

| Surface       | p99 budget    | Writes          | Deploy cadence | Phase 3 home |
|---------------|---------------|-----------------|----------------|--------------|
| Management    | 500 ms        | Yes (full)      | Daily          | Railway      |
| Hot verify    | 200 ms (P1) / 80 ms (P3) | Append-only audit + Redis counters | Weekly | CF Workers |

---

## 2. Why the verify path is portable

The Phase 3 plan is to lift `/v1/verify` to Cloudflare Workers for global
sub-80ms latency. To make that a deployment swap and not a rewrite, all
verify logic that touches a request lives in **framework-free utilities**:

```
apps/api/src/common/crypto/         ← pure (no @nestjs imports)
   ├── ed25519.util.ts              sign / verify / generate
   ├── jwt.util.ts                   issue / parse AEGIS-signed JWTs
   └── audit-chain.util.ts           prev-hash + signature

apps/api/src/modules/verify/
   ├── verify.algorithm.ts           PURE: takes deps as args, returns result
   └── verify.service.ts             NestJS wrapper around .algorithm()
```

The Phase 3 CF Worker imports `verify.algorithm.ts` directly and supplies
its own implementations of `loadAgent`, `loadPolicy`, `incrementSpend`
(backed by D1 + KV).

**Invariant**: nothing in `verify.algorithm.ts` may import from
`@nestjs/*`, `@prisma/client`, or `bullmq`.

---

## 3. Data model in one breath

```
Principal ─< ApiKey
          ─< AgentIdentity ─< AgentPolicy
                            ─< AuditEvent
                            ─< BateSignal
                            ─< TrustScoreHistory
                            ─< AgentDelegation (Phase 3)
          ─< WebhookSubscription ─< WebhookDelivery

RelyingParty (separate top-level — they verify, they report)
SpendRecord  (durable backstop for Redis spend counters)
```

The full schema is `apps/api/prisma/schema.prisma`. Notable choices:

- **`cuid()` not ULID** for primary keys despite the spec mentioning ULIDs.
  Reason: Prisma + cuid have better composability, and we expose a public
  prefix (`agt_`, `pol_`) that we control independently. We can switch
  later without breaking IDs in flight by adding a new column.
- **`scopes Json` on AgentPolicy**, not a relational scope table.
  Reason: scopes are immutable per policy (revoke + create new, never
  modify). Querying scopes happens in app code on the deserialized JSON,
  which is fine because we always have the policyId in hand.
- **`SpendRecord` separate from `AuditEvent`**. Reason: spend tracking has
  hot read patterns (sum-by-day), audit has hot write patterns (append).
  Conflating them would force one query pattern to subsidize the other.
- **`TrustScoreHistory` with `signalId`** so a score delta can be traced
  back to the originating signal — required for SOC2 evidence and
  customer trust ("why did you flag my agent?").

---

## 4. Caching strategy

| Key                                 | TTL      | Source of truth   | Invalidated by                |
|-------------------------------------|----------|-------------------|-------------------------------|
| `agent:{id}`                        | 60 s     | Postgres          | Identity update / revoke      |
| `agent:{id}:trust`                  | 60 s     | Postgres          | BATE worker on score change   |
| `policy:{id}`                       | 30 s     | Postgres          | Policy revoke / expire        |
| `verify:{tokenHash}:{action}`       | 30 s     | computed          | Same key naturally expires    |
| `spend:{policyId}:day:{YYYY-MM-DD}` | until midnight UTC | Postgres SpendRecord (lazy reconcile) | Atomic INCRBY |
| `spend:{policyId}:month:{YYYY-MM}`  | until next month | same | same |

We choose TTL-based invalidation over event-based for most keys because
60 s of stale state is acceptable for a verify call (the agent's
revocation propagates worst case in 60 s; spec budget is 5 s, so for
revocations specifically we **bust the cache directly** in the revoke
service before returning success).

---

## 5. Error model

All errors descend from `AegisError` (in `apps/api/src/common/errors/`):

```
AegisError                                    HTTP   Code
├── AuthenticationError                        401   AUTH_REQUIRED
├── AuthorizationError                         403   FORBIDDEN
├── NotFoundError                              404   NOT_FOUND
├── ValidationError                            400   INVALID_REQUEST
├── ConflictError                              409   CONFLICT
├── RateLimitedError                           429   RATE_LIMITED
├── VerifyDenialError                          200   (denial body, see SECURITY.md)
└── InternalError                              500   INTERNAL
```

`VerifyDenialError` is special: a denial is an expected outcome of
`/v1/verify` (the relying party still gets a 200 with `valid: false` and
a `denialReason`). It is the only "error" that returns 200.

---

## 6. The audit chain

Every event:

1. We canonicalize the event payload (RFC 8785 JSON Canonicalization).
2. We compute `prev_hash = sha256(prev_event.signature || event_id)`.
3. We sign `prev_hash || canonical_payload` with the AEGIS Ed25519 key.
4. We persist event with `aegisSignature` field.

Verification (third party):

1. Fetch the AEGIS public key from `/.well-known/audit-signing-key`.
2. For each event in chronological order, recompute `prev_hash` and
   verify the signature.
3. Any break = tampering or storage corruption.

Implementation: `apps/api/src/common/crypto/audit-chain.util.ts`.

---

## 7. Observability hooks

- **Logs**: `nestjs-pino`, JSON in prod, `pino-pretty` in dev. Redacts
  `x-aegis-api-key`, `x-aegis-verify-key`, `authorization` headers.
- **Metrics**: Prometheus via `prom-client` (M-010). Key SLIs:
  `verify_latency_seconds{decision}`, `verify_total{denial_reason}`,
  `bate_score_delta{signal_type}`.
- **Traces**: OpenTelemetry, OTLP exporter, sampled at 10% in prod, 100%
  in staging.
- **Errors**: Sentry (DSN optional, disabled in dev).

---

## 8. Open architectural questions

These are recorded so future you (or a peer) doesn't re-litigate them
without context.

1. **Should we move from cuid to ULID?** The master spec uses ULIDs.
   cuid was chosen for Prisma convenience. Decide before launch — easier
   pre-migration than post.
2. **Postgres logical replication for read replicas?** Phase 3 if we hit
   read scaling issues. Cheap to add later.
3. **Should the audit chain be per-principal or global?** Currently
   global (one chain across all principals). Per-principal would simplify
   compliance export but complicates verification of cross-principal
   investigations.
