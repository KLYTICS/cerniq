-- =============================================================================
-- OKORO — Postgres production initialization
-- =============================================================================
-- Mounted at /docker-entrypoint-initdb.d/init.sql by the Postgres container.
-- Runs EXACTLY ONCE on first boot — Postgres skips the init dir on subsequent
-- starts. To re-run, you must reset the data volume (and lose state). Treat
-- this file like an irreversible migration.
--
-- Idempotent: safe to re-run by hand if needed (every statement is guarded
-- with IF NOT EXISTS or a DO block).
--
-- Scope:
--   1. Enable extensions required by the app + ops tooling.
--   2. Create least-privilege application + read-only roles.
--   3. Document explicitly what we DO NOT do here (RLS, table grants beyond
--      DEFAULT PRIVILEGES) and where that work happens instead.
--
-- This file does NOT define tables — Prisma migrations own the schema. If
-- you find yourself adding a CREATE TABLE here, stop and write a Prisma
-- migration instead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
-- pgcrypto:
--   Required by the schema (gen_random_uuid()) AND by pgcrypto-based digest
--   helpers we may add later. SOC2 control CC6.1 (logical access) considers
--   this a baseline crypto primitive — having it on day one means we never
--   ship a migration that "suddenly" depends on it from a non-superuser
--   role.
--
-- pg_stat_statements:
--   Required for query-level performance + audit visibility. Without it,
--   we cannot answer "what was the slowest query in the last hour" during
--   an incident. SOC2 CC7.2 (system monitoring) effectively requires this.
--   It must be loaded via shared_preload_libraries in postgresql.conf — see
--   infra/postgres/postgresql.conf.tuning. CREATE EXTENSION below only
--   wires it into this database; the library load is a server-level
--   change.
--
-- citext:
--   Used by the schema for case-insensitive email columns on Principal.
--
-- pg_trgm:
--   Trigram indexes for fuzzy lookup (label / agent search in dashboard).
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- Database-level defaults
-- -----------------------------------------------------------------------------
-- All timestamps in OKORO are UTC. Setting timezone here saves a
-- per-connection SET TIME ZONE on every Prisma client.
ALTER DATABASE okoro SET timezone TO 'UTC';

-- Slow-query log threshold. 250 ms is well above expected verify-path
-- latency; anything tripping this is worth a pull-request investigation.
ALTER DATABASE okoro SET log_min_duration_statement TO 250;

-- Force statement_timeout for application connections so a runaway query
-- can't block the verify path indefinitely. Migration / admin connections
-- override this with `SET statement_timeout = 0` when needed.
ALTER DATABASE okoro SET statement_timeout TO '15s';

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
-- okoro_app:
--   Application role. The API + worker connect as this role. CANNOT run
--   DDL — schema migrations run as the database owner (`okoro`), which is
--   the only role with CREATE on the public schema.
--
-- okoro_readonly:
--   For ad-hoc analytics, BI tools, and on-call read access. CANNOT write
--   — full stop. SOC2 CC6.3 (least privilege) is satisfied by this
--   separation: a stolen analytics credential cannot mutate audit events.
--
-- Both passwords are placeholders and MUST be replaced at deploy time. The
-- production deploy script (or Railway dashboard) sets the real password
-- and rotates it on the documented cadence (90 days).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'okoro_app') THEN
    -- placeholder password; operator MUST rotate via:
    --   ALTER ROLE okoro_app WITH PASSWORD '<from secrets manager>';
    CREATE ROLE okoro_app LOGIN PASSWORD 'REPLACE_ME_AT_DEPLOY_TIME';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'okoro_readonly') THEN
    CREATE ROLE okoro_readonly LOGIN PASSWORD 'REPLACE_ME_AT_DEPLOY_TIME';
  END IF;
END
$$;

-- okoro_app: full DML on the public schema.
GRANT CONNECT ON DATABASE okoro TO okoro_app;
GRANT USAGE ON SCHEMA public TO okoro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO okoro_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO okoro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO okoro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO okoro_app;

-- okoro_readonly: SELECT only, including future tables.
GRANT CONNECT ON DATABASE okoro TO okoro_readonly;
GRANT USAGE ON SCHEMA public TO okoro_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO okoro_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO okoro_readonly;

-- pg_stat_statements is in the `public` schema by default; both roles see
-- it via the GRANT above. If you move it to its own schema later, mirror
-- the grants there.

-- -----------------------------------------------------------------------------
-- What this file deliberately does NOT do
-- -----------------------------------------------------------------------------
-- 1. Row-Level Security (RLS).
--    OKORO enforces multi-tenant isolation at the application layer (every
--    service method takes principalId as the first arg — see
--    docs/SECURITY.md § 5). RLS is planned as defense-in-depth but it
--    belongs in a Prisma migration that ships alongside the role split,
--    NOT here. Reason: RLS policies reference table + column names that
--    only exist after the schema migrations have run. Putting RLS in this
--    init script would either fail (tables not yet created) or force a
--    chicken-and-egg ordering with prisma:deploy.
--
--    Tracking: docs/ARCHITECTURE.md § 8 + WORK_BOARD.md M-018.
--
-- 2. Table-level GRANTs beyond DEFAULT PRIVILEGES.
--    The DEFAULT PRIVILEGES above cover tables created by the migration
--    owner (the `okoro` role). If a future migration runs as a different
--    role, that role's freshly-created tables won't pick up the defaults
--    — re-issue table-level grants in the migration itself.
--
-- 3. Replication slots / publication setup for logical replication.
--    Phase 3 read replicas (docs/ARCHITECTURE.md § 8) are out of scope
--    for v1. When they ship, add a separate init step.
-- =============================================================================
