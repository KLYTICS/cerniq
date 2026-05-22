#!/usr/bin/env bash
# 40-emit-prisma-migration.sh — write the new Prisma migration that ALTERs the
# okoro-named DB objects to okoro. Idempotent: skips if migration already exists.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

MIGRATIONS_DIR="apps/api/prisma/migrations"
TIMESTAMP="20260521000000"   # adjust if you re-run on a later day
NAME="rename_okoro_to_okoro"
TARGET_DIR="$MIGRATIONS_DIR/${TIMESTAMP}_${NAME}"

if [ -d "$TARGET_DIR" ]; then
  echo "[migration] already exists at $TARGET_DIR — skipping"
  exit 0
fi

mkdir -p "$TARGET_DIR"

cat > "$TARGET_DIR/migration.sql" <<'SQL'
-- OKORO — rename DB-level okoro* objects to okoro*.
--
-- Pairs with the application-level rename in the same change. Run this
-- migration BEFORE deploying the new application code; otherwise queries that
-- SET LOCAL okoro.principal_id = ... will fail and RLS will block every row.
--
-- This migration is reversible by inverting every statement, but in practice
-- you should roll forward.
--
-- Operator note: this migration ALTERs roles. If `okoro_app` doesn't exist in
-- a given environment (e.g. fresh local dev), the ALTER statements are no-ops
-- because they're wrapped in DO blocks.

-- 1. Roles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'okoro_app') THEN
    ALTER ROLE okoro_app RENAME TO okoro_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'okoro_owner') THEN
    ALTER ROLE okoro_owner RENAME TO okoro_owner;
  END IF;
END $$;

-- 2. Functions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'okoro_current_principal' AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.okoro_current_principal() RENAME TO okoro_current_principal;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'okoro_rls_bypass_active' AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.okoro_rls_bypass_active() RENAME TO okoro_rls_bypass_active;
  END IF;
END $$;

-- 3. Function bodies still reference the old GUC names. Recreate them.
--    The GUC namespace `okoro.*` becomes `okoro.*` everywhere.
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

-- 5. Drop the old okoro_* functions (now redundant)
DROP FUNCTION IF EXISTS public.okoro_current_principal();
DROP FUNCTION IF EXISTS public.okoro_rls_bypass_active();

-- 6. Rebind RLS policies that reference the old function names.
--    NOTE: every policy that previously called okoro_current_principal() /
--    okoro_rls_bypass_active() needs to be recreated against the new names.
--    The application's Prisma schema regenerates them on the next deploy IF
--    they're declared in schema.prisma. If you have policies declared only in
--    SQL migrations, you must add the ALTER POLICY / DROP POLICY + CREATE
--    POLICY pairs by hand below this comment. Search:
--      grep -rn okoro_current_principal apps/api/prisma/migrations/
--      grep -rn okoro_rls_bypass_active  apps/api/prisma/migrations/
--    for the full list.

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
SQL

# Prisma also expects a migration_lock.toml at the migrations dir root; it
# should already exist from the previous migrations. We do nothing to it.

echo "[migration] wrote $TARGET_DIR/migration.sql"
echo "[migration] HUMAN ACTION: verify the policy rebinding section (step 6)"
echo "[migration] If your schema has SQL-declared policies referencing the"
echo "[migration] old functions, edit migration.sql to add the ALTER POLICY"
echo "[migration] / DROP+CREATE pairs before running pnpm prisma migrate deploy."
