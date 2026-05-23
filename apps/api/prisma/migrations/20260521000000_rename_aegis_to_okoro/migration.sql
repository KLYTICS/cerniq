-- OKORO — rename DB-level aegis* objects to okoro*.
--
-- Pairs with the application-level rename in the same change. Run this
-- migration BEFORE deploying the new application code; otherwise queries that
-- SET LOCAL okoro.principal_id = ... will fail and RLS will block every row.
--
-- This migration is reversible by inverting every statement, but in practice
-- you should roll forward.
--
-- Operator note: this migration ALTERs roles. If `aegis_app` doesn't exist in
-- a given environment (e.g. fresh local dev), the ALTER statements are no-ops
-- because they're wrapped in DO blocks.

-- 1. Roles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis_app') THEN
    ALTER ROLE aegis_app RENAME TO okoro_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis_owner') THEN
    ALTER ROLE aegis_owner RENAME TO okoro_owner;
  END IF;
END $$;

-- 2. Functions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'aegis_current_principal' AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.aegis_current_principal() RENAME TO okoro_current_principal;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'aegis_rls_bypass_active' AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.aegis_rls_bypass_active() RENAME TO okoro_rls_bypass_active;
  END IF;
END $$;

-- 3. Function bodies still reference the old GUC names. Recreate them.
--    The GUC namespace `aegis.*` becomes `okoro.*` everywhere.
CREATE OR REPLACE FUNCTION okoro_current_principal() RETURNS text AS $$
  SELECT current_setting('okoro.principal_id', true);
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION okoro_rls_bypass_active() RETURNS boolean AS $$
  SELECT coalesce(current_setting('okoro.bypass_rls', true), 'off') = 'on';
$$ LANGUAGE SQL STABLE;

-- 4. Update COMMENTs
COMMENT ON FUNCTION okoro_current_principal() IS
  'Returns the current session''s principal id from "okoro.principal_id" GUC. '
  'Set by the application via SET LOCAL after ApiKeyGuard resolves the caller.';

COMMENT ON FUNCTION okoro_rls_bypass_active() IS
  'Returns true iff the current session has set "okoro.bypass_rls" = ''on''. '
  'Use ONLY for verify-only-key paths and worker drains where principal scope '
  'legitimately spans tenants. Audited via pgaudit + the SECURITY_RUNBOOK.';

-- 5. Drop the old aegis_* functions (now redundant)
DROP FUNCTION IF EXISTS public.aegis_current_principal();
DROP FUNCTION IF EXISTS public.aegis_rls_bypass_active();

-- 6. RLS policies — no rebinding required.
--    Postgres stores policy USING/WITH CHECK expressions as parsed trees
--    where function references are resolved at policy-creation time to
--    OIDs in pg_proc. `ALTER FUNCTION ... RENAME TO` preserves the OID,
--    so the 12 RLS policies declared in 20260502000200_row_level_security/
--    (principal_self_access, apikey_principal_scope, agent_principal_scope,
--    policy_principal_scope, audit_principal_scope, bate_signal_scope,
--    trust_history_scope, webhook_sub_scope, webhook_delivery_scope,
--    delegation_scope, spend_record_scope, outbox_bypass_only) continue
--    to work without DROP+CREATE. pg_dump will re-emit them under the new
--    function names because it resolves OIDs back to current names.
--
--    If a defensive rebind is ever needed (e.g. after a fresh restore
--    where the old function existed but the new one was created from
--    scratch rather than renamed), use:
--      grep -rn aegis_current_principal apps/api/prisma/migrations/
--      grep -rn aegis_rls_bypass_active  apps/api/prisma/migrations/
--    and emit the matching DROP POLICY + CREATE POLICY pairs in a NEW
--    migration (immutability contract — never edit this one after deploy).

-- 7. Grants — replay against the new role name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'okoro_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO okoro_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO okoro_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO okoro_app';
  END IF;
END $$;

-- 8. Audit-chain invariant unchanged: this migration does not touch AuditEvent rows.
