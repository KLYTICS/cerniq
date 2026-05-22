# OKORO Workers - Claude contract

This directory owns edge surfaces, especially the Cloudflare Worker port of the
verify hot path. The worker exists to make `/v1/verify` globally low-latency
without changing OKORO security semantics.

## Edge rules

- Preserve origin verify semantics exactly: denial precedence, signature
  validation, policy checks, spend behavior, trust-score interpretation, and
  audit expectations cannot drift.
- Keep code Worker-compatible. No Node-only APIs, no NestJS imports, no Prisma,
  no filesystem assumptions, and no long-lived local process state.
- Prefer shared pure logic and shared types over copying origin code.
- KV/cache reads must define staleness, invalidation, and revocation behavior.
- Fail closed for verification decisions unless a documented design says a
  specific dependency failure should degrade in a safer way.
- Any edge optimization must include a parity test against the origin algorithm.

## Required verification

- Worker typecheck: `pnpm --filter @okoro/cf-verify typecheck`
- Worker lint: `pnpm --filter @okoro/cf-verify lint`
- Cross-package parity: `pnpm test:parity`

Deployment remains phase-gated. Do not bypass the `deploy` script guard unless
the operator explicitly opens the Phase 3 release path.
