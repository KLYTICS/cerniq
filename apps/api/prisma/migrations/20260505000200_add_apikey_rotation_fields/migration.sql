-- Add ApiKey rotation overlap-window field (M-API-KEY-ROT).
-- Hand-authored: DATABASE_URL is not available in the dev sandbox, so the
-- operator runs this migration directly via `prisma migrate deploy`.
--
-- Adds:
--   * ApiKey.expiresAt — nullable timestamp. Null means "no expiry"
--     (the historical default). When a principal rotates an API key, the
--     OLD key gets `expiresAt = now() + overlapHours` so deployed
--     integrations have a finite swap window. ApiKeyGuard treats any key
--     whose `expiresAt` is in the past as `expired_api_key`.
--   * ApiKey_expiresAt_idx — supports the guard's `expiresAt > now()`
--     filter and any future "list keys nearing expiry" jobs.
--
-- Strictly additive. No backfill required: existing keys stay null and
-- continue to authenticate indefinitely until explicitly rotated/revoked.

ALTER TABLE "ApiKey"
  ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "ApiKey_expiresAt_idx" ON "ApiKey"("expiresAt");
