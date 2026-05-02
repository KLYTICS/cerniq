// Public types for @aegis/sdk. Mirror the API contract; intentionally
// hand-written rather than generated so the SDK can ship before the OpenAPI
// generator is fully wired.

export type AgentRuntime = 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'HUGGINGFACE' | 'CUSTOM';
export type AgentStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
export type TrustBand = 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';

export type ScopeCategory =
  | 'commerce'
  | 'data-read'
  | 'data-write'
  | 'communication'
  | 'scheduling';

export interface SpendLimit {
  currency: 'USD' | 'EUR' | 'GBP';
  maxPerTransaction?: number;
  maxPerDay?: number;
  maxPerMonth?: number;
}

export interface PolicyScope {
  category: ScopeCategory;
  spendLimit?: SpendLimit;
  allowedDomains?: string[];
  merchantCategories?: string[];
  dataScopes?: string[];
  validFrom?: string;
  validUntil?: string;
}

export interface RegisterAgentInput {
  publicKey: string;
  runtime: AgentRuntime;
  model?: string;
  label?: string;
}

export interface AgentRecord {
  agentId: string;
  publicKey: string;
  principalId: string;
  runtime: AgentRuntime;
  model?: string | null;
  label?: string | null;
  status: AgentStatus;
  trustScore: number;
  trustBand: TrustBand;
  registeredAt: string;
  lastSeenAt?: string | null;
}

export interface CreatePolicyInput {
  label?: string;
  scopes: PolicyScope[];
  expiresAt: Date | string;
}

export interface PolicyRecord {
  policyId: string;
  signedToken: string;
  expiresAt: string;
}

export interface SignContext {
  action: string;
  amount?: number;
  currency?: string;
  merchantDomain?: string;
  merchantId?: string;
  ttlSeconds?: number;
}

export type DenialReason =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_REVOKED'
  | 'INVALID_SIGNATURE'
  | 'POLICY_EXPIRED'
  | 'POLICY_REVOKED'
  | 'SCOPE_NOT_GRANTED'
  | 'SPEND_LIMIT_EXCEEDED'
  | 'TRUST_SCORE_TOO_LOW'
  | 'ANOMALY_FLAGGED';

export interface VerifyResult {
  valid: boolean;
  agentId: string | null;
  principalId: string | null;
  trustScore: number;
  trustBand: TrustBand | null;
  scopesGranted: string[];
  denialReason: DenialReason | null;
  verifiedAt: string;
  ttl: number;
}

export interface AegisConfig {
  /** Management API key (`aegis_sk_…`). Required for agent/policy operations. */
  apiKey?: string;
  /** Verify-only key (`aegis_vk_…`). Required for `verify()` calls — relying parties should never see the management key. */
  verifyKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
}
