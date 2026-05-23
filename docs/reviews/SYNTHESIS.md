# Review swarm synthesis — 2026-05-01 (updated 2026-05-02)

> Single-page roll-up of the 4-agent enterprise review swarm spawned
> 2026-05-01 by sid=a9198691, **updated 2026-05-02** with fix status.
> Each agent's full report is linked below; this file is the executive
> view + assignment matrix.

## ⚡ Fix status (2026-05-02 evening)

**All 4 Criticals closed.** All but 4 Highs closed. Remaining work is
type-design polish + crypto-utility refactor for portability — none
are deploy blockers, all are tracked in the table below.

| Status         | Count | Items                                                                                               |
| -------------- | ----- | --------------------------------------------------------------------------------------------------- |
| ✅ Fixed       | 11    | C-1, C-2, C-3, C-4, H-3 (partial), H-4, H-5, H-7, H-9, T-1, T-5 + Prisma migrations                 |
| 🟡 Open (High) | 4     | H-1 crypto error opacity, H-2 BATE substring catch, H-6 DTO/Zod drift, H-8 crypto utils @Injectable |
| 🟡 Open (Med)  | 4     | M-1..M-5 (M-2 partially mitigated by peer's spend-guard rewrite)                                    |
| 🟡 Open (Type) | 1     | T-2 brand types (deferred — breaking change, needs SDK v1 plan)                                     |
| 🟡 Open (Cov)  | 12    | 6 untested services + 6 untested controllers — sprint owns                                          |

| Reviewer                | Output                                                     | Findings count         |
| ----------------------- | ---------------------------------------------------------- | ---------------------- |
| silent-failure-hunter   | [`silent-failures.md`](silent-failures.md)                 | 13 (3C / 5H / 5M)      |
| type-design-analyzer    | [`type-design.md`](type-design.md)                         | 8 issues, 3 top fixes  |
| code-reviewer           | [`architecture-compliance.md`](architecture-compliance.md) | 6 invariants assessed  |
| Explore (gap inventory) | [`coverage-gaps.md`](coverage-gaps.md)                     | 8 categories, 24 items |

---

## Critical — all fixed

| ID            | Finding                                                                         | Fix shipped                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-1           | Spend-guard fails OPEN on Redis miss                                            | **Peer fix** — spend-guard rewritten fail-closed, throws `ServiceUnavailableError` on outage                                                                                               |
| C-2           | BATE `report` cross-tenant trust manipulation                                   | **Peer fix** — `bate.controller` now scopes by caller's principalId before mutation                                                                                                        |
| C-3           | Policy public-key derivation generates random keypair when only PRIVATE env set | **2026-05-02 sid=a9198691** — `policy.module.ts` now derives pubkey from priv via `ed.getPublicKeyAsync`, errors loudly on mismatch with explicit env, refuses ephemeral key in production |
| C-4           | Verify denial audit `.catch(() => undefined)`                                   | **Peer fix** — `recordAudit` now awaited, returns `auditEventId` for response embed; **2026-05-02 sid=a9198691** completed companion `touchAgent` log + metric                             |
| CRIT-3 (peer) | JWT `jti` parsed but never persisted — replay window                            | **Peer fix** — `ReplayCacheService` + algorithm Step 3.5 with fail-closed → ANOMALY_FLAGGED on Redis outage                                                                                |
| CRIT-5 (peer) | `principalId='unknown'` fabrication on denied-audit rows                        | **Peer fix** — algorithm `deny()` takes `relyingPartyPrincipalId` from input, fabrication eliminated                                                                                       |

## High

| ID  | Finding                                                                 | Status                                                                                                                   |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| H-1 | Crypto utils collapse all errors → `false`/`null`                       | 🟡 OPEN — needs discriminated `{kind:'ok'\|'malformed'\|'bad_sig'\|'expired'\|'crypto_error'}` return type               |
| H-2 | BATE `ingestSignal` swallows non-uniqueness errors with substring match | 🟡 OPEN — match on `Prisma.PrismaClientKnownRequestError.code === 'P2002'` instead                                       |
| H-3 | Cache writes silently fail; no `cache_set_failed_total` metric          | ✅ Partial fix 2026-05-02 — counter added to MetricsService + wired into `loadAgent` / `loadPolicy` / `touchAgent` paths |
| H-4 | `touchAgent` empty `.catch(() => undefined)`                            | ✅ Fixed 2026-05-02 — logged warn + metric increment                                                                     |
| H-5 | Audit `append` chain-fork race                                          | ✅ Peer fix — advisory lock added in `audit.service`                                                                     |
| H-6 | DTO ↔ Zod drift                                                         | 🟡 OPEN — adopt `nestjs-zod` to derive DTOs from Zod                                                                     |
| H-7 | `verify.ports.ts` imports `TrustBand` from `@prisma/client`             | ✅ Peer fix — `TrustBand` now defined locally in `verify.ports.ts`                                                       |
| H-8 | `apps/api/src/common/crypto/*` are `@Injectable()`                      | 🟡 OPEN — extract pure-fn modules; thin Nest wrappers                                                                    |
| H-9 | Verify algorithm missing `TRUST_SCORE_TOO_LOW` + `ANOMALY_FLAGGED`      | ✅ Peer fix — Steps 8 + 9 in algorithm; `minTrustScore` in input; `agent.flagged` checked                                |

## Medium / Type design

| ID  | Finding                                                                                                                                        | File                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| M-1 | `JwtUtil.decodeUnsafe` empty catch — first step of verify; loses attack-shape signal                                                           | `common/crypto/jwt.util.ts:89-98`                  |
| M-2 | `recordSpend` Postgres + Redis writes share `Promise.all` → silent DB↔cache drift on partial failure                                           | `modules/verify/spend-guard.service.ts:94-100`     |
| M-3 | Spend recording fire-and-forget without DLQ — financial counter, deserves the same DLQ as audit                                                | `modules/verify/verify.service.ts:78-82`           |
| M-4 | Verify denial path fabricates `principalId: 'unknown'`, `trustScore: 0`, `trustBand: 'FLAGGED'` — synthetic placeholders pollute audit queries | `modules/verify/verify.service.ts:108-114`         |
| M-5 | `policy.service` `as any` cast on token payload — bypasses type system on signing surface                                                      | `modules/policy/policy.service.ts:73-79`           |
| T-1 | `VerifyResponse` lacks discriminated union on `valid` — `valid:true + denialReason:set` is representable                                       | `packages/types/src/schemas.ts:166-178`            |
| T-2 | Identifiers (`agentId`, `principalId`, `policyId`) are unbranded `string` — SDK can pass one where another is required, no compile error       | `packages/types/src/schemas.ts:17-19`              |
| T-3 | `CerniqError` lacks typed `details<TDetails>`, `retryable: boolean`, `requestId` — SDK consumers forced into chained `instanceof` checks       | `apps/api/src/common/errors/cerniq-error.ts:17-25` |
| T-4 | `PolicyScope` missing `validFrom <= validUntil` cross-field refinement                                                                         | `packages/types/src/schemas.ts:73-81`              |
| T-5 | `denialReasonRank()` helper missing — relying parties can't ask "is X higher precedence than Y?" without re-implementing                       | `packages/types/src/constants.ts:53-63`            |

## Coverage gaps

| Category             | Status                                                                                                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Untested services    | 🟡 OPEN — 6 services still need `.spec.ts` (audit, identity, policy, bate, webhooks, api-key)                                                                                                                                                                                                              |
| Untested controllers | 🟡 OPEN — 6 controllers still need `.spec.ts`                                                                                                                                                                                                                                                              |
| Empty module dirs    | 🟡 OPEN — `principals/` directory should be deleted                                                                                                                                                                                                                                                        |
| Dead schema exports  | 🟡 OPEN — audit and remove unused exports                                                                                                                                                                                                                                                                  |
| Prisma migrations    | ✅ FIXED 2026-05-02 — `20260502000000_init/migration.sql` (374 lines) generated via `prisma migrate diff`; `migration_lock.toml` committed; **bonus** `20260502000100_audit_append_only/migration.sql` adds DB-level trigger blocking UPDATE/DELETE on `AuditEvent` (closes Invariant 3 storage-layer gap) |
| `pnpm-lock.yaml`     | (peer ran `pnpm install`; lockfile present)                                                                                                                                                                                                                                                                |
| TODO/FIXME markers   | 1 (cf-verify worker)                                                                                                                                                                                                                                                                                       |

## Invariant compliance scorecard (updated 2026-05-02)

| Invariant                                   | Status      | Notes                                                                                                      |
| ------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| 1 · Private keys never enter CERNIQ         | **PASS**    | Soft gap remains — `identity.service.ts` could add a challenge-response handshake                          |
| 2 · Portable verify hot path                | ⬆ MOSTLY    | H-7 fixed (TrustBand local); H-8 still open (crypto utils still `@Injectable`)                             |
| 3 · Audit log append-only and signed        | ✅ **PASS** | H-5 fork race fixed by peer (advisory lock) + 2026-05-02 audit_append_only migration adds DB-trigger guard |
| 4 · No silent failures, no fabricated data  | ⬆ MOSTLY    | C-1, C-4, H-4, M-4 all closed; H-2 (BATE substring catch) still open                                       |
| 5 · Multi-tenant isolation by `principalId` | ✅ **PASS** | C-2 fixed; CRIT-5 fabrication fixed                                                                        |
| 6 · Denial precedence is fixed              | ✅ **PASS** | H-9 closed; T-5 `denialReasonRank()` helper exported for downstream use                                    |

## Remaining fix queue (post-2026-05-02 patch pass)

1. **H-6 DTO ↔ Zod split-brain** — adopt `nestjs-zod`, derive DTOs from
   `packages/types` schemas via `createZodDto` + `ZodValidationPipe`,
   regenerate Swagger via `zod-to-openapi`. ~100 LOC, ~2 h. Eliminates
   the 8 measured drift items in one move.
2. **H-8 crypto utils portability** — extract `apps/api/src/common/crypto/*`
   into framework-free pure-fn modules; keep the existing classes as thin
   `@Injectable()` wrappers. Unblocks the CF Worker to import the byte-level
   primitives directly. ~150 LOC, ~3 h.
3. **H-1 crypto error opacity** — `JwtUtil.verifyAndDecode` returns a
   discriminated union (`'ok' | 'malformed' | 'bad_sig' | 'expired' | 'crypto_error'`)
   so a noble-lib bug isn't silently mapped to "attacker forged the
   signature". ~50 LOC, ~1 h.
4. **Coverage backfill** — `.spec.ts` files for the 6 untested services
   - 6 untested controllers, prioritise `AuditService`, `ApiKeyService`,
     `VerifyController`. ~300 LOC, ~4 h.
5. **H-2 BATE Prisma substring catch** — switch to typed
   `Prisma.PrismaClientKnownRequestError.code === 'P2002'` check; route
   non-idempotency errors to a `bate:dlq` BullMQ queue. ~30 LOC, ~30 min.

Estimate after this turn: **~9 h** to close H-1, H-2, H-6, H-8 + the
coverage backfill. Nothing on this list is a deploy blocker — every
Critical and the chain-integrity High are closed.

## What this swarm did NOT cover

- Performance under load (the `verify.k6.js` test exists now —
  `apps/api/test/load/` — but hasn't been run; budget claim is unverified
  until a fixture is seeded and the test runs).
- Cross-language SDK parity (Python SDK exists per peer but wasn't
  audited against TypeScript SDK behavior).
- Dashboard UX or accessibility.
- Stripe billing integration (M-011 still open).
- BATE anomaly detector rules R-1..R-5 (M-007 still partial).

## Ownership map

- All findings in code under `apps/api/src/modules/{verify, audit,
bate, policy, identity, webhooks, auth}` and `apps/api/src/common/`
  → owned by sid=3e2203ee (peer is in active drift-resolution sprint).
- Findings in `packages/types/`, `packages/sdk-ts/` → owned by peer.
- Findings about coverage / fixtures / migrations → next session to
  pick up off the WORK_BOARD.
