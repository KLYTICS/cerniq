# apps/api/src/modules/intent — Phase 2 runtime issuance

> Status: Phase 2.0 (memory adapter). Behind `AEGIS_INTENT_MANIFEST_ENABLED=true` env flag. NOT registered in `app.module.ts` until operator flips. See ADR-0017.

Runtime issuance + reconciliation for `@aegis/intent-manifest` (the Phase 0 kernel landed via ADR-0016).

## Surface

- `POST /v1/intent` — issue a signed `IntentManifest` for an agent, bound to a verify-token jti.
- `POST /v1/intent/{manifestId}/actuals` — reconcile observed actuals against the stored manifest. Requires `Idempotency-Key` header.
- `GET /v1/intent/{manifestId}` — read the stored manifest + reconciliation outcome.

## Module shape (mirrors `apps/api/src/modules/verify/algorithm/` pattern)

| File | Responsibility |
| ---- | -------------- |
| `intent.ports.ts` | Framework-free port interface; algorithm I/O contracts; typed `IntentAlgorithmException`. |
| `intent.algorithm.ts` | Pure issuance + reconciliation. Zero NestJS / Prisma / Redis imports. Cloudflare-Workers-portable per invariant #2. |
| `intent.algorithm.spec.ts` | Jest tests for the pure algorithm with an in-memory port fixture. |
| `intent.adapter.memory.ts` | In-memory storage adapter (Phase 2.0). Process-local; lost on restart. |
| `intent.dto.ts` | Nest DTOs (class-validator + swagger decorators). |
| `intent.service.ts` | Nest service: orchestration + logging; delegates all decisions to the algorithm. |
| `intent.controller.ts` | REST controller: principal extraction, agent-tenant assertion, `IntentAlgorithmException → AegisError` translation. |
| `intent.module.ts` | Conditional Nest module (`forRoot()`). Wires the memory adapter to `AuditSignerService` + `AuditService` + `BateService`. |
| `intent.constants.ts` | DI symbols + env flag names. |
| `README.md` | This file. |

## Activation

```bash
# enable the module in app.module.ts (operator decision)
export AEGIS_INTENT_MANIFEST_ENABLED=true
export AEGIS_INTENT_MANIFEST_STORAGE=memory  # 'prisma' in Phase 2.1
```

Then in `app.module.ts`:

```ts
imports: [
  // ... existing modules ...
  ...(process.env.AEGIS_INTENT_MANIFEST_ENABLED === 'true'
    ? [IntentModule.forRoot()]
    : []),
],
```

## Invariant alignment (CLAUDE.md root)

| # | Invariant | How preserved |
| - | --------- | ------------- |
| 2 | Verify portability | Pure algorithm under `intent.algorithm.ts`; Nest adapter under `intent.adapter.memory.ts` + `intent.module.ts`. Algorithm imports nothing framework-shaped. |
| 3 | Audit append-only | All 3 event kinds (`intent.declared`, `intent.reconciled`, `intent.mismatch`) flow through `AuditService.append()`. Manifests are never mutated after issuance; reconciliation outcomes are new audit rows. |
| 4 | No silent failures | `IntentAlgorithmException` is closed-enum; service logs + re-throws; controller translates to `AegisError` family. The single permitted swallow is BATE signal ingestion failure (audit row is the durable evidence; signal is best-effort) — and it's WARN-logged, not silently dropped. |
| 5 | Multi-tenant isolation | `principalId` carried on every algorithm input, every port call, every audit row. Controller pre-checks agent ownership before invoking service. Tenant-mismatch collapses to 404 (anti-enumeration). |
| 6 | Denial precedence | This module does NOT emit `INTENT_MISMATCH` on the verify wire response. `recommendedDenialReason` in `ReconcileResponseDto` is the module's OWN response field — a suggestion to the relying party. Verify-wire emission is reserved for Phase 3 edge integration (ADR-0017 D3 clarification). |
| 7 | Contracts centrally owned | `IntentClaim` + `SignedIntentManifest` shapes live in `@aegis/intent-manifest`; DTOs are thin Nest representations. |

## Storage roadmap

- **Phase 2.0 (this commit)**: memory adapter. Manifest state ephemeral. Acceptable for the 30-60s TTL envelope when operator validates the feature pre-production-traffic.
- **Phase 2.1**: Prisma adapter behind same `INTENT_PORTS` DI symbol. Schema additions in ADR-0017 §"Schema additions". Storage env flag swaps adapter. Background expiry sweeper for cold-archive.
- **Phase 3**: Edge port at `workers/cf-verify/src/intent.ts` — read KV-cached manifest state, emit synchronous `INTENT_MISMATCH` denial. Shadow-mode rollout per M-049 pattern.

## Testing

```bash
pnpm --filter @aegis/api test -- --testPathPattern=modules/intent
pnpm --filter @aegis/api typecheck
```

Algorithm spec is the primary correctness gate. Service/controller specs gate the Nest adaptation. E2E specs (Phase 2.1) gate the full HTTP surface.

## Open operator decisions (block Phase 2.1+)

- **OD-018** — default reconciliation strictness; recommend `strict` global default + per-principal override.
- **OD-019** — manifest TTL bounds; recommend same as verify token (30-60s) initially.
- **OD-020** — webhook delivery semantics for `aegis.intent.mismatch_detected`; recommend at-least-once HMAC (matches M-008).
