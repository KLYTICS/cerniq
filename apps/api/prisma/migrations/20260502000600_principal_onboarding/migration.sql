-- ─────────────────────────────────────────────────────────────────────────
-- PrincipalOnboarding (OD-012, M-039 follow-up)
--
-- Server-persisted onboarding checklist. Drives:
--   - dashboard wizard ("you have 3 of 7 steps complete")
--   - `aegis doctor` CLI ("you haven't done X yet")
--   - activation funnel telemetry without third-party analytics
--
-- One row per principal. Created at signup; rows persist forever (we
-- never delete onboarding history — it's how we measure activation).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "PrincipalOnboarding" (
    "principalId"             TEXT      NOT NULL PRIMARY KEY,
    -- Step booleans. ALL default false; flip to true the moment the step
    -- is observed completing for the first time. We don't flip back to
    -- false on revoke / delete — onboarding is a one-way ratchet.
    "hasFirstAgent"           BOOLEAN   NOT NULL DEFAULT false,
    "hasFirstPolicy"          BOOLEAN   NOT NULL DEFAULT false,
    "hasFirstVerify"          BOOLEAN   NOT NULL DEFAULT false,
    "hasKmsConfigured"        BOOLEAN   NOT NULL DEFAULT false,
    "hasMcpServerRegistered"  BOOLEAN   NOT NULL DEFAULT false,
    "hasWebhookSubscribed"    BOOLEAN   NOT NULL DEFAULT false,
    "hasPaymentMethodAdded"   BOOLEAN   NOT NULL DEFAULT false,
    -- Timestamps recorded for funnel analysis. Nullable; populated on
    -- the same write that flipped the boolean.
    "firstAgentAt"            TIMESTAMP(3),
    "firstPolicyAt"           TIMESTAMP(3),
    "firstVerifyAt"           TIMESTAMP(3),
    "kmsConfiguredAt"         TIMESTAMP(3),
    "firstMcpServerAt"        TIMESTAMP(3),
    "firstWebhookAt"          TIMESTAMP(3),
    "paymentMethodAt"         TIMESTAMP(3),
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrincipalOnboarding_principal_fkey"
      FOREIGN KEY ("principalId") REFERENCES "Principal"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PrincipalOnboarding_firstVerifyAt_idx"
  ON "PrincipalOnboarding" ("firstVerifyAt");
