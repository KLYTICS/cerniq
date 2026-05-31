-- OD-024 Phase A2: capture operator-supplied reason on policy revocation
-- so the audit trail can answer "why was this policy revoked?". Mirrors
-- the existing `AgentIdentity.revokedReason` column added in an earlier
-- migration. Nullable so existing rows stay valid; populated on new
-- DELETE /agents/:agentId/policies/:policyId calls that carry a body.

ALTER TABLE "AgentPolicy" ADD COLUMN "revokedReason" TEXT;
