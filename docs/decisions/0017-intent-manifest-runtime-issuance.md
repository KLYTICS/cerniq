# ADR-0017 — Intent Manifest Phase 2 runtime issuance + reconciliation

**Status**: proposed
**Date**: 2026-05-15
**Deciders**: operator (Erwin Kiess-Alfonso) — three sub-decisions packaged
**Builds on**: ADR-0016 (intent manifest kernel)
**Closes**: ADR-0016 Phase 2 boundary; Testament Book I §3 wedge productionization

## Context

ADR-0016 shipped `@aegis/intent-manifest` as a framework-free Phase 0 kernel.
The kernel signs, verifies, and reconciles intent manifests but does not
issue them at runtime — relying parties cannot yet obtain a signed intent
manifest from AEGIS. Phase 2 wires runtime issuance + reconciliation into
the API control plane so intent manifests become a production surface.

Three design tensions force explicit decisions:

1. **Where does issuance live?** Two candidate placements:
   - (A) Extension to `POST /v1/verify` — request adds optional
     `declareIntent`, response adds optional `signedIntentManifest`.
   - (B) Separate `POST /v1/intent` endpoint — independent surface,
     decoupled from verify hot path.

2. **Where does reconciliation live?** Two candidates:
   - (A) Synchronous at next `POST /v1/verify` from the same agent —
     prior unresolved mismatches deny.
   - (B) Asynchronous `POST /v1/intent/{id}/actuals` — relying party
     reports actuals after their tool call; reconciliation emits audit
     events + BATE signals.

3. **Does the intent surface emit `INTENT_MISMATCH` on the verify wire
   response?** Two candidates:
   - (A) Yes — `INTENT_MISMATCH` in `DenialReason` enum (ADR-0016
     decision D3 already chose option (a) — append-at-end). Verify path
     reads stored intent state and denies if unresolved mismatch exists.
   - (B) No — intent surface has its own response type
     (`ReconciliationResult`) consumed by the relying party directly.
     Verify wire enum stays clean of intent semantics; intent surface
     feeds BATE signals + audit events that influence trust score
     indirectly.

## Decision

### D1 — Issuance: separate `POST /v1/intent` endpoint (option B)

**Rationale**: preserves CLAUDE.md invariant #2 (verify portability).
The verify hot path remains framework-free and can ship to Cloudflare
Workers per ADR-0003 without inheriting intent-issuance state. Intent
issuance requires database access (manifest persistence), KMS access
(signing), and Redis access (jti deduplication) — adding any of these
to the verify hot path widens the worker port surface unacceptably.

Independent surface also enables:
- Independent rate limiting (intent declaration is N×heavier than verify)
- Independent billing meter (intent is a paid feature; verify-only
  customers may not pay for intent)
- Independent feature-flag rollout (`AEGIS_INTENT_MANIFEST_ENABLED`)
- Independent OpenAPI surface; older SDKs ignore `/v1/intent/*`
  endpoints without code change

### D2 — Reconciliation: asynchronous `POST /v1/intent/{id}/actuals` (option B)

**Rationale**: synchronous-at-next-verify (option A) creates implicit
ordering coupling. The relying party's tool call may take many seconds;
the next verify call may come from a DIFFERENT relying party for the
same agent; trying to scope "next verify" creates a brittle session
concept that AEGIS deliberately avoids.

Asynchronous reconciliation gives relying parties full control over
when and how often they reconcile, with idempotency keys per actual.
Outcomes flow through:
- Audit events (`intent.declared`, `intent.reconciled`, `intent.mismatch`)
- BATE signals (new signal type `INTENT_MISMATCH_OBSERVED`, severity HIGH)
- Webhooks (`aegis.intent.mismatch_detected`) for operator alerting

The verify path *indirectly* sees intent state via BATE trust score
changes — a series of intent mismatches will pull the agent's trust
score down through the existing BATE engine, eventually triggering
`TRUST_SCORE_TOO_LOW` denial via the existing precedence chain. No
new wire-level coupling needed.

