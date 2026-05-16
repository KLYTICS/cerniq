# @aegis/intent-manifest

> **Status: kernel locked (Phase 1).** All three operator decisions
> resolved 2026-05-15 (see ADR-0016). Wiring INTENT_MISMATCH into the
> wire-level surfaces is a separate ADR-tracked commit; runtime
> issuance into the verify hot path remains gated on Phase 2.

Pre-declared intent + reconciliation kernel for AEGIS verify tokens.

## Why it exists

The May-2026 agentic-landscape audit (see `docs/SESSION_HANDOFF.md`)
identified **intent-bound attestation** as gap #5: no platform vendor is
structurally incentivized to bind verify tokens to declared intent.
AEGIS owns this surface because it already sits at the tool-call
checkpoint and already signs only what it observed (CLAUDE.md root
invariant — Testament Book I §3).

This package ships:

1. `IntentManifest` — signed declaration of what an agent intends to do
   in the next bounded window (issued alongside the verify token).
2. `signManifest` / `verifyManifest` — Ed25519 primitives, edge-runtime
   safe, byte-compatible canonical pre-image with `@aegis/audit-verifier`.
3. `reconcileIntent` — pure function that walks `actuals` against a
   manifest and returns a typed `ReconciliationResult` with a closed-enum
   mismatch list.

Zero NestJS / DI / framework imports — ports to Cloudflare Workers
(invariant #2 — verify portability).

## Invariant alignment

| Invariant                          | Status                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| #2 verify portability              | Pure TS, only `@noble/ed25519` + `@noble/hashes`. No Node-only APIs.                                     |
| #3 audit append-only               | Manifests are signed at issuance and never mutated. Reconciliation outcomes become new audit events.    |
| #4 no silent failures              | `IntentMismatchKind` is closed; `assertNever` enforces exhaustiveness; `VerifyResult` is typed union.   |
| #5 multi-tenant isolation          | `principalId` carried on every manifest body.                                                            |
| #6 denial precedence stability     | Currently emits placeholder `INTENT_MISMATCH_TBD`. See Operator decisions §3.                            |

## Operator decisions (locked 2026-05-15 — ADR-0016)

| # | Decision | Locked outcome |
|---|----------|----------------|
| 1 | IntentClaim envelope shape | **Keep all three** — `http-call`, `commerce-action`, `tool-invocation`. Each maps to a distinct adoption wedge (Testament IV §i-iii). Operator may deprecate via issuance-side rejection in a future 1.x release without changing the type union. |
| 2 | Reconciliation strictness default + `graduated` semantics | **Default `strict`**. `graduated` tolerates over-call-count up to `floor(maxCalls * 1.2)` (20% default); non-count mismatches (`wrong-merchant`, `over-amount-cap`, `wrong-method`, `wrong-endpoint`, `arg-shape-mismatch`) are always strict regardless of tolerance. |
| 3 | `INTENT_MISMATCH` denial-reason placement | **Append at end** of `DENIAL_REASON_PRECEDENCE` in `@aegis/types` (after `ANOMALY_FLAGGED`). Append-safe per CLAUDE.md invariant 6 — no API minor bump. Mirrored byte-identically in `apps/api/src/modules/verify`, `packages/verifier-rp`, `docs/spec/AEGIS_API_SPEC.yaml`, and the cross-package parity test. |

## Build & test

```sh
pnpm --filter @aegis/intent-manifest typecheck
pnpm --filter @aegis/intent-manifest test
pnpm --filter @aegis/intent-manifest build
```

## What this package is NOT

- **Not** a policy engine. Policies bound what an agent is *allowed* to
  do over a long window (days); intent manifests bound what they
  *declared* they would do in the next 30-60 seconds.
- **Not** an audit chain. Reconciliation outcomes generate audit events
  consumed by `apps/api/src/modules/audit`, but the kernel itself
  emits no IO.
- **Not** a verify hot-path mutation. Wiring into `/v1/verify` is a
  separate ADR-tracked change gated on the three decisions above.

## Status

Phase 0 (this commit):
- Package skeleton, signing primitives, reconciliation kernel, ~12 tests.
- Three `USER-INPUT-NEEDED` decision points clearly marked.
- Zero impact on existing services — `apps/api` does not import this yet.

Phase 1 (gated on operator decisions):
- Lock `IntentClaim` shape, lock strictness defaults, lock denial reason.
- Add to `packages/types` Zod schemas + wire `INTENT_MISMATCH` into
  precedence (if option (a) or (c)).
- Cross-package parity test.

Phase 2 (gated on Phase 1):
- Wire issuance into `apps/api/src/modules/verify/...` behind
  `AEGIS_INTENT_MANIFEST_ENABLED` env flag.
- Optional CLI subcommand `aegis-intent-verify <signed.json>`.
- Reconciliation outcomes audited via `audit.service.ts`.
