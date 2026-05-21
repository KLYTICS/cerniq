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

export interface ListAgentsOptions {
  /** Page size. Server defaults to 25, caps at 100. */
  limit?: number;
  /** Opaque cursor returned in the previous page's `nextCursor`. */
  cursor?: string;
  /** Filter to agents in a specific lifecycle status. */
  status?: AgentStatus;
  /** Filter to agents declaring a specific runtime. */
  runtime?: AgentRuntime;
  /** Substring match on id, label, or model. */
  search?: string;
}

export interface AgentListPage {
  agents: AgentRecord[];
  /** `null` once the last page has been returned. */
  nextCursor: string | null;
  /** Total agents owned by this principal across all pages. */
  total: number;
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

// DenialReason union is generated from the canonical
// `DENIAL_REASON_PRECEDENCE` tuple in `packages/types/src/constants.ts`.
// Re-run `pnpm gen:denial-reason` after editing the precedence to keep
// this in lockstep. The cross-package parity test in
// `tests/cross-package/denial-reason-parity.spec.ts` is the gate.
export { DENIAL_REASONS, type DenialReason } from './denial-reason.generated.js';
import type { DenialReason } from './denial-reason.generated.js';

// ── Audit ──────────────────────────────────────────────────────────────────

export type AuditDecision = 'APPROVED' | 'DENIED' | 'FLAGGED';

export interface AuditEvent {
  eventId: string;
  /** Real agent FK; `null` when verify denied with AGENT_NOT_FOUND. */
  agentId: string | null;
  /** Agent ID exactly as claimed in the verify request; lets you correlate denials to bad-input agents. */
  claimedAgentId?: string | null;
  principalId: string;
  /** ISO timestamp. */
  timestamp: string;
  /** `null` after GDPR Art. 17 redaction; verify integrity via actionHash. */
  action: string | null;
  /** base64url(sha256(action)) — committed to in the signed chain payload, survives redaction. */
  actionHash: string;
  relyingParty?: string | null;
  decision: AuditDecision;
  decisionReason?: string | null;
  trustScoreAtEvent: number;
  /** AEGIS-signed chain signature. Verify against `/.well-known/audit-signing-key`. */
  signature: string;
}

export interface AuditSearchOptions {
  /** ISO timestamp lower bound (inclusive). */
  from?: string;
  /** ISO timestamp upper bound (exclusive). */
  to?: string;
  /** Page size. Server defaults to 100, caps at 1000. */
  limit?: number;
  cursor?: string;
}

export interface AuditLogPage {
  events: AuditEvent[];
  nextCursor: string | null;
  count: number;
}

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
