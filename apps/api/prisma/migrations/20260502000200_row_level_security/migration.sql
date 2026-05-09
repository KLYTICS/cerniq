-- AEGIS — Postgres Row-Level Security (RLS) for multi-tenant isolation.
--
-- Closes the architecture-compliance review's Invariant 5 gap noted as
-- "PARTIAL — enforced at app layer only." This migration adds storage-
-- layer enforcement so an app-layer bug (forgetting `where: { principalId }`
-- in a service method) cannot leak cross-tenant data.
--
-- Defense in depth, not replacement: the app layer remains primary and
-- still scopes every query. RLS is the second wall.
--
-- Strategy:
--
--   1. Two roles:
--      - `aegis_owner`  — schema migrations + back-office tooling. RLS
--        does not apply (BYPASSRLS or owner of every row). Holds the
--        AEGIS audit signing key and runs Prisma `migrate deploy`.
--      - `aegis_app`    — the application connects as this. RLS is
--        active. Reads + writes are constrained by policies.
--   2. Tenant identification via session variable
--      `aegis.principal_id` set by the application immediately after
--      ApiKeyGuard resolves the calling principal:
--           SET LOCAL "aegis.principal_id" = 'prn_xxx';
--      The variable is transaction-scoped so cross-tenant bleeds are
--      impossible even if a connection is recycled mid-request.
--   3. RLS policies on principal-scoped tables enforce:
--        principalId = current_setting('aegis.principal_id')
--   4. The hot verify path opts OUT of RLS via a separate
--      `aegis.bypass_rls` session var the verify-only key path sets.
--      Verify is a relying-party operation that legitimately spans
--      principals; it lives behind a dedicated guard.
--
-- Operator note: this migration ALTERS roles. If `aegis_app` doesn't
-- exist (because you deployed without infra/docker/postgres-init.sql)
-- the role-creation block at the top creates it. In Railway / managed
-- Postgres environments, the role is your service connection user.

-- ─────────────────────────────────────────────────────────────────
-- 1. Roles
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'aegis_app') THEN
    CREATE ROLE aegis_app LOGIN;
  END IF;
END
$$;

-- The migration owner role keeps BYPASSRLS so the Prisma migrations + the
-- audit-signing back-office tooling still work. Application connections
-- explicitly use aegis_app.
ALTER ROLE aegis_app NOBYPASSRLS;

-- Grants for the app role on the existing schema.
GRANT USAGE ON SCHEMA public TO aegis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aegis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aegis_app;

-- ─────────────────────────────────────────────────────────────────
-- 2. Helper: read the session variable safely (NULL when unset).
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION aegis_current_principal() RETURNS text AS $$
BEGIN
  RETURN current_setting('aegis.principal_id', true);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION aegis_rls_bypass_active() RETURNS boolean AS $$
BEGIN
  RETURN current_setting('aegis.bypass_rls', true) = 'on';
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────────
-- 3. Policies — principal-scoped tables.
--    Owner role bypasses RLS (BYPASSRLS attribute on aegis_owner).
--    aegis_app sees only rows owned by the session principal.
-- ─────────────────────────────────────────────────────────────────

-- Principal: a row is visible only to the principal who owns it (their own row).
ALTER TABLE "Principal" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS principal_self_access ON "Principal";
CREATE POLICY principal_self_access ON "Principal"
  FOR ALL
  TO aegis_app
  USING (id = aegis_current_principal() OR aegis_rls_bypass_active())
  WITH CHECK (id = aegis_current_principal() OR aegis_rls_bypass_active());

-- ApiKey: scoped by principalId.
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS apikey_principal_scope ON "ApiKey";
CREATE POLICY apikey_principal_scope ON "ApiKey"
  FOR ALL
  TO aegis_app
  USING ("principalId" = aegis_current_principal() OR aegis_rls_bypass_active())
  WITH CHECK ("principalId" = aegis_current_principal() OR aegis_rls_bypass_active());

-- AgentIdentity: scoped by principalId.
ALTER TABLE "AgentIdentity" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_principal_scope ON "AgentIdentity";
CREATE POLICY agent_principal_scope ON "AgentIdentity"
  FOR ALL
  TO aegis_app
  USING ("principalId" = aegis_current_principal() OR aegis_rls_bypass_active())
  WITH CHECK ("principalId" = aegis_current_principal() OR aegis_rls_bypass_active());

-- AgentPolicy: scoped via the agent's principalId. Subselect is fine
-- here because the AgentIdentity row itself is RLS-protected — if the
-- caller can't see the agent, the EXISTS returns false too.
ALTER TABLE "AgentPolicy" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_principal_scope ON "AgentPolicy";
CREATE POLICY policy_principal_scope ON "AgentPolicy"
  FOR ALL
  TO aegis_app
  USING (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "AgentIdentity" a
       WHERE a.id = "AgentPolicy"."agentId"
         AND a."principalId" = aegis_current_principal()
    )
  )
  WITH CHECK (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "AgentIdentity" a
       WHERE a.id = "AgentPolicy"."agentId"
         AND a."principalId" = aegis_current_principal()
    )
  );

-- AuditEvent: scoped by principalId.
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_principal_scope ON "AuditEvent";
CREATE POLICY audit_principal_scope ON "AuditEvent"
  FOR ALL
  TO aegis_app
  USING ("principalId" = aegis_current_principal() OR aegis_rls_bypass_active())
  WITH CHECK ("principalId" = aegis_current_principal() OR aegis_rls_bypass_active());

