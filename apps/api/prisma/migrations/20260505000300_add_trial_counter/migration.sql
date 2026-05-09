-- Round 17 / ADR-0014 — free-trial lifetime counter on Principal.
--
-- Adds:
--   * Principal.trialUsedCount     — durable mirror of the Redis lifetime
--                                    counter `trial:used:<principalId>`.
--                                    Flushed every Nth increment by
--                                    TrialService and immediately on
--                                    TRIAL_EXHAUSTED firing.
--   * Principal.trialExhaustedAt   — populated when the cap is crossed,
--                                    null otherwise. Drives the
--                                    "trials about to expire" dashboard.
--   * Principal_trialExhaustedAt_idx — partial index limited to non-null
--                                    rows so the index stays tiny while
--                                    most principals are still pre-cap.
--
-- Strictly additive. No backfill required: existing principals get 0 and
-- NULL by default, which means TrialService treats them as "fresh trial"
-- — correct for both new sign-ups and historical rows since the gate
-- short-circuits for non-FREE tiers anyway.

ALTER TABLE "Principal"
  ADD COLUMN "trialUsedCount"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "trialExhaustedAt" TIMESTAMP(3);

CREATE INDEX "Principal_trialExhaustedAt_idx"
  ON "Principal" ("trialExhaustedAt")
  WHERE "trialExhaustedAt" IS NOT NULL;
