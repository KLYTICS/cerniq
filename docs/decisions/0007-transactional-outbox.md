# ADR-0007 — Transactional outbox for audit-or-bust SOC2 invariant

**Status**: accepted
**Date**: 2026-05-02
**Audit ref**: F-003 / F-006 in `docs/reviews/silent-failures.md`; SECURITY.md §9 (T-5 audit gap)

## Context

CLAUDE.md invariant #4 (no silent failures) and SECURITY.md § Audit chain
integrity require that EVERY verify decision lands in the audit chain.
The 2026-Q2 silent-failure audit found three vectors where the verify
hot path fired-and-forgot critical durable writes:

1. **Audit on denied verify** — `verify.service.ts:107` had `.catch(() =>
undefined)`. Fixed in CRIT-3 wiring (audit append is now awaited
   inside the algorithm).
2. **Spend record on approved verify** — Postgres write was racing with
   Redis increment in `Promise.all`. Fixed in audit ae59f056 (Postgres
   write happens first; Redis is best-effort).
3. **BATE signal ingest** — still fire-and-forget at the algorithm
   boundary. A Postgres or Redis flap during a verify-approval window
   loses the signal. Webhook enqueue has a similar weakness at the
   subscription-publish boundary.

Cases #1 and #2 are now durable; #3 remains.

## Decision

Add a Postgres-backed transactional outbox that callers in the verify
hot path use as a deferred side-effect mailbox. The outbox row is
written inside the SAME `prisma.$transaction` as the primary state
change (e.g. audit append). A separate `OutboxWorker` drains the
table, performs the side-effect (BATE ingest, webhook delivery), and
marks the row processed.

This converts BATE signal loss + webhook enqueue loss from
"fire-and-forget" (lossy on Redis or queue down) into "at-least-once
with eventual consistency" (lossy only if Postgres itself loses data,
which is the same trust boundary as the audit chain).

### Schema (`OutboxEvent`)

```prisma
model OutboxEvent {
  id          String   @id @default(cuid())
  kind        String   // BATE_SIGNAL | WEBHOOK_DELIVERY | ...
  payload     Json
  // Concurrency control: workers SET lockedAt + lockedBy in a SELECT
  // FOR UPDATE SKIP LOCKED query, so multiple workers can drain the
  // table in parallel without double-processing.
  lockedAt    DateTime?
  lockedBy    String?
  // Bookkeeping
  attempts    Int      @default(0)
  lastError   String?
  // Set when a worker successfully processed the row.
  processedAt DateTime?
  createdAt   DateTime @default(now())

  @@index([processedAt, lockedAt, createdAt])
  @@index([kind])
}
```

The composite index `(processedAt, lockedAt, createdAt)` is the
worker's drain query: `WHERE processedAt IS NULL AND (lockedAt IS NULL
OR lockedAt < now() - lockTtl) ORDER BY createdAt LIMIT N`. Postgres
returns rows in insertion order, which is the strongest ordering
guarantee we need.

### Worker semantics

- **At-least-once**: the worker re-runs handlers on retry. Handlers
  must be idempotent. BATE signal ingest already uses
  `idempotencyKey`; webhook delivery uses `(subscriptionId, eventId)`.
- **Lease lock**: 30-second lease via `lockedAt`. Worker that crashes
  mid-process loses the lease and another worker picks the row up.
- **Backoff**: exponential, capped at 5 minutes. After 8 attempts (per
  OD-005 webhook-DLQ parity), row stays in the table with
  `processedAt: null` and `lockedAt: null` for manual triage —
  surfaced in the dashboard as a DLQ list.

### Caller pattern

```ts
await this.prisma.$transaction(async (tx) => {
  await this.audit.appendInTx(tx, auditInput);
  await this.outbox.enqueueInTx(tx, 'BATE_SIGNAL', signalPayload);
});
```

Both writes commit atomically. If either fails, neither lands.

## Consequences

### Pros

- Audit-or-bust SOC2 invariant satisfied: BATE signals are now bound
  to the same transaction as the audit row. No more "verify approved
  but BATE never saw it" gap.
- Webhook delivery becomes durable: the publish-side enqueue is now
  the same transaction as the underlying state change (e.g. trust-
  band crossing).
- DLQ is a real Postgres table — operators can `SELECT *` to triage,
  not a Redis sorted-set requiring custom tooling.

### Cons

- Adds one Postgres write per verify approval (negligible — verify is
  already 1–2 writes).
- Requires a worker process drain — coupled to the existing BullMQ
  worker bootstrap (`apps/api/src/workers/main.ts`). No new process
  required, just a new BullMQ queue and a polling drain.
- Polling adds a few-hundred-millisecond latency floor on async
  work. Acceptable for BATE recompute (already debounced 1 s) and
  webhook delivery (no SLO < 1 s).

### Migration

Single additive migration: `CREATE TABLE OutboxEvent`. No data
migration; existing rows on the BullMQ side are not touched.

## Out of scope

- Outbox for the audit append itself — already covered by
  `prisma.$transaction` with `pg_advisory_xact_lock` (ADR-0005 +
  audit-fix work). The chain is durable in-tx.
- Cross-region replication of the outbox — handled by Postgres's own
  WAL replication; no CERNIQ-side work.

## References

- SECURITY.md § Audit chain integrity § T-5
- `docs/reviews/silent-failures.md` F-003, F-006
- "Pattern: Transactional Outbox" — Microservices.io