-- BateSignal: scoped via agent.principalId (same pattern as AgentPolicy).
ALTER TABLE "BateSignal" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bate_signal_scope ON "BateSignal";
CREATE POLICY bate_signal_scope ON "BateSignal"
  FOR ALL
  TO aegis_app
  USING (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "AgentIdentity" a
       WHERE a.id = "BateSignal"."agentId"
         AND a."principalId" = aegis_current_principal()
    )
  )
  WITH CHECK (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "AgentIdentity" a
       WHERE a.id = "BateSignal"."agentId"
         AND a."principalId" = aegis_current_principal()
    )
  );

-- TrustScoreHistory: scoped via agent.principalId.
ALTER TABLE "TrustScoreHistory" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trust_history_scope ON "TrustScoreHistory";
CREATE POLICY trust_history_scope ON "TrustScoreHistory"
  FOR ALL
  TO aegis_app
  USING (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "AgentIdentity" a
       WHERE a.id = "TrustScoreHistory"."agentId"
         AND a."principalId" = aegis_current_principal()
    )
  )
  WITH CHECK (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "AgentIdentity" a
       WHERE a.id = "TrustScoreHistory"."agentId"
         AND a."principalId" = aegis_current_principal()
    )
  );

-- WebhookSubscription: scoped by principalId.
ALTER TABLE "WebhookSubscription" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_sub_scope ON "WebhookSubscription";
CREATE POLICY webhook_sub_scope ON "WebhookSubscription"
  FOR ALL
  TO aegis_app
  USING ("principalId" = aegis_current_principal() OR aegis_rls_bypass_active())
  WITH CHECK ("principalId" = aegis_current_principal() OR aegis_rls_bypass_active());

-- WebhookDelivery: scoped via subscription.principalId.
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_delivery_scope ON "WebhookDelivery";
CREATE POLICY webhook_delivery_scope ON "WebhookDelivery"
  FOR ALL
  TO aegis_app
  USING (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "WebhookSubscription" s
       WHERE s.id = "WebhookDelivery"."subscriptionId"
         AND s."principalId" = aegis_current_principal()
    )
  )
  WITH CHECK (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "WebhookSubscription" s
       WHERE s.id = "WebhookDelivery"."subscriptionId"
         AND s."principalId" = aegis_current_principal()
    )
  );

-- AgentDelegation: bound to the delegator's principalId.
ALTER TABLE "AgentDelegation" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delegation_scope ON "AgentDelegation";
CREATE POLICY delegation_scope ON "AgentDelegation"
  FOR ALL
  TO aegis_app
  USING (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "AgentIdentity" a
       WHERE a.id = "AgentDelegation"."delegatorId"
         AND a."principalId" = aegis_current_principal()
    )
  )
  WITH CHECK (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "AgentIdentity" a
       WHERE a.id = "AgentDelegation"."delegatorId"
         AND a."principalId" = aegis_current_principal()
    )
  );

-- SpendRecord: scoped via agent.principalId.
ALTER TABLE "SpendRecord" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spend_record_scope ON "SpendRecord";
CREATE POLICY spend_record_scope ON "SpendRecord"
  FOR ALL
  TO aegis_app
  USING (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "AgentIdentity" a
       WHERE a.id = "SpendRecord"."agentId"
         AND a."principalId" = aegis_current_principal()
    )
  )
  WITH CHECK (
    aegis_rls_bypass_active() OR
    EXISTS (
      SELECT 1 FROM "AgentIdentity" a
       WHERE a.id = "SpendRecord"."agentId"
         AND a."principalId" = aegis_current_principal()
    )
  );

-- OutboxEvent: scoped via embedded principalId in the payload, OR (if
-- present) via a top-level column. Peer's ADR-0007 schema doesn't
-- guarantee a column; we apply the bypass-only policy here so RLS is
-- enabled (closed by default) and the worker uses the bypass var.
ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbox_bypass_only ON "OutboxEvent";
CREATE POLICY outbox_bypass_only ON "OutboxEvent"
  FOR ALL
  TO aegis_app
  USING (aegis_rls_bypass_active())
  WITH CHECK (aegis_rls_bypass_active());

-- ─────────────────────────────────────────────────────────────────
-- 4. Tables that are deliberately principal-LESS (no RLS):
--      - RelyingParty: global registry, every principal can see RPs.
--    These are intentionally left without ENABLE ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────
-- 5. Smoke verification: every principal-scoped table must be RLS-enabled.
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c.relname, ', ')
    INTO v_missing
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN (
       'Principal', 'ApiKey', 'AgentIdentity', 'AgentPolicy', 'AuditEvent',
       'BateSignal', 'TrustScoreHistory', 'WebhookSubscription',
       'WebhookDelivery', 'AgentDelegation', 'SpendRecord', 'OutboxEvent'
     )
     AND NOT c.relrowsecurity;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is not enabled on principal-scoped tables: %', v_missing;
  END IF;
END;
$$;

-- COMMENT ON ... IS requires a single string literal (Postgres DDL grammar).
-- The previous multi-line ' || ' concatenation is invalid in this context;
-- collapsed to single literals.
COMMENT ON FUNCTION aegis_current_principal() IS 'Returns the current session''s principal id from "aegis.principal_id" GUC. Set by the application via SET LOCAL after ApiKeyGuard resolves the caller.';
COMMENT ON FUNCTION aegis_rls_bypass_active() IS 'Returns true iff the current session has set "aegis.bypass_rls" = ''on''. Use ONLY for verify-only-key paths and worker drains where principal scope legitimately spans tenants. Audited via pgaudit + the SECURITY_RUNBOOK.';
