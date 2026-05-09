-- ─────────────────────────────────────────────────────────────────────────
-- Enterprise backbone schema additions (Sprint S2 / M-026)
--
-- Backs ADRs 0008-0013:
--   * signingKeyId on every signed record   (ADR-0011)
--   * relyingPartyId FK on AuditEvent       (ADR-0008 §4)
--   * policyEngineId + engineMetadata audit (ADR-0012)
--   * AgentPolicy.signedTokenKeyId          (ADR-0011)
--   * Principal.policyEngine                (ADR-0012 §3)
--   * Principal.idpDomain                   (ADR-0009 §2)
--   * BateSignalType DPoP additions         (ADR-0010 / M-024)
--
-- Idempotent. Backfill values are conservative defaults so the live
-- audit chain remains verifiable across the cut.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. AuditEvent additions ----------------------------------------------------
ALTER TABLE "AuditEvent"
  ADD COLUMN "signingKeyId"   TEXT NOT NULL DEFAULT 'kid-genesis-v1',
  ADD COLUMN "policyEngineId" TEXT,
  ADD COLUMN "engineMetadata" JSONB,
  ADD COLUMN "relyingPartyId" TEXT;

-- Backfill historical rows so the FK addition below doesn't fail:
-- pre-S2 events have no relyingPartyId; that's expected.
CREATE INDEX "AuditEvent_signingKeyId_idx"   ON "AuditEvent" ("signingKeyId");
CREATE INDEX "AuditEvent_relyingPartyId_idx" ON "AuditEvent" ("relyingPartyId");

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_relyingPartyId_fkey"
  FOREIGN KEY ("relyingPartyId") REFERENCES "RelyingParty" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. AgentPolicy.signedTokenKeyId -------------------------------------------
ALTER TABLE "AgentPolicy"
  ADD COLUMN "signedTokenKeyId" TEXT;

-- 3. Principal.policyEngine + idpDomain -------------------------------------
ALTER TABLE "Principal"
  ADD COLUMN "policyEngine" TEXT NOT NULL DEFAULT 'builtin',
  ADD COLUMN "idpDomain"    TEXT;

CREATE INDEX "Principal_policyEngine_idx" ON "Principal" ("policyEngine");

-- 4. BateSignalType: add DPoP signals ---------------------------------------
ALTER TYPE "BateSignalType" ADD VALUE IF NOT EXISTS 'AGENT_NO_DPOP';
ALTER TYPE "BateSignalType" ADD VALUE IF NOT EXISTS 'AGENT_DPOP_REPLAY_ATTEMPT';

-- ─────────────────────────────────────────────────────────────────────────
-- Verification queries (run by CI to confirm migration applied cleanly):
--
--   SELECT COUNT(*) FROM "AuditEvent" WHERE "signingKeyId" IS NULL;
--      → expect 0
--   SELECT enumlabel FROM pg_enum
--      WHERE enumtypid = '"BateSignalType"'::regtype
--      AND enumlabel IN ('AGENT_NO_DPOP', 'AGENT_DPOP_REPLAY_ATTEMPT');
--      → expect 2 rows
-- ─────────────────────────────────────────────────────────────────────────
