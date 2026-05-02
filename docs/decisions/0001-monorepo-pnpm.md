# ADR-0001 — Monorepo with pnpm workspaces, no Turborepo (Phase 1)

**Status**: accepted
**Date**: 2026-05-01
**Deciders**: foundation session (sid=a9198691), modules session (sid=3e2203ee)

## Context

AEGIS spans an HTTP API (NestJS), a developer dashboard (Next.js), a
public TypeScript SDK, a future Python SDK, a future Cloudflare Worker
for the edge verify path, and shared types/configs. These artifacts
share a contract (`packages/types`) and we want one PR to be able to
update API + SDK + dashboard atomically when the contract changes.

The KLYTICS sister projects (CERNIQ, FORGE) already use pnpm
workspaces; staying on the same toolchain saves cross-project context-
switching for the operator.

## Decision

Single pnpm workspace at the repo root. `apps/*` and `packages/*` are
the two workspace roots. We use `pnpm -r` for cross-workspace tasks
(`build`, `test`, `lint`, `typecheck`). **No Turborepo** in Phase 1.

Per-app dependencies are declared in each `apps/<app>/package.json`;
shared dev tooling (TypeScript, Prettier, ESLint, Vitest) is hoisted at
the root.

## Consequences

### Positive
- Atomic PRs across API + SDK + dashboard.
- Zero learning cost — pnpm + `pnpm -r` is the operator's existing
  muscle memory.
- One lockfile (`pnpm-lock.yaml`) is the source of truth for all
  artifacts; CI uses `pnpm install --frozen-lockfile` everywhere.
- `workspace:*` protocol gives every package an instant path to the
  latest local version of its peers.

### Negative
- No remote build cache. CI builds everything from scratch on each run.
  At repo size today this is < 90 s; we revisit when it crosses 5 min.
- No task graph awareness. `pnpm -r build` runs in topological order
  via npm `dependencies`, not via explicit task DAG, so misconfigured
  inter-package dependencies show as build failures, not as missing
  edges.

### Neutral
- Adopting Turborepo or Nx later is mechanical (add `turbo.json`,
  prefix scripts) and reversible.

## Alternatives considered

### Alt A: Turborepo from day one
Strictly better build performance once the repo grows. Rejected for
Phase 1: extra config surface, extra dependency, no measurable benefit
at current size, operator has no Turborepo muscle memory yet.

### Alt B: Multi-repo (one repo per artifact)
Stronger version-isolation for the public SDK. Rejected: makes
contract changes a multi-PR ceremony, which kills development
velocity in the foundation phase. Reconsider when the SDK reaches v1.

### Alt C: Nx
Closer to Turborepo with stronger task graph. Rejected for the same
reasons as Turborepo plus a heavier opinion footprint.

## How to reverse this decision

Adding Turborepo: drop in a `turbo.json` with `pipeline` entries
mirroring the current `pnpm -r` scripts and update CI to call
`turbo run`. Reversible in one commit, no source-code changes.

Splitting to multi-repo: each `packages/*` and `apps/*` becomes its
own repo with a published version of `@aegis/types`. Affects every
PR workflow; do not undertake without an SDK v1 line in the sand.

## References

- pnpm workspace docs: https://pnpm.io/workspaces
- Sister project `~/Desktop/cerniq` uses the same convention.
- `pnpm-workspace.yaml` at repo root.
