-- ─────────────────────────────────────────────────────────────────────────
-- M-038: materialize the audit chain link on every row.
--
-- The Ed25519 signature on each AuditEvent already commits to the prior
-- row via `prev_hash = sha256(prev.signature || prev.id)`, so chain
-- integrity is cryptographically intact today. What was missing: the
-- (prevEventId, prevSignature) pair was COMPUTED at write time (by
-- looking up the latest row per agent) but NEVER PERSISTED.
--
-- Without these columns, the NDJSON export at
-- /v1/agents/{agentId}/audit/export.ndjson cannot emit the
-- (prevEventId, prevSignature) fields that @aegis/audit-verifier
-- requires on each `AuditEventRow`. External SOC2 auditors using the
-- canonical verifier CLI would have to re-walk chain order from
-- timestamps — fragile under timestamp ties, partial date-range
-- exports, or redaction meta-events that share a millisecond with
-- their target.
--
-- Backfill policy (per CLAUDE.md invariant #3, append-only):
--   - Pre-M-038 rows: prevEventId/prevSignature left NULL.
--   - The off-the-shelf verifier treats (NULL, NULL) as genesis-link.
--     For pre-M-038 rows this means the verifier reports a chain-link
--     mismatch starting at row #2 — that's accurate: those rows have
--     no recorded link.
--   - The signature column is unchanged, so the per-row signature
--     check still passes for legacy rows. The chain is downgraded to
--     "individually signed" for the pre-M-038 window, not invalidated.
--   - New rows written post-deploy stamp both columns. From the cut
--     onwards, full forward-walking chain verification passes.
--
-- Forensic note for auditors: the cut-over row per agent is identified
-- by `prevEventId IS NULL AND timestamp >= '<deploy-time>'` — i.e. it
-- looks like a genesis row but is not actually first in time. The
-- discovery doc at /.well-known/audit-signing-key SHOULD surface a
-- `chain_started_at` for each kid; that's a follow-on (OPERATOR-INPUT-
-- NEEDED in the discovery DTO).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "AuditEvent"
  ADD COLUMN "prevEventId"   TEXT,
  ADD COLUMN "prevSignature" TEXT;

CREATE INDEX "AuditEvent_prevEventId_idx" ON "AuditEvent" ("prevEventId");
