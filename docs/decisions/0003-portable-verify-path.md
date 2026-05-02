# ADR-0003 — Portable verify hot path

**Status**: accepted
**Date**: 2026-05-01

## Context

The Phase 3 plan (Q3 2026) is to lift `/v1/verify` to Cloudflare
Workers for global sub-80 ms p99 latency. The Phase 1 implementation
runs inside NestJS at Railway origin with a 200 ms p99 budget.

If the Phase 3 migration requires rewriting the verify logic in a
worker-flavored framework, we'll discover gaps between the two
implementations only at deploy time — exactly when the cost of a bug
is highest. We've all lived through "it worked in staging" outages.

## Decision

The full verify decision algorithm lives in
`apps/api/src/modules/verify/algorithm/verify.algorithm.ts` as a single
**framework-free function** over a `VerifyPorts` interface. Both the
NestJS adapter (`verify.service.ts`) and the future Cloudflare Worker
adapter (`workers/cf-verify`) implement `VerifyPorts` against their
respective I/O backends and call the same algorithm.

**Allowed imports in the algorithm file**: `@aegis/types` and
TypeScript primitives only.

**Forbidden imports in the algorithm file**:
- `@nestjs/*`
- `@prisma/client`
- `bullmq`, `ioredis`
- `node:*` (no Node-specific APIs)

A CI import-graph check (planned, see WORK_BOARD M-005 extension)
enforces this list.

## Consequences

### Positive
- Phase 3 migration becomes a deploy-target swap, not a rewrite. The
  CF Worker imports `verify.algorithm.ts` and supplies KV/Durable
  Objects implementations of the ports.
- The algorithm is unit-testable with in-memory fakes — no Postgres,
  Redis, or Nest TestingModule required. The spec runs in <100 ms.
- Behavior parity between origin and edge is **enforced by code
  re-use**, not by maintaining two parallel implementations.

### Negative
- Slight indirection cost — the Nest service can't reach into the
  algorithm's local state, so observability has to bubble through the
  ports. We use the `ports.now()` clock and metric-emission via
  side-effect ports.
- The `VerifyPorts` surface is a load-bearing contract; adding a new
  port is a breaking change for any third-party consumer (the CF
  Worker, future on-prem deployments).

### Neutral
- Open gap: as of 2026-05-01 the canonical `verify.ports.ts` imports
  `TrustBand` from `@prisma/client`, which technically violates the
  "no `@prisma/client` import" rule. Tracked as a follow-up — mirror
  the type into `@aegis/types` and drop the Prisma import. (See peer
  message log + agent review `docs/reviews/architecture-compliance.md`.)

## Alternatives considered

### Alt A: Two implementations (one Nest, one CF Worker), reconciled by tests
Tests detect drift but don't prevent it. Engineers under deadline
press will fix one side and not the other. Rejected.

### Alt B: A shared NPM package with the algorithm
Same effect as the current monorepo arrangement but with publish
overhead. Rejected for Phase 1 since the algorithm is internal.
Reconsider when we offer a self-host product (Enterprise tier).

### Alt C: Use NestJS everywhere (CF Workers can run NestJS via adapters)
The adapter cost dwarfs the latency budget at the edge. Rejected.

## How to reverse this decision

If Phase 3 lands and we decide we don't want the edge after all,
nothing has to be reversed — the algorithm continues to live in the
NestJS module and the workers/cf-verify directory simply remains
empty. The decision is forward-compatible by construction.

## References

- `apps/api/src/modules/verify/algorithm/verify.algorithm.ts`
- `apps/api/src/modules/verify/algorithm/verify.ports.ts`
- `CLAUDE.md` invariant § 2
- `docs/ARCHITECTURE.md` § "Why the verify path is portable"
- `infra/cloudflare/README.md`
- `docs/reviews/architecture-compliance.md` § Invariant 2 gaps