### D3 — Verify wire enum: `INTENT_MISMATCH` already wired (clarifying)

ADR-0016 D3 already locked `INTENT_MISMATCH` append-at-end of
`DENIAL_REASON_PRECEDENCE`. The wire enum addition was committed in
`2078bd2` on `feat/sdk-verify-gateway-hardening`. Phase 2 does NOT
extend verify hot path to emit `INTENT_MISMATCH` — that wiring would
require synchronous-at-next-verify (option A above), which D2 rejects.

Instead, `INTENT_MISMATCH` becomes available for **future Phase 3**
where the edge worker (workers/cf-verify) could read intent state from
KV cache and emit synchronous denial. Phase 2 reserves the enum value
without yet emitting it from any hot path. The intent module's
algorithm returns `'INTENT_MISMATCH'` as a string for its OWN response
type (`ReconciliationResult.recommendedDenialReason`) — that's a
suggestion to the relying party, not a verify wire response.

## Architecture

```
┌──────────────┐   POST /v1/intent      ┌────────────────────────────┐
│  Relying     │ ─────────────────────► │  apps/api/.../intent/      │
│  Party       │ ◄──────────────────── │   IssuanceController       │
│ (merchant)   │   SignedIntentManifest │   IntentService.issue()    │
└──────────────┘                        │   @aegis/intent-manifest   │
                                        │     .signManifest()        │
                                        │   IntentRepository.save()  │
                                        └────────────────────────────┘

┌──────────────┐   POST /v1/intent/{id}/actuals       ┌────────────────────┐
│  Relying     │ ─────────────────────────────────►   │  Reconciliation    │
│  Party       │ ◄──────────────────────────────────  │  Controller        │
│ (merchant)   │   ReconciliationResult               │  intent.reconcile()│
└──────────────┘                                      │  @aegis/intent-    │
                                                      │    manifest        │
                                                      │    .reconcile()    │
                                                      │  AuditService.    │
                                                      │    append(...)    │
                                                      │  BateService.     │
                                                      │    ingestSignal()  │
                                                      └────────────────────┘
```

## API surface

### Issuance

```
POST /v1/intent
Headers: X-AEGIS-API-Key, Idempotency-Key (recommended)
Body:
  {
    agentId: string,
    verifyTokenJti: string,         // ties manifest to a verify token
    verifyTokenSha256B64Url: string,
    intent: IntentClaim,            // discriminated union — see ADR-0016
    reconciliation?: ReconciliationPolicy,  // default { strictness: 'strict' }
    ttlSeconds?: number,            // 30-60, defaults to verify token ttl
  }
Response 201:
  {
    manifestId: string,
    signedManifest: SignedIntentManifest,
    expiresAt: number,
  }
Errors:
  400 — validation (Zod-shaped from packages/types)
  401 — auth required
  403 — agent.principalId ≠ caller principal (tenant isolation)
  404 — agent not found
  409 — manifestId collision OR duplicate idempotency-key with diff body
  410 — verify token already expired
  429 — rate limited
```

### Reconciliation

```
POST /v1/intent/{manifestId}/actuals
Headers: X-AEGIS-API-Key, Idempotency-Key (REQUIRED)
Body:
  {
    actuals: ActualCallObservation[],   // each with observedAt + kind + payload
  }
Response 200:
  ReconciliationResult                  // from @aegis/intent-manifest
Errors:
  400 — actuals shape mismatch
  401, 403, 404 — as above
  409 — duplicate idempotency-key with different actuals
  410 — manifest already reconciled (terminal state)
```

### Read

```
GET /v1/intent/{manifestId}
Headers: X-AEGIS-API-Key
Response 200:
  {
    manifest: SignedIntentManifest,
    actuals: ActualCallObservation[],
    reconciliation: ReconciliationResult | null,  // null if not yet reconciled
    status: 'open' | 'reconciled' | 'expired',
  }
```

## Module layout

