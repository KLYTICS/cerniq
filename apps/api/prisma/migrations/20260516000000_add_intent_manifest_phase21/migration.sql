-- ADR-0017 Phase 2.1 — Prisma adapter for IntentPorts (production gate unblock)
--
-- Adds the two tables (+ one enum) that back the Prisma adapter the operator
-- selects via AEGIS_INTENT_MANIFEST_STORAGE=prisma. Until this migration runs,
-- intent issuance is dev-only (in-process memory adapter); after it runs the
-- operator can flip AEGIS_INTENT_MANIFEST_ENABLED=true safely.
--
-- Schema invariants:
--   - IntentManifest.body / signatureB64Url / signingKeyId NEVER mutate
--     after the initial INSERT (CLAUDE.md invariant #3 — audit append-only).
--     Only the `status` cache field transitions OPEN → RECONCILED → EXPIRED.
--   - IntentActual is 1:1 with IntentManifest (manifestId UNIQUE).
--     Idempotency replay/conflict is enforced at the application layer
--     (intent.adapter.prisma.ts saveReconciliation()); the database
--     constraint (manifestId, idempotencyKey) UNIQUE is the racing
--     concurrent-write backstop.
--   - Tenant isolation (CLAUDE.md invariant #5): every query goes through
--     the adapter which carries principalId from the controller boundary.
--     The composite index (principalId, manifestId) supports tenant-scoped
--     reads; the (principalId, status, expiresAt) index supports cold-archive
--     sweeps without a sequential scan.
--
-- Operational safety:
--   - Forward-only (additive). No existing data touched.
--   - Two CREATE TABLEs + one CREATE TYPE + four CREATE INDEX. Each one
--     completes in milliseconds against an empty table.
--   - The CASCADE clause on the foreign-key constraint matches Prisma's
--     default for @relation; chosen ON DELETE RESTRICT explicitly because
--     deleting a manifest with a reconciliation row would orphan audit
--     evidence and violate invariant #3.

CREATE TYPE "IntentManifestStatus" AS ENUM ('OPEN', 'RECONCILED', 'EXPIRED');

CREATE TABLE "IntentManifest" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "signingKeyId" TEXT NOT NULL,
    "signatureB64Url" TEXT NOT NULL,
    "status" "IntentManifestStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentManifest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntentManifest_manifestId_key" ON "IntentManifest"("manifestId");
CREATE INDEX "IntentManifest_principalId_manifestId_idx" ON "IntentManifest"("principalId", "manifestId");
CREATE INDEX "IntentManifest_principalId_status_expiresAt_idx" ON "IntentManifest"("principalId", "status", "expiresAt");

CREATE TABLE "IntentActual" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actuals" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentActual_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntentActual_manifestId_key" ON "IntentActual"("manifestId");
CREATE UNIQUE INDEX "idx_intent_actual_idem" ON "IntentActual"("manifestId", "idempotencyKey");

ALTER TABLE "IntentActual"
    ADD CONSTRAINT "IntentActual_manifestId_fkey"
    FOREIGN KEY ("manifestId") REFERENCES "IntentManifest"("manifestId")
    ON DELETE RESTRICT ON UPDATE CASCADE;
