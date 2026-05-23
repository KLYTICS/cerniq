# OKORO — Architecture

> Companion to `docs/spec/03_TECHNICAL_SPEC.md` (the canonical reference).
> This document explains _why_ the design looks the way it does and where
> the bodies are buried.

---

## 1. Two surfaces, one core

OKORO is two services joined at the hip:

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

| Surface    | p99 budget               | Writes                             | Deploy cadence | Phase 3 home |
| ---------- | ------------------------ | ---------------------------------- | -------------- | ------------ |
| Management | 500 ms                   | Yes (full)                         | Daily          | Railway      |
| Hot verify | 200 ms (P1) / 80 ms (P3) | Append-only audit + Redis counters | Weekly         | CF Workers   |

---

## 2. Why the verify path is portable

The Phase 3 plan is to lift `/v1/verify` to Cloudflare Workers for global
sub-80ms latency. To make that a deployment swap and not a rewrite, all
verify logic that touches a request lives in **framework-free utilities**:

```
apps/api/src/common/crypto/         ← pure (no @nestjs imports)
   ├── ed25519.util.ts              sign / verify / generate
   ├── jwt.util.ts                   issue / parse OKORO-signed JWTs
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

| Key                                 | TTL                | Source of truth                       | Invalidated by              |
| ----------------------------------- | ------------------ | ------------------------------------- | --------------------------- |
| `agent:{id}`                        | 60 s               | Postgres                              | Identity update / revoke    |
| `agent:{id}:trust`                  | 60 s               | Postgres                              | BATE worker on score change |
| `policy:{id}`                       | 30 s               | Postgres                              | Policy revoke / expire      |
| `verify:{tokenHash}:{action}`       | 30 s               | computed                              | Same key naturally expires  |
| `spend:{policyId}:day:{YYYY-MM-DD}` | until midnight UTC | Postgres SpendRecord (lazy reconcile) | Atomic INCRBY               |
| `spend:{policyId}:month:{YYYY-MM}`  | until next month   | same                                  | same                        |

We choose TTL-based invalidation over event-based for most keys because
60 s of stale state is acceptable for a verify call (the agent's
revocation propagates worst case in 60 s; spec budget is 5 s, so for
revocations specifically we **bust the cache directly** in the revoke
service before returning success).

---

## 5. Error model

All errors descend from `OkoroError` (in `apps/api/src/common/errors/`):

```
OkoroError                                    HTTP   Code
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
3. We sign `prev_hash || canonical_payload` with the OKORO Ed25519 key.
4. We persist event with `okoroSignature` field.

Verification (third party):

1. Fetch the OKORO public key from `/.well-known/audit-signing-key`.
2. For each event in chronological order, recompute `prev_hash` and
   verify the signature.
3. Any break = tampering or storage corruption.

Implementation: `apps/api/src/common/crypto/audit-chain.util.ts`.

---

## 7. Observability hooks

- **Logs**: `nestjs-pino`, JSON in prod, `pino-pretty` in dev. Redacts
  `x-okoro-api-key`, `x-okoro-verify-key`, `authorization` headers.
- **Metrics**: Prometheus via `prom-client` (M-010). Key SLIs:
  `verify_latency_seconds{decision}`, `verify_total{denial_reason}`,
  `bate_score_delta{signal_type}`.
- **Traces**: OpenTelemetry, OTLP exporter, sampled at 10% in prod, 100%
  in staging.
- **Errors**: Sentry (DSN optional, disabled in dev).

---

## 8. Deployment strategy

Closes audit finding **A-008**. The deployment surface is split between
the Railway-hosted management plane and the Cloudflare-Workers-hosted
verify edge (Phase 3); each has a distinct release cadence and rollback
posture.

### 8.1 Rollback

- **Railway (management)**: every deploy keeps the prior image. Operator
  rollback is `railway rollback <deployment-id>` — see
  `docs/RUNBOOK.md` § "Rollback (management plane)". RTO target: 5 min.
- **Cloudflare Workers (verify edge, Phase 3)**: Wrangler keeps the prior
  bundle; rollback is `wrangler deployments rollback`. Worker rollback
  does not require a config change — DNS routes are stable.

### 8.2 Canary

