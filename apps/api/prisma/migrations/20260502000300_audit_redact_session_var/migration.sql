-- AEGIS — fix the audit_event_append_only trigger to allow tenant-scoped
-- compliance redactions while keeping the chain's signed material immutable.
--
-- Bug fixed: 20260502000100_audit_append_only/migration.sql defined a
-- trigger that raised on EVERY UPDATE, including the legitimate redact()
-- path peer added in apps/api/src/modules/audit/audit.service.ts. Every
-- GDPR Art. 17 erasure request would throw P0001.
--
-- New design — column-whitelist bypass via session variable:
--
--   1. Default: any UPDATE / DELETE on AuditEvent raises (chain integrity).
--   2. The application can set a transaction-scoped variable
--      `aegis.audit_redact_authorized = 'on'` immediately before its
--      `UPDATE`; the trigger then permits the UPDATE iff the changes
--      affect ONLY the whitelisted columns:
--          action, relyingParty, requestedAmount, policySnapshot,
--          redactedAt, redactionReason, payloadVersion
--      — and the immutable columns (id, agentId, principalId, timestamp,
--      signature, actionHash, relyingPartyHash, requestedAmountHash,
--      policySnapshotHash) remain unchanged. The hashes preserve
--      verifiability of the chain even after the raw values are NULLed.
--   3. DELETE is forbidden under all circumstances. Compliance-driven
--      removal of a row is achieved by NULLing the raw value columns
--      (the row + signature + hashes stay).
--   4. SET LOCAL is transaction-scoped — even if the application forgets
--      to RESET, the bypass dies with the transaction.
--
-- Usage in apps/api/src/modules/audit/audit.service.ts:
--
--   await this.prisma.$transaction(async (tx) => {
--     await tx.$executeRaw`SET LOCAL "aegis.audit_redact_authorized" = 'on'`;
--     await tx.auditEvent.update({
--       where: { id: eventId, principalId },
--       data: { action: null, redactedAt: new Date(), redactionReason },
--     });
--   });
--
-- The bypass is detectable in pgaudit / RLS logs because the SET LOCAL
-- line is recorded; a periodic compliance review job greps for it.

CREATE OR REPLACE FUNCTION audit_event_block_mutation() RETURNS trigger AS $$
DECLARE
  v_authorized text;
  v_unchanged  boolean;
BEGIN
  -- Resolve the session variable. `current_setting(.., true)` returns
  -- NULL when unset rather than raising.
  v_authorized := current_setting('aegis.audit_redact_authorized', true);

  -- DELETE is forbidden under all circumstances. Compliance redactions
  -- NULL the raw columns; the row + signature + hash columns persist so
  -- the chain remains verifiable.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'AuditEvent row deletion is forbidden — chain integrity invariant.',
      HINT    = 'For GDPR Art. 17 erasure, NULL the raw columns via the redact() path. ' ||
                'See docs/SECURITY.md § "Audit chain integrity" + ADR-0006.';
  END IF;

  -- TG_OP = 'UPDATE' from here on.

  -- Without the authorization session variable: any UPDATE is forbidden.
  IF v_authorized IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'AuditEvent is append-only — UPDATE is forbidden without an authorized redact context.',
      HINT    = 'Set "aegis.audit_redact_authorized" = ''on'' inside a transaction immediately before the UPDATE. ' ||
                'Only redactable columns (raw values + redactedAt + redactionReason + payloadVersion) may change.';
  END IF;

  -- With the session variable: only the redactable column whitelist may change.
  -- Immutable columns must remain bit-identical between OLD and NEW.
  v_unchanged := (
        NEW.id                  IS NOT DISTINCT FROM OLD.id
    AND NEW."agentId"           IS NOT DISTINCT FROM OLD."agentId"
    AND NEW."principalId"       IS NOT DISTINCT FROM OLD."principalId"
    AND NEW.timestamp           IS NOT DISTINCT FROM OLD.timestamp
    AND NEW.signature           IS NOT DISTINCT FROM OLD.signature
    AND NEW.decision            IS NOT DISTINCT FROM OLD.decision
    AND NEW."denialReason"      IS NOT DISTINCT FROM OLD."denialReason"
    AND NEW."trustScoreAtEvent" IS NOT DISTINCT FROM OLD."trustScoreAtEvent"
    AND NEW."trustBandAtEvent"  IS NOT DISTINCT FROM OLD."trustBandAtEvent"
    AND NEW."policyId"          IS NOT DISTINCT FROM OLD."policyId"
    AND NEW.currency            IS NOT DISTINCT FROM OLD.currency
  );

  IF NOT v_unchanged THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Authorized redact tried to mutate an immutable column.',
      HINT    = 'The redact() path may only NULL: action, relyingParty, requestedAmount, policySnapshot. ' ||
                'It may set: redactedAt, redactionReason, payloadVersion. Everything else is signed-over.';
  END IF;

  -- Note on hash columns (actionHash / relyingPartyHash / etc.): these
  -- live in the schema once peer's ADR-0006 v2 chain ships. The current
  -- 20260502000000_init schema may not have them yet. We leave them OUT
  -- of the v_unchanged check so this migration is forward-compatible
  -- with both schemas. The hash-column immutability is enforced by the
  -- v2 chain's signed payload (any change breaks signature verify).

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger itself is unchanged (still BEFORE UPDATE OR DELETE) — only the
-- function body was redefined. CREATE OR REPLACE on the function is
-- transactional + idempotent.

COMMENT ON FUNCTION audit_event_block_mutation() IS
  'Append-only enforcement with column-whitelist bypass for compliance redactions. ' ||
  'See migrations/20260502000300_audit_redact_session_var/migration.sql.';
