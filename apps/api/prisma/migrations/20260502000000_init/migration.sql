-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'DEVELOPER', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('FULL', 'VERIFY_ONLY');

-- CreateEnum
CREATE TYPE "AgentRuntime" AS ENUM ('OPENAI', 'ANTHROPIC', 'GOOGLE', 'HUGGINGFACE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TrustBand" AS ENUM ('PLATINUM', 'VERIFIED', 'WATCH', 'FLAGGED');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AuditDecision" AS ENUM ('APPROVED', 'DENIED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "BateSignalType" AS ENUM ('CLEAN_TRANSACTION', 'PRINCIPAL_KYC_VERIFIED', 'CONSISTENT_GEOGRAPHY', 'NORMAL_VELOCITY', 'RELYING_PARTY_FRAUD_REPORT', 'VELOCITY_ANOMALY', 'GEOGRAPHIC_INCONSISTENCY', 'SPEND_PATTERN_DEVIATION', 'POLICY_VIOLATION_ATTEMPT', 'FAILED_VERIFY_SPIKE', 'DELEGATION_CHAIN_ANOMALY');

-- CreateEnum
CREATE TYPE "SignalSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'ABANDONED');

-- CreateTable
CREATE TABLE "Principal" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "planTier" "PlanTier" NOT NULL DEFAULT 'FREE',
    "billingCustomerId" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "kycVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Principal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "label" TEXT,
    "principalId" TEXT NOT NULL,
    "scope" "ApiKeyScope" NOT NULL DEFAULT 'FULL',
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentIdentity" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "label" TEXT,
    "runtime" "AgentRuntime" NOT NULL,
    "model" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "trustScore" INTEGER NOT NULL DEFAULT 500,
    "trustBand" "TrustBand" NOT NULL DEFAULT 'VERIFIED',
    "lastScoredAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "verifyCount" INTEGER NOT NULL DEFAULT 0,
    "verifyCountDay" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPolicy" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "label" TEXT,
    "signedToken" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" JSONB NOT NULL,
    "verifyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpendRecord" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "merchantId" TEXT,
    "domain" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateKey" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,

    CONSTRAINT "SpendRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "claimedAgentId" TEXT,
    "principalId" TEXT NOT NULL,
    "action" TEXT,
    "decision" "AuditDecision" NOT NULL,
    "denialReason" TEXT,
    "relyingParty" TEXT,
    "requestedAmount" DECIMAL(14,2),
    "currency" TEXT,
    "policyId" TEXT,
    "policySnapshot" JSONB,
    "actionHash" TEXT NOT NULL,
    "relyingPartyHash" TEXT,
    "requestedAmountHash" TEXT,
    "policySnapshotHash" TEXT,
    "redactedAt" TIMESTAMP(3),
    "redactionReason" TEXT,
    "trustScoreAtEvent" INTEGER NOT NULL,
    "trustBandAtEvent" "TrustBand" NOT NULL,
    "aegisSignature" TEXT NOT NULL,
    "payloadVersion" INTEGER NOT NULL DEFAULT 2,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BateSignal" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "signalType" "BateSignalType" NOT NULL,
    "severity" "SignalSeverity" NOT NULL DEFAULT 'MEDIUM',
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "scoreDelta" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BateSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustScoreHistory" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "TrustBand" NOT NULL,
    "reason" TEXT NOT NULL,
    "signalId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustScoreHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDelegation" (
    "id" TEXT NOT NULL,
    "delegatorId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "scopeSubset" JSONB NOT NULL,
    "chainDepth" INTEGER NOT NULL DEFAULT 1,
    "chainRoot" TEXT NOT NULL,
    "delegationToken" TEXT NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "responseCode" INTEGER,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelyingParty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "reportWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelyingParty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Principal_email_key" ON "Principal"("email");

-- CreateIndex
CREATE INDEX "Principal_email_idx" ON "Principal"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_principalId_idx" ON "ApiKey"("principalId");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "AgentIdentity_principalId_idx" ON "AgentIdentity"("principalId");

-- CreateIndex
CREATE INDEX "AgentIdentity_status_idx" ON "AgentIdentity"("status");

-- CreateIndex
CREATE INDEX "AgentIdentity_trustScore_idx" ON "AgentIdentity"("trustScore");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPolicy_tokenHash_key" ON "AgentPolicy"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentPolicy_agentId_idx" ON "AgentPolicy"("agentId");

-- CreateIndex
CREATE INDEX "AgentPolicy_status_expiresAt_idx" ON "AgentPolicy"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SpendRecord_agentId_dateKey_idx" ON "SpendRecord"("agentId", "dateKey");

-- CreateIndex
CREATE INDEX "SpendRecord_agentId_monthKey_idx" ON "SpendRecord"("agentId", "monthKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_lockedAt_createdAt_idx" ON "OutboxEvent"("processedAt", "lockedAt", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_kind_idx" ON "OutboxEvent"("kind");

-- CreateIndex
CREATE INDEX "AuditEvent_agentId_timestamp_idx" ON "AuditEvent"("agentId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEvent_principalId_timestamp_idx" ON "AuditEvent"("principalId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEvent_relyingParty_timestamp_idx" ON "AuditEvent"("relyingParty", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEvent_timestamp_idx" ON "AuditEvent"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "BateSignal_idempotencyKey_key" ON "BateSignal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BateSignal_agentId_processed_idx" ON "BateSignal"("agentId", "processed");

-- CreateIndex
CREATE INDEX "BateSignal_signalType_occurredAt_idx" ON "BateSignal"("signalType", "occurredAt");

-- CreateIndex
CREATE INDEX "TrustScoreHistory_agentId_recordedAt_idx" ON "TrustScoreHistory"("agentId", "recordedAt");

-- CreateIndex
CREATE INDEX "AgentDelegation_delegatorId_idx" ON "AgentDelegation"("delegatorId");

-- CreateIndex
CREATE INDEX "AgentDelegation_delegateId_idx" ON "AgentDelegation"("delegateId");

-- CreateIndex
CREATE INDEX "WebhookSubscription_principalId_idx" ON "WebhookSubscription"("principalId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_subscriptionId_status_idx" ON "WebhookDelivery"("subscriptionId", "status");

-- CreateIndex
CREATE INDEX "WebhookDelivery_nextRetryAt_idx" ON "WebhookDelivery"("nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "RelyingParty_domain_key" ON "RelyingParty"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "RelyingParty_apiKeyHash_key" ON "RelyingParty"("apiKeyHash");

-- CreateIndex
CREATE INDEX "RelyingParty_domain_idx" ON "RelyingParty"("domain");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentIdentity" ADD CONSTRAINT "AgentIdentity_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPolicy" ADD CONSTRAINT "AgentPolicy_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BateSignal" ADD CONSTRAINT "BateSignal_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustScoreHistory" ADD CONSTRAINT "TrustScoreHistory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

