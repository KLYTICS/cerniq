-- CERNIQ — rename DB-level okoro* objects to cerniq*.
--
-- This is the SECOND rename migration. The first
-- (20260521000000_rename_aegis_to_okoro) renamed aegis_* → okoro_*.
-- The operator rebranded again on 2026-05-22, so this migration finishes
-- the transition: okoro_* → cerniq_*.
--
-- Pairs with the application-level rename in the same change. Run this
-- migration BEFORE deploying the new application code; otherwise queries
-- that SET LOCAL cerniq.principal_id = ... will fail and RLS will block
-- every row.
--
-- This migration is reversible by inverting every statement, but in
-- practice you should roll forward.
--
-- Operator note: this migration ALTERs roles. If `okoro_app` doesn't
-- exist in a given environment (e.g. a fresh DB that never ran the
-- aegis_* → okoro_* migration), the ALTER statements are wrapped in DO
-- blocks and become no-ops. The first migration handled the aegis_* →
-- okoro_* path; this one handles okoro_* → cerniq_* and also catches
-- ancient aegis_* if neither prior migration was applied.

-- 1. Roles — handle both okoro_* (expected) and aegis_* (defensive,
--    for environments that skipped the first rename migration).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'okoro_app') THEN
    ALTER ROLE okoro_app RENAME TO cerniq_app;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis_app') THEN
    ALTER ROLE aegis_app RENAME TO cerniq_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'okoro_owner') THEN
    ALTER ROLE okoro_owner RENAME TO cerniq_owner;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis_owner') THEN
    ALTER ROLE aegis_owner RENAME TO cerniq_owner;
  END IF;
END $$;

-- 2. Functions — RENAME preserves OID, so RLS policies declared in
--    20260502000200_row_level_security/ continue to bind correctly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'okoro_current_principal' AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.okoro_current_principal() RENAME TO cerniq_current_principal;
  ELSIF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'aegis_current_principal' AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.aegis_current_principal() RENAME TO cerniq_current_principal;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'okoro_rls_bypass_active' AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.okoro_rls_bypass_active() RENAME TO cerniq_rls_bypass_active;
  ELSIF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'aegis_rls_bypass_active' AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.aegis_rls_bypass_active() RENAME TO cerniq_rls_bypass_active;
  END IF;
END $$;

-- 3. Function bodies — swap GUC namespace from okoro.* to cerniq.*
--    matching the application code that now does
--    SET LOCAL cerniq.principal_id / cerniq.bypass_rls.
CREATE OR REPLACE FUNCTION cerniq_current_principal() RETURNS text AS $$
  SELECT current_setting('cerniq.principal_id', true);
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION cerniq_rls_bypass_active() RETURNS boolean AS $$
  SELECT coalesce(current_setting('cerniq.bypass_rls', true), 'off') = 'on';
$$ LANGUAGE SQL STABLE;

-- 4. Update COMMENTs
COMMENT ON FUNCTION cerniq_current_principal() IS
  'Returns the current session''s principal id from "cerniq.principal_id" GUC. '
  'Set by the application via SET LOCAL after ApiKeyGuard resolves the caller.';

COMMENT ON FUNCTION cerniq_rls_bypass_active() IS
  'Returns true iff the current session has set "cerniq.bypass_rls" = ''on''. '
  'Use ONLY for verify-only-key paths and worker drains where principal scope '
  'legitimately spans tenants. Audited via pgaudit + the SECURITY_RUNBOOK.';

-- 5. Drop any stragglers — defensive cleanup. After ALTER FUNCTION
--    RENAME the old names should not exist, but a partial-rerun scenario
--    might leave them. IF EXISTS makes this safe.
DROP FUNCTION IF EXISTS public.okoro_current_principal();
DROP FUNCTION IF EXISTS public.okoro_rls_bypass_active();
DROP FUNCTION IF EXISTS public.aegis_current_principal();
DROP FUNCTION IF EXISTS public.aegis_rls_bypass_active();

-- 6. RLS policies — no rebinding required.
--    Same OID-preservation argument as 20260521000000_rename_aegis_to_okoro:
--    ALTER FUNCTION ... RENAME TO preserves the function OID, and policy
--    USING/WITH CHECK expressions store OID references not name references,
--    so the 12 RLS policies declared in 20260502000200_row_level_security/
--    continue to work without explicit DROP+CREATE. pg_dump will re-emit
--    them under the new cerniq_* names.

-- 7. Grants — replay against the new role name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerniq_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO cerniq_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cerniq_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cerniq_app';
  END IF;
END $$;

-- 8. Audit-chain invariant unchanged: this migration does not touch
--    AuditEvent rows. Chain signatures and prev-hash links are stable
--    through the rename.
