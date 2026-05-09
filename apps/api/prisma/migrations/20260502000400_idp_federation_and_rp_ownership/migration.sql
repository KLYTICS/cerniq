-- ─────────────────────────────────────────────────────────────────────────
-- IdP federation + RelyingParty ownership (ADR-0009)
--
-- The previous migration body was an empty Prisma CLI error message
-- accidentally committed during `migrate diff` without `--shadow-database-url`.
-- Round 24 reconstructs the intended schema delta:
--
--   1. Principal: add (idpProvider, idpUserId, idpOrganizationId) — composite
--      foreign-identity anchor for federated logins. Nullable so local sign-up
--      still works.
--   2. RelyingParty: add (principalId FK, status, kind) — RPs are now tenant-
--      owned, with lifecycle + kind discriminator (GENERIC | MCP_SERVER | …).
--   3. Add the RelyingPartyStatus + RelyingPartyKind enums.
--   4. Index Principal(idpProvider, idpUserId) for the federated-login lookup.
--
-- Idempotent guards (`IF NOT EXISTS`) so the migration is safe to re-apply
-- against partially-migrated environments.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. RelyingParty lifecycle enums ------------------------------------------

DO $$ BEGIN
  CREATE TYPE "RelyingPartyStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RelyingPartyKind" AS ENUM ('GENERIC', 'MCP_SERVER', 'COMMERCE', 'AUTH0_APP', 'OIDC_CLIENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Principal IdP federation columns --------------------------------------

ALTER TABLE "Principal"
  ADD COLUMN IF NOT EXISTS "idpProvider"       TEXT,
  ADD COLUMN IF NOT EXISTS "idpUserId"         TEXT,
  ADD COLUMN IF NOT EXISTS "idpOrganizationId" TEXT;

CREATE INDEX IF NOT EXISTS "Principal_idpProvider_idpUserId_idx"
  ON "Principal" ("idpProvider", "idpUserId");

-- 3. RelyingParty ownership + lifecycle ------------------------------------

ALTER TABLE "RelyingParty"
  ADD COLUMN IF NOT EXISTS "principalId" TEXT,
  ADD COLUMN IF NOT EXISTS "status"      "RelyingPartyStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "kind"        "RelyingPartyKind"   NOT NULL DEFAULT 'GENERIC',
  ADD COLUMN IF NOT EXISTS "metadata"    JSONB;

CREATE INDEX IF NOT EXISTS "RelyingParty_principalId_idx"
  ON "RelyingParty" ("principalId");

CREATE INDEX IF NOT EXISTS "RelyingParty_kind_status_idx"
  ON "RelyingParty" ("kind", "status");

DO $$ BEGIN
  ALTER TABLE "RelyingParty"
    ADD CONSTRAINT "RelyingParty_principalId_fkey"
    FOREIGN KEY ("principalId") REFERENCES "Principal" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN "Principal"."idpProvider" IS 'Identity-provider issuer (e.g. "https://klytics.eu.auth0.com/"). Composite (idpProvider, idpUserId) is the foreign-identity anchor.';
COMMENT ON COLUMN "RelyingParty"."principalId" IS 'Tenant ownership — required for RLS scoping. NULL during pre-ADR-0009 backfill window only.';

