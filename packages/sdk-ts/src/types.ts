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

// `type` (not `interface`) so the structural shape satisfies the SDK's
// internal `Record<string, unknown>` query bag without an extra cast.
// Interfaces are nominal-ish to TS and don't auto-satisfy index signatures.
export type ListAgentsQuery = {
  /** Max page size, 1-100. API default: 25. */
  limit?: number;
  /** Opaque cursor (the agent id of the last item in the previous page). */
  cursor?: string;
  /** Filter by status. Omit to include all statuses. */
  status?: AgentStatus;
};

export interface ListAgentsResponse {
  agents: AgentRecord[];
  /** Cursor for the next page; null when no more rows. */
  nextCursor: string | null;
  /** Total agents owned by this principal across all pages. */
  total: number;
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
