// Public types for @cerniq/sdk. Mirror the API contract; intentionally
// hand-written for AgentRuntime/AgentStatus/TrustBand because the SDK's
// historical casing (UPPERCASE) diverges from `@cerniq/types`'s wire
// casing (lowercase for runtime/status, mixed for TrustBand).
// Aligning those is a SemVer-breaking change tracked in PR #62 triage
// Tier-2 (SDK shadow-type drift cleanup); out of scope here.
//
// `Currency` IS re-exported from `@cerniq/types` because the SDK's
// previous 3-value `'USD' | 'EUR' | 'GBP'` literal was strict-narrower
// than the API server's accepted union (9 fiat + 4 stablecoin = 13
// codes). Widening the SDK type to match is purely additive — no
// consumer relying on `currency: 'USD'` regresses; consumers passing
// the broader set stop getting a type error for input the server
// always accepted. Swarm-2 type-design-analyzer 2026-05-27.
import type { Currency } from '@cerniq/types';

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
  currency: Currency;
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
  /**
   * Currency code for `amount`. Narrowed from `string` to `Currency`
   * (the wire-contract union from `@cerniq/types`) so passing an
   * invalid code is a TS error at sign-time instead of a server-side
   * 400 at verify-time.
   */
  currency?: Currency;
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
