-- Add Stripe billing fields to Principal (G-3, OD-003).
-- Operator runs this; this migration is hand-authored because DATABASE_URL
-- is not available in the dev sandbox.

ALTER TABLE "Principal"
  ADD COLUMN "stripeCustomerId"     TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "subscriptionStatus"   TEXT;

CREATE UNIQUE INDEX "Principal_stripeSubscriptionId_key"
  ON "Principal"("stripeSubscriptionId");
