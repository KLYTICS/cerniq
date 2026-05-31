// Public types for @cerniq/sdk. Mirror the API contract; intentionally
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

/**
 * Single-object form for `PolicyClient.create(input)`. Matches CLI calling
 * convention (`policies create --agent-id … --scopes-file … --ttl …`).
 * Either `expiresInSeconds` (TTL-from-now) or `expiresAt` (absolute) must
 * be supplied — `expiresInSeconds` wins if both are set. OD-024 (Option A).
 */
export interface CreatePolicyBundle {
  agentId: string;
  scopes: PolicyScope[];
  label?: string;
  expiresInSeconds?: number;
  expiresAt?: Date | string;
}

export interface PolicyRecord {
  policyId: string;
  signedToken: string;
  expiresAt: string;
}

/** Uppercase mirror of the API's PolicyResponseDto.status field. */
export type PolicyStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

/**
 * Richer policy record returned by `GET /agents/:agentId/policies`. The
 * thin `PolicyRecord` is the *create* response (signed token at issue
 * time); list responses carry catalog metadata. OD-024 (Option A).
 */
export interface PolicyListItem {
  policyId: string;
  agentId: string;
  label?: string | null;
  scopes: PolicyScope[];
  status: PolicyStatus;
  createdAt: string;
  expiresAt: string;
}

/** Wrapped list-response shape. Matches CLI's `result.policies` access. */
export interface PolicyListResponse {
  policies: PolicyListItem[];
}

/** Minimal agent projection returned by `GET /agents`. OD-024 (Option A). */
export interface AgentSummary {
  agentId: string;
  label?: string | null;
  runtime: AgentRuntime;
  status: AgentStatus;
  trustScore: number;
  trustBand: TrustBand;
  registeredAt: string;
  lastSeenAt?: string | null;
}

/** Cursor-paginated list response from `GET /agents`. OD-024 (Option A). */
export interface ListAgentsResponse {
  agents: AgentSummary[];
  nextCursor: string | null;
  count?: number;
}

/**
 * Options bag for `AgentClient.revoke(id, opts?)` and
 * `PolicyClient.revoke(policyId, opts?)`. `reason` is forwarded as the
 * request body for audit-trail capture. OD-024 (Option A).
 */
export interface RevokeOptions {
  /** Free-form reason recorded in the audit chain. */
  reason?: string;
}

export interface SignContext {
  action: string;
  amount?: number;
  currency?: string;
  merchantDomain?: string;
  merchantId?: string;
  ttlSeconds?: number;
}

// DenialReason union is generated from the canonical
// `DENIAL_REASON_PRECEDENCE` tuple in `packages/types/src/constants.ts`.
// Re-run `pnpm gen:denial-reason` after editing the precedence to keep
// this in lockstep. The cross-package parity test in
// `tests/cross-package/denial-reason-parity.spec.ts` is the gate.
export { DENIAL_REASONS, type DenialReason } from './denial-reason.generated.js';
import type { DenialReason } from './denial-reason.generated.js';

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

export interface CerniqConfig {
  /** Management API key (`cerniq_sk_…`). Required for agent/policy operations. */
  apiKey?: string;
  /** Verify-only key (`cerniq_vk_…`). Required for `verify()` calls — relying parties should never see the management key. */
  verifyKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
}
