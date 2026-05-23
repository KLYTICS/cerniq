# 0001 — Primary key format: CUID vs ULID

- **Status**: Accepted (provisional — re-evaluate before public launch)
- **Date**: 2026-05-01
- **Decision drivers**: developer ergonomics, time-sortability, ecosystem support

## Context

The CERNIQ spec (`docs/spec/01_MASTER.md` § 2.2) uses ULIDs for `agentId`,
`policyId`, etc. Prisma's `@id @default(cuid())` is the canonical Prisma
shortcut. The two diverge:

- **ULID**: 26 chars, base32, time-sortable, monotonic per millisecond.
- **CUID2**: 24 chars, base36, randomly distributed (not time-sortable).

The spec calls for ULIDs because:

1. Public IDs benefit from time-sort for support / debugging.
2. Index locality on time-sorted IDs improves Postgres B-tree performance for "recent activity" queries (audit log scans).
3. The verify hot-path benefits from monotonic IDs in the agent token's `jti`.

## Decision

**Use `@default(cuid())` for primary keys, but expose a public-facing
prefix layer that we control independently.** Public IDs look like
`agt_<26 chars>`, `pol_<26 chars>` — we pick the format we want without
being coupled to the DB primary key choice.

For audit events specifically, we additionally store a ULID in `jti` /
`eventId` for time-ordered queries.

## Why not switch entirely to ULID at the DB level?

- Prisma's `@default(cuid())` is built-in; ULID requires a custom default
  that runs in app code (which we'd have to thread carefully through every
  raw query).
- The spec mentions ULID-shaped public IDs (`agt_01HZ9YZXM4QT3B7P8WKJD6R5V`)
  but that's the _display format_, not necessarily the storage format.
  We can produce that display format from a CUID-keyed row by adding a
  `publicId` column.
- Switching DB-level keys later requires a migration that's straightforward
  if we maintain the prefix layer from day one.

## Why not switch entirely to ULID at the public layer too?

- Time-sortable public IDs leak issuance velocity (an attacker who sees
  agent IDs over time can estimate our per-day registration rate). For a
  free tier we may want this; for enterprise we may not. CUID2's randomness
  side-steps the leak.
- This isn't a high-stakes call but warrants a deliberate choice.

## Consequences

- Codebase uses `cuid()` everywhere PK is involved.
- Public IDs are constructed at the controller layer, e.g. `agt_${cuid()}`.
- Audit `eventId` and JWT `jti` use `ulid()` from the `ulid` package.
- A future ADR may revise this decision; the migration cost is bounded
  because public IDs are stable across DB key changes.

## Trigger to revisit

- We hit B-tree fragmentation issues on large audit-event tables.
- A customer specifically requests ULID-shaped public IDs across the API.
- We want to enable cross-region replication where time-sortable IDs simplify conflict resolution.
