// PolicyEngine interface (ADR-0012). Pluggable: builtin (Phase 0 logic),
// Cedar, OPA. Wired into the verify path by M-019 (peer holds the path).
//
// Constraint: this file (and its peer adapters) must run on Cloudflare
// Workers per ADR-0003. NO NestJS / Prisma / Redis / Node-only APIs.
// Pure functions over plain data.

import type { TrustBand } from '@prisma/client';

export type PolicyEngineId = 'builtin' | 'cedar' | 'opa';

/** Locked denial reasons per ADR-0004. Engines MAY NOT invent new ones. */
export type DenialReason =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_REVOKED'
  | 'INVALID_SIGNATURE'
  | 'POLICY_REVOKED'
  | 'POLICY_EXPIRED'
  | 'SCOPE_NOT_GRANTED'
  | 'SPEND_LIMIT_EXCEEDED'
  | 'TRUST_SCORE_TOO_LOW'
  | 'ANOMALY_FLAGGED';

export interface PolicyScope {
  category: string;
  actions?: string[];
  merchantDomains?: string[];
  spendLimit?: { amount: string; currency: string; window: 'per_request' | 'per_day' | 'lifetime' };
}

export interface AgentSnapshot {
  id: string;
  status: 'ACTIVE' | 'REVOKED' | 'SUSPENDED';
  trustScore: number;
  trustBand: TrustBand;
  principalId: string;
}

export interface PolicySnapshot {
  id: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  scopes: PolicyScope[];
}

export interface SpendContext {
  /** Total spend in the window so far, decimal-as-string. */
  windowSpend: string;
  /** The window's spend limit, decimal-as-string. */
  limit: string;
  currency: string;
}

export interface PolicyEvaluationInput {
  agent: AgentSnapshot;
  policy: PolicySnapshot;
  /** The action being attempted, e.g. "commerce.purchase". */
  action: string;
  /** Optional amount + currency for spend-bound actions. */
  amount?: string;
  currency?: string;
  /** Optional merchant domain for scope match. */
  merchantDomain?: string;
  /** When the request hit the verify path (server time). */
  now: Date;
  /** Optional spend context — engine uses if action is spend-bound. */
  spend?: SpendContext;
}

export interface PolicyObligation {
  /** Side effects the engine asks the verify path to execute on APPROVE. */
  kind: 'audit_extra' | 'webhook_notify' | 'bate_signal';
  data: Record<string, unknown>;
}

export type PolicyEvaluationResult =
  | {
      decision: 'APPROVE';
      obligations: PolicyObligation[];
      /** Free-form engine metadata audited as `engineMetadata`. Never user-facing. */
      engineMetadata?: Record<string, unknown>;
    }
  | {
      decision: 'DENY';
      denialReason: DenialReason;
      /** Engine-specific finer-grained reason; audited only. */
      subReason?: string;
      obligations: PolicyObligation[];
      engineMetadata?: Record<string, unknown>;
    }
  | {
      decision: 'FLAG';
      /** APPROVED but with a flag — verify path returns valid:true and emits a BATE signal. */
      flagReason: string;
      obligations: PolicyObligation[];
      engineMetadata?: Record<string, unknown>;
    };

export interface PolicyEngine {
  readonly id: PolicyEngineId;
  evaluate(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult>;
}
