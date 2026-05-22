-- OKORO — Postgres initialization
-- Mounted at /docker-entrypoint-initdb.d/ via docker-compose.
-- Idempotent: safe to re-run.
--
-- Extensions enabled:
--   citext       — case-insensitive email columns (we use this for Principal.email)
--   pgcrypto     — gen_random_uuid(), digest() for app-level hashing
--   pg_trgm      — trigram indexes for fuzzy lookup (label search in dashboard)
--
-- Audit isolation: a future migration enables Row-Level Security on
-- AuditEvent + AgentIdentity. We do NOT enable it here so the dev seed can
-- write across principals; production migrations layer it on with a
-- principal-bound role.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Confirm OKORO database exists with sane defaults.
ALTER DATABASE okoro SET timezone TO 'UTC';
ALTER DATABASE okoro SET log_min_duration_statement TO 250;  -- log queries > 250ms

-- Application role (lower-privilege than the migration owner). Apps connect
-- as this role in production; migrations run as the owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'okoro_app') THEN
    CREATE ROLE okoro_app LOGIN PASSWORD 'okoro_app_dev_only';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE okoro TO okoro_app;
GRANT USAGE ON SCHEMA public TO okoro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO okoro_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO okoro_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO okoro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO okoro_app;
