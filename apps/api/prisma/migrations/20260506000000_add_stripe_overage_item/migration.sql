-- Round 21 Lane B: Stripe metered overage subscription-item id.
--
-- Hand-authored per CLAUDE.md migration discipline (do NOT auto-generate
-- via `prisma migrate dev` — that would touch the operator's local DB).
--
-- Additive only. Nullable column, no default rewrite, no index — strictly
-- safe to apply on a live table without a lock window. Populated lazily
-- by `StripeService.onCheckoutCompleted` / `onSubscriptionUpdated` when
-- the metered price line `STRIPE_PRICE_OVERAGE_VERIFY` is present on the
-- subscription. NULL means "no metered overage line" (FREE, Enterprise
-- offline-invoiced, or paid subscription without the metered price set up).

ALTER TABLE "Principal"
  ADD COLUMN "stripeOverageItemId" TEXT;
