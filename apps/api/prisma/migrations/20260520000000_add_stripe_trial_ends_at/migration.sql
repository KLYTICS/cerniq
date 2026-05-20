-- Round 24 Lane A: Stripe time-based trial end timestamp.
--
-- Hand-authored per CLAUDE.md migration discipline. Additive only.
-- Nullable column; no default rewrite; no index. Strictly safe on a live
-- table without a lock window — single ALTER, single COLUMN ADD.
--
-- Populated by `StripeService` from `subscription.trial_end` whenever
-- a `customer.subscription.{created,updated,trial_will_end}` event
-- carries a non-null trial. NULL means the active Stripe subscription
-- has no time-based trial, OR no Stripe subscription is linked yet.
--
-- This column is INDEPENDENT of `trialUsedCount` / `trialExhaustedAt`,
-- which represent the AEGIS lifetime-counter free trial (ADR-0014).
-- A Principal can have both, neither, or one — the dashboard banner
-- fires on whichever cliff is closer.

ALTER TABLE "Principal"
  ADD COLUMN "stripeTrialEndsAt" TIMESTAMP(3);