- **Phase 1 (Railway)**: no canary. The management surface is low-QPS
  and rollback is fast enough. Daily releases with manual smoke
  (`pnpm --filter @okoro/api smoke`) before promoting.
- **Phase 3 (Workers)**: traffic split via Cloudflare Worker Routes —
  5% canary for 30 min, then 100% on green metrics. Per-route SLI watch:
  `verify_latency_seconds` p99, `verify_total{denial_reason}` per-reason
  rate, and `okoro_cache_set_failed_total` (the round-4 silent-failure
  detector). Page on > 0.5% delta over baseline.

### 8.3 Database migrations

Forward-only, three-step contract:

1. **Additive migration** ships first (new column nullable, new table
   coexists with old). Runs on every Railway deploy via `prisma migrate
deploy` in the API container's start script.
2. **App deploy** uses both old and new column behind a feature flag.
3. **Cleanup migration** ships once the feature is fully ramped and the
   old column is unreferenced.

This invariant lets a rollback step (1) → (2) without a schema fight.
The audit-append-only trigger (`20260502000100_audit_append_only`) is the
only enforcement-by-trigger migration — bypass requires the schema-owner
role per ADR-0006 § "Redaction execution model".

### 8.4 Feature flags

Single registry: `apps/api/src/config/features.ts` (env-backed, prefix
`FEATURE_*`). Crypto and authn paths **must not** be flag-gated — they
are signed-and-audited per request, and a flag flip would create an
event-sequence the audit chain cannot represent. Flags that touch
verification semantics require an ADR.

---

## 9. Incident communication

Closes audit finding **A-009**, satisfies SOC 2 CC7.4. OKORO holds
verification authority for downstream payment flows; incidents are not
private to us.

| P-tier | Time-to-customer-notify | Mechanism                                                                         |
| ------ | ----------------------- | --------------------------------------------------------------------------------- |
| P1     | 4 hours                 | Webhook `okoro.incident.declared` + dashboard banner + email to principal contact |
| P2     | 24 hours                | Dashboard banner + email                                                          |
| P3     | Next status-page post   | Status page only                                                                  |

- **Status page**: `status.okoroapp.com`, sourced from
  `incidents.{open,history}.json` published from the management API
  (Statuspage / self-hosted decision pending — see `OPERATOR_DECISIONS.md`
  OD-007 once filed).
- **Webhook payload**: ED25519-signed (same key as audit chain) so RPs
  can verify authenticity without a separate trust path. Schema in
  `packages/types/src/schemas.ts` `IncidentEventSchema` (pending — peer's
  enterprise-backbone-arch lane).
- **Linked**: `docs/RUNBOOK.md` § "Incident communication".

---

## 10. Failure modes (the operational truth table)

Closes audit findings **A-002**, **A-003**, and **A-022**. This section
is what lets an SRE answer "what happens when X dies?" without paging
the architect.

### 10.1 Cache reads (`agent:*`, `policy:*`, `verify:*`)

- **Redis miss** → fetch from Postgres, populate cache. Normal.
- **Redis error (timeout, connection refused)** → fetch from Postgres
  directly. Increment `okoro_cache_set_failed_total` (round-4 metric).
  Operator alert at `> 1/sec sustained` (Redis is silently piling DB
  load).
- **Postgres miss after Redis miss** → 404 (legitimate).
- **Negative caching** (closes A-015): `agent:{id}:notfound` TTL 60 s,
  set on Postgres miss. Prevents enumeration-amplified DoS on
  `/v1/agents/{id}`.

### 10.2 Spend counters (`spend:{policyId}:*`)

**Fail-closed.** Spend counters are load-bearing for correctness, not
performance. On Redis error during spend evaluation:

- Return `503 SERVICE_UNAVAILABLE` with `code: SPEND_GUARD_UNAVAILABLE`.
- Audit-append the denial (so the agent's later reconciliation can show
  the request was _attempted_ but unverified).
- Do **not** fall back to Postgres for the live increment — the latency
  cost violates the p99 budget and the contention pattern fights the
  audit-append transaction.

This is a deliberate availability sacrifice for correctness; rationale
in THREAT_MODEL_v2 § 8.4.

### 10.3 JWKS local cache (verifier-rp side)

