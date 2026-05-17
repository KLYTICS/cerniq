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

// DenialReason union is generated from the canonical
// `DENIAL_REASON_PRECEDENCE` tuple in `packages/types/src/constants.ts`.
// Re-run `pnpm gen:denial-reason` after editing the precedence to keep
// this in lockstep. The cross-package parity test in
// `tests/cross-package/denial-reason-parity.spec.ts` is the gate.
export { DENIAL_REASONS, type DenialReason } from './denial-reason.generated.js';
import type { DenialReason } from './denial-reason.generated.js';

// Denial context discriminator (closed enum) — re-exported from canonical
// home in `@aegis/types`. Set on denial responses; null on approval. Lets
// integrators differentiate the five INVALID_SIGNATURE rejection conditions
// (signature / aud / iss / iat / replay) and nine RAR sub-reasons without
// growing the locked DenialReason enum. See FAPI 2.0 profile §2.6 for the
// threat-model split (kind public, specifics in operator logs only).
export {
  DENIAL_CONTEXT_KINDS,
  isDenialContextKind,
  type DenialContext,
  type DenialContextKind,
} from '@aegis/types';
import type { DenialContext } from '@aegis/types';

export interface VerifyResult {
  valid: boolean;
  agentId: string | null;
  principalId: string | null;
  trustScore: number;
  trustBand: TrustBand | null;
  scopesGranted: string[];
  denialReason: DenialReason | null;
  /**
   * Closed-enum discriminator below `denialReason`. Set whenever
   * `denialReason` is set (denial paths); null on approval. Use the `kind`
   * field to switch-exhaustive in UI labels, telemetry tagging, or routing
   * logic. Stable additive evolution: adding a kind is non-breaking;
   * removing or renaming requires a major SDK bump.
   */
  denialContext: DenialContext | null;
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
