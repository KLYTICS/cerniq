-- AEGIS — enforce audit-chain append-only at the storage layer.
--
-- Closes the Invariant 3 (Audit log is append-only) gap surfaced by
-- the 2026-05-01 architecture-compliance review:
--
--   "No DB-level guard against UPDATE/DELETE on AuditEvent. The
--    invariant is enforced by code convention only — a future
--    regression or a direct admin connection can corrupt the chain
--    silently."
--
-- Strategy: a BEFORE UPDATE OR DELETE trigger that raises an exception.
-- The trigger is owned by the migration role, not the application role
-- (apps connect as `aegis_app` per infra/docker/postgres-init.sql), so
-- the trigger cannot be silently dropped from the application path.
--
-- Bypass procedure: in the rare case we genuinely must amend an audit
-- record (GDPR Article 17 erasure of personal data referenced in
-- payload) the migration owner connects as the schema owner and runs
-- `ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_event_append_only`,
-- performs the change, re-enables the trigger, and emits an
-- `aegis.compliance.audit_amendment` event. The amendment is itself
-- audited.

CREATE OR REPLACE FUNCTION audit_event_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'AuditEvent is append-only — UPDATE/DELETE is forbidden by chain integrity invariant.',
    HINT    = 'See docs/SECURITY.md § "Audit chain integrity". To perform a compliance-driven amendment, ' ||
              'temporarily DISABLE TRIGGER audit_event_append_only from the schema owner role and emit an ' ||
              'aegis.compliance.audit_amendment event for the change.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_event_append_only ON "AuditEvent";

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW
  EXECUTE FUNCTION audit_event_block_mutation();

-- Smoke verification (will fail the migration if the trigger isn't enforced):
--   The DO block runs as the migration owner, who can't bypass the trigger
--   without explicit DISABLE — same as production paths.
DO $$
DECLARE
  v_id text;
BEGIN
  -- Skip the smoke check if no rows exist yet (fresh DB); the trigger will
  -- be exercised by integration tests instead.
  SELECT id INTO v_id FROM "AuditEvent" LIMIT 1;
  IF v_id IS NOT NULL THEN
    BEGIN
      UPDATE "AuditEvent" SET action = action WHERE id = v_id;
      RAISE EXCEPTION 'Append-only trigger failed to engage on UPDATE.';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%append-only%' THEN
        RAISE;
      END IF;
    END;
  END IF;
END;
$$;