- Stale-while-revalidate up to **24 hours** on the public key set.
- Background refresh on every cache hit older than 5 min.
- Hard fail on stale > 24h AND fetch error — return
  `JWKS_UNAVAILABLE` rather than skipping signature verification.

### 10.4 Postgres unavailability

| Path                    | Behavior on PG-down                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/v1/verify` cache hit  | Continues, audit append falls through to **outbox** (ADR-0007); CLAUDE.md inv. 3 holds because the outbox row carries the signed payload that will land on PG recovery. |
| `/v1/verify` cache miss | `503` with `code: BACKEND_UNAVAILABLE`.                                                                                                                                 |
| Identity / policy CRUD  | `503`.                                                                                                                                                                  |
| Audit retrieval         | `503`. Past events are not served from cache.                                                                                                                           |
| Webhook delivery        | Continues from BullMQ until queue saturation; then `503` on `POST /v1/webhooks` create.                                                                                 |

### 10.5 Multi-region / DR posture (closes A-022)

- **Phase 1**: single-region (Railway us-east). RPO 5 min via Railway
  managed Postgres backups; RTO 30 min via region failover. Verify edge
  is colocated; outage of region = full-system outage.
- **Phase 3**: management plane stays single-region; verify edge
  (Workers) is multi-region native. If the Railway region is down, the
  verify edge **continues to verify** for any token whose policy and
  agent are in CF KV cache and whose spend counter can be served by the
  regional KV mirror — at the cost of fail-closing on cache miss. JWKS
  is CDN-fronted and survives independently. Operator visible in
  `docs/DR_RUNBOOK.md` § "Verify-edge-only mode".

### 10.6 Reconciliation behavior

`SpendRecord` reconciliation (closes A-017): nightly cron at 02:00 UTC
compares Redis spend counters against Postgres `SpendRecord` rolling
sum. On discrepancy:

- `> 5%` per policy → page operator (`page` severity).
- `> 1%` aggregate → `audit.spend_mismatch` event written to the
  audit chain (auditor-visible). **No auto-correction.** Manual
  reconciliation only — see RUNBOOK § "Spend reconciliation".

---

## 11. Capacity plan

Closes audit finding **A-004**. These are the numbers that make the SLOs
in `docs/SLO.md` achievable.

### 11.1 Throughput targets

| Surface      | Phase 1   | Phase 3 (per region) | Notes                                          |
| ------------ | --------- | -------------------- | ---------------------------------------------- |
| `/v1/verify` | 1 000 rps | 10 000 rps           | Phase 1 single Railway instance; P3 KV-fronted |
| Management   | 100 rps   | 100 rps              | Identity / policy / audit CRUD + dashboard     |
| Webhook out  | 50 rps    | 200 rps              | BullMQ-paced; bursts buffered                  |

### 11.2 Postgres

- **Pool size per app instance**: `min(2 × cores, 20)`.
- **PgBouncer**: transaction pooling at 200 frontend / 30 backend.
- **Slow query budget**: 95% < 50 ms (verify path), 95% < 200 ms
  (management).
- **Connection retry**: 3 attempts with exponential 50 / 200 / 800 ms,
  then 503.

### 11.3 Redis

- **Memory**: `maxmemory 1 GiB` minimum dev, `8 GiB` Phase 1 prod.
- **Eviction**: `maxmemory-policy allkeys-lru`.
- **Persistence**: `appendonly yes` with `appendfsync everysec`. We
  accept ≤ 1 s of cache loss on hard kill (cache is reconstructable from
  Postgres).
- **Spend counters live in a separate logical DB** (`SELECT 1`) with
  `noeviction` policy — losing a counter is unsafe (would re-grant
  spend after the day's first read).

### 11.4 BullMQ concurrency (per app instance)

| Queue                 | Concurrency | Notes                              |
| --------------------- | ----------- | ---------------------------------- |
| `webhook:deliver`     | 5           | Per-subscription HMAC sign + POST  |
| `bate:signal`         | 3           | Score recompute + cache invalidate |
| `audit:dlq`           | 1           | Outbox drain to AuditEvent         |
| `policy:expiry-sweep` | 1           | Cron every 5 min                   |
| `bate:webhook-emit`   | 2           | Trust-band-crossing notifications  |

### 11.5 Storage growth

| Entity          | Row size | At 10× projected scale (Phase 1) | At Phase 3 (1B verifies/yr) |
| --------------- | -------- | -------------------------------- | --------------------------- |
| `AgentIdentity` | ~512 B   | 50 K rows ≈ 25 MB                | 1 M rows ≈ 500 MB           |
| `AgentPolicy`   | ~2 KB    | 500 K rows ≈ 1 GB                | 50 M rows ≈ 100 GB          |
| `AuditEvent`    | ~1 KB    | 10 M rows ≈ 10 GB                | **1 B rows ≈ 1 TB / yr**    |
| `BateSignal`    | ~256 B   | 100 M rows ≈ 25 GB               | 10 B rows ≈ 2.5 TB          |

The 1 TB/year audit growth drives the partitioning policy in §12.

---

## 12. Audit retention and tenant deletion

Closes audit findings **A-005** (partitioning) and **A-006** (GDPR
Article 17). Implementation lives across ADR-0006 (redactability) and
ADR-0007 (transactional outbox); this section is the architectural
contract.

### 12.1 Partitioning

- `AuditEvent` is partitioned **monthly** via Postgres declarative
  partitioning (`PARTITION BY RANGE (timestamp)`).
- New partition created 24h ahead of the month boundary by a scheduled
  job (`infra/postgres/partition-cron.sql`).
- Old partition detach + archive happens at the 18-month boundary
  (next subsection).

### 12.2 Retention tiers

| Tier            | Storage            | Duration            | Access pattern              |
| --------------- | ------------------ | ------------------- | --------------------------- |
| Hot (live)      | Postgres           | 18 months           | Indexed read, audit GET API |
| Warm (archived) | S3 + GCS dual      | 18 months → 7 years | NDJSON export on request    |
| Cold (sealed)   | Glacier / Coldline | 7 years → forever   | Legal hold only             |

- **Encryption**: archive files AES-256-GCM with per-month KEK rotated
  via `infra/kms/rotate-okoro-keys.sh`.
- **Integrity pin**: each archived month's Merkle root is signed with
  the OKORO audit-signing key and published to the
  `/.well-known/audit-archive-roots.json` endpoint, plus mirrored to a
  third-party notarization (e.g. OpenTimestamps) to constrain insider
  risk on operator-controlled archives.
- **Compliance horizon**: SOC 2 Type II evidence-of-controls retention
  is 7 years (operator decision OD-004 default); FINRA is 3 years for
  most records. Cold tier services both.

### 12.3 GDPR Article 17 ("right to erasure")

The conflict — _audit chain is append-only_ vs. _PII must be
erasable_ — is resolved by **redactable signed payloads** (ADR-0006).

`AuditEvent.okoroSignature` signs over a payload v2 that contains
**hashed leaves** for free-text and PII columns:

- `actionHash`, `relyingPartyHash`, `requestedAmountHash`,
  `policySnapshotHash` are signed at append time.
- The raw values live in nullable columns alongside the signed payload.
- Erasure NULLs the raw columns and writes a meta `audit.redact` event
  into the chain. Chain integrity is preserved (verifier recomputes
  hashes from the original signed payload, never from raws).

**Tenant deletion flow** (`DELETE /v1/principals/{id}`):

1. Soft-delete on `Principal` (30-day grace).
2. After grace period, redaction job:
   - NULLs raw free-text on `AuditEvent` rows for that principal.
   - Hard-deletes `Principal`, `ApiKey`, `AgentIdentity`,
     `AgentPolicy`, `WebhookSubscription`, `BateSignal`,
     `TrustScoreHistory`, `SpendRecord`.
   - Writes `audit.redact` meta-events with the redacted column list
     and the operator/tenant who authorized erasure (per
     ADR-0006 § "Operator authorization").
3. `redactedAt` and `redactionReason` columns on `AuditEvent` flag
   downstream readers to suppress non-essential fields.

**Documented residual risk**: redaction within a small principal set
permits a dictionary attack on the hash leaves. ADR-0006 § "Dictionary
attack residual" is the disclosure auditors and DPO read.

---

## 13. Dashboard authentication

Closes audit findings **A-012** and **A-013**. The dashboard is
peer-locked under `apps/dashboard/`; this section documents the
contract, not the implementation.

### 13.1 Primary authn

- **Passkeys** (WebAuthn / FIDO2) — primary credential.
- **Email magic link** — fallback / first-onboarding.
- **Google SSO** — optional via the operator's organization claim.
- **No password storage anywhere.**

The Auth0 bridge (peer's ADR-0009, `modules/auth0/`) brokers the IdP
trust into OKORO principals — see `FederatedIdentity` row in the
forthcoming schema. Sessions are OKORO-managed; Auth0 issues the
identity claim, OKORO issues the session.

### 13.2 Session model

- HTTP-only, `Secure`, `SameSite=Strict` session cookie.
- Backend exchanges the session for a **scoped internal API key**
  (never returned to the browser) used to call the same management
  endpoints as programmatic users. The browser only carries the session
  cookie; the API key lives in a server-side session store.
- Session TTL: 12 hours absolute, 30 minutes idle.
- Session revocation propagates within 60 s (cache TTL).

### 13.3 CSRF posture

API-key-authenticated requests are CSRF-immune (no ambient credential).
Cookie-authenticated dashboard requests get the full belt + braces:

- Double-submit CSRF token on state-changing requests
  (`X-OKORO-CSRF`), validated against a session-bound secret.
- `Origin` header allow-list validated against the dashboard's known
  origin set (env: `DASHBOARD_ALLOWED_ORIGINS`).
- `SameSite=Strict` cookie blocks cross-origin cookie transmission
  baseline.

---

## 14. Background job idempotency

Closes audit finding **A-020**. BullMQ at-least-once delivery means
every worker must be safe under duplicate fire.

| Queue                 | Idempotency key      | Dedup mechanism                                      |
| --------------------- | -------------------- | ---------------------------------------------------- |
| `audit:append`        | `eventId` (CSPRNG)   | `INSERT ... ON CONFLICT (id) DO NOTHING`             |
| `bate:signal`         | `signalId`           | `BateSignal` PK; score-delta computed only once      |
| `webhook:deliver`     | `WebhookDelivery.id` | `Idempotency-Key` HTTP header → customer endpoints   |
| `policy:expiry-sweep` | natural (idempotent) | UPDATE WHERE revokedAt IS NULL AND expiresAt < now() |
| outbox drain          | `OutboxEvent.id`     | `SELECT ... FOR UPDATE SKIP LOCKED` per ADR-0007     |

Customer webhook endpoints **should** dedup on `Idempotency-Key`; we
publish the contract in `docs/spec/OKORO_API_SPEC.yaml` § "Webhooks".
Failure of a customer to dedup does not violate OKORO guarantees.

---

## 15. Open architectural questions

These are recorded so future you (or a peer) doesn't re-litigate them
without context.

1. **Should we move from cuid to ULID?** The master spec uses ULIDs.
   cuid was chosen for Prisma convenience. Decide before launch — easier
   pre-migration than post. (Audit ref: A-011; ADR-0001.)
2. **Postgres logical replication for read replicas?** Phase 3 if we hit
   read scaling issues. Cheap to add later.
3. **Should the audit chain be per-principal or global?** Currently
   global (one chain across all principals). Per-principal would simplify
   compliance export but complicates verification of cross-principal
   investigations. ADR pending.

---

## 16. Cross-references

| Topic                  | Authoritative source                                |
| ---------------------- | --------------------------------------------------- |
| Threat model           | `docs/THREAT_MODEL_v2.md` (v1 retained for history) |
| Security controls      | `docs/SECURITY.md`                                  |
| SLOs / SLIs            | `docs/SLO.md`                                       |
| Disaster recovery      | `docs/DR_RUNBOOK.md`                                |
| Operator runbook       | `docs/RUNBOOK.md`                                   |
| Compliance posture     | `docs/COMPLIANCE.md`, `docs/EU_RESIDENCY.md`        |
| Post-quantum roadmap   | `docs/POST_QUANTUM_ROADMAP.md`                      |
| BATE algorithm         | `docs/BATE_ALGORITHM.md`                            |
| Decision records       | `docs/decisions/0001-0013`                          |
| Multi-project adoption | `docs/OKORO_AS_BACKBONE.md`                         |