```
apps/api/src/modules/intent/
├── intent.types.ts          # local types (NestDTO-free) for the algorithm
├── intent.ports.ts          # IntentPorts interface (framework-free)
├── intent.algorithm.ts      # pure issuance + reconciliation logic
├── intent.algorithm.spec.ts # jest tests for the pure algorithm
├── intent.dto.ts            # Nest DTOs (class-validator decorated)
├── intent.service.ts        # Nest service wraps algorithm with adapters
├── intent.controller.ts     # POST /v1/intent + POST /v1/intent/{id}/actuals + GET
├── intent.module.ts         # Nest wiring
├── intent.adapter.memory.ts # in-memory repository (Phase 2 pre-migration)
├── intent.adapter.prisma.ts # Prisma repository (Phase 2 post-migration)
└── README.md                # module-local doc
```

The algorithm/port split mirrors `apps/api/src/modules/verify/algorithm/`
exactly. Adapter layer can swap between memory + Prisma without algorithm
change.

## Phasing

**Phase 2 (this commit + immediate follow-on)**:
- Module behind `AEGIS_INTENT_MANIFEST_ENABLED=false` (default off).
- In-memory storage adapter ONLY (Phase 2.0); Prisma adapter stubbed.
- 3 audit event kinds: `intent.declared`, `intent.reconciled`,
  `intent.mismatch` (appended via existing AuditService).
- 1 new BATE signal kind: `INTENT_MISMATCH_OBSERVED`, severity HIGH.
- 1 new webhook event: `aegis.intent.mismatch_detected`.
- OpenAPI spec adds the 3 endpoints.
- Cross-package: no changes to verify path; no changes to denial
  precedence chain (already done in 2078bd2).

**Phase 2.1 (separate, gated on operator schema review)**:
- Prisma schema additive migration: `IntentManifest`,
  `IntentActual` tables (proposed schema in §"Schema additions" below).
- Swap memory adapter for Prisma adapter via env flag.
- Backfill not needed (memory adapter state is ephemeral).

**Phase 3 (gated on Phase 2 + customer telemetry)**:
- Edge port for workers/cf-verify: read intent state from KV cache,
  emit synchronous `INTENT_MISMATCH` denial. Shadow-mode rollout
  per M-049 pattern.

## Schema additions (proposed, gated on Phase 2.1 operator review)

```prisma
model IntentManifest {
  id               String    @id          // ULID
  principalId      String                  // tenant boundary
  agentId          String
  verifyTokenJti   String    @unique       // 1:1 with verify token
  signedBody       Json                    // SignedIntentManifest['body']
  signingKeyId     String                  // kid used to sign
  signatureB64Url  String
  reconciliation   Json                    // ReconciliationPolicy
  issuedAt         DateTime
  expiresAt        DateTime
  status           IntentStatus @default(OPEN)
  reconciledAt     DateTime?

  principal        Principal @relation(fields: [principalId], references: [id])
  agent            AgentIdentity @relation(fields: [agentId], references: [id])
  actuals          IntentActual[]

  @@index([principalId, status])
  @@index([agentId, issuedAt])
  @@index([expiresAt])  // for the expiry sweeper
}

model IntentActual {
  id               String   @id
  manifestId       String
  idempotencyKey   String                  // dedup at the actual level
  payloadJson      Json                    // ActualCallObservation
  observedAt       DateTime
  mismatchesJson   Json                    // IntentMismatch[]

  manifest         IntentManifest @relation(fields: [manifestId], references: [id])

  @@unique([manifestId, idempotencyKey])  // idempotency lock
  @@index([manifestId, observedAt])
}

enum IntentStatus {
  OPEN
  RECONCILED
  EXPIRED
}
```

## Invariant preservation (CLAUDE.md root)

| # | Invariant | How preserved |
| - | --------- | ------------- |
| 2 | Verify portability | Intent module is OUT of verify hot path. No new imports in `apps/api/src/modules/verify/`. Worker port unchanged. |
| 3 | Audit append-only | All three intent event kinds use existing `AuditService.append()`. No mutation of prior audit events. |
| 4 | No silent failures | `ReconciliationResult` is closed-enum; `IntentService` throws typed `AegisError` subclasses on failure; no swallowed catches. |
| 5 | Multi-tenant isolation | `principalId` carried on every `IntentManifest` row + every service method + every audit row + every BATE signal. |
| 6 | Denial precedence | No verify-path emission of `INTENT_MISMATCH` in Phase 2 (D3 above). Enum value is reserved-but-unemitted by hot path. |
| 7 | Contracts centrally owned | OpenAPI spec additions go in `docs/spec/AEGIS_API_SPEC.yaml`; Zod schemas in `packages/types`; DTOs in `apps/api/src/modules/intent/intent.dto.ts` use the canonical types. |
| 8 | SDKs runtime-portable | `@aegis/intent-manifest` already meets this (ADR-0016); intent module uses it as-is. |

## Rejected alternatives

- **Issuance embedded in `POST /v1/verify` response** (rejected option A
  for D1): would tie verify portability to issuance dependencies.
  Cloudflare Workers cannot host intent storage today.
- **Synchronous reconciliation at next verify** (rejected option A for
  D2): creates brittle ordering coupling; fails when multiple relying
  parties verify the same agent concurrently.
- **Intent declared in JWT claims** (not considered above; rejected
  here): bloats the 30-60s token; impossible to update reconciliation
  policy after issuance; no signed-manifest property for offline
  verification.
- **Per-tool-call separate verify token** (rejected): defeats the
  manifest abstraction. The whole point is ONE manifest covering N
  related calls in a 30-60s window.
- **Hard wire INTENT_MISMATCH into verify hot path in Phase 2**
  (rejected): operator can revisit in Phase 3 with edge-worker shadow
  mode; doing it pre-edge would require synchronous reconciliation
  (rejected via D2).

## Open operator decisions

- **OD-018** (NEW): default reconciliation strictness for newly-created
  principals — `strict` (locked per ADR-0016 D2) vs. operator override
  per-principal. Recommend: `strict` global default, operator opt-out
  via Principal-level setting added in Phase 2.1.

- **OD-019** (NEW): manifest TTL bounds. Should intent manifests share
  `TOKEN_TTL_*` (30-60s) bounds, or have their own wider envelope
  (e.g. up to 5min for treasury batch reconciliation)? Recommend:
  same bounds as verify tokens for Phase 2; widen in Phase 2.1 if
  treasury-vertical customers demand.

- **OD-020** (NEW): webhook delivery for `aegis.intent.mismatch_detected`
  — at-least-once with retry (Stripe-style) or at-most-once (no retry,
  loud failure)? Recommend: at-least-once with HMAC + dedup hint
  (Stripe pattern, matches existing M-008 webhook semantics).

## Consequences

Positive:
- Productionizes the intent-bound attestation surface that ADR-0016
  designed — agents and relying parties can use it within Phase 2.
- Verify hot path stays portable; no edge migration debt accrued.
- Existing audit chain naturally extends — third-party auditors can
  walk `intent.declared` → `intent.reconciled` chain alongside
  `verify.approved` events.
- Three new BATE signals improve trust-score signal density.

Negative:
- New Prisma schema (Phase 2.1) adds two tables — operator must accept
  the migration cost.
- In-memory storage in Phase 2.0 means manifest state is lost on API
  restart. Acceptable for the 30-60s manifest TTL — manifests issued
  before a restart will be unresolvable, callers MUST handle 404 on
  reconciliation.
- Three new operator decisions (OD-018/019/020) added to backlog.

## References

- ADR-0016 (intent manifest kernel)
- `packages/intent-manifest/` (Phase 0 kernel — already shipped)
- `apps/api/src/modules/verify/algorithm/` (port pattern template)
- ADR-0003 (Cloudflare Worker portability)
- ADR-0012 (policy engine port pattern — adapter layer template)
- M-049 (CF Worker shadow-mode rollout template for Phase 3)
- Testament Book I §3 (the tool-call wedge)
- Testament Book IV (financial verticals — ii commerce, iii treasury, iv broker-dealer)
- CLAUDE.md root invariants 2/3/4/5/6/7/8
