// BuiltinPolicyEngine — the Phase 0 hand-coded logic, refactored behind
// the PolicyEngine interface. Behavior preserved bit-for-bit; this file
// is a *port*, not a redesign.
//
// IMPORTANT scope discipline: this file is NOT yet wired into the verify
// path. Peer holds `verify.algorithm.ts` and will adopt the engine
// interface in M-019. Until then the verify path runs the original
// hand-coded checks; this module is the parallel implementation that
// M-019 will swap in.

import type {
  DenialReason,
  PolicyEngine,
  PolicyEvaluationInput,
  PolicyEvaluationResult,
} from './engine.interface.js';

const TRUST_BAND_RANK: Record<string, number> = {
  PLATINUM: 3,
  VERIFIED: 2,
  WATCH: 1,
  FLAGGED: 0,
};

export class BuiltinPolicyEngine implements PolicyEngine {
  readonly id = 'builtin' as const;

  async evaluate(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult> {
    const { agent, policy, action, amount, currency, merchantDomain, now, spend } = input;

    // Step 1 — Agent status. (Note: AGENT_NOT_FOUND happens before the
    // engine is called; the verify path won't invoke us without an agent.)
    if (agent.status === 'REVOKED') {
      return deny('AGENT_REVOKED');
    }
    if (agent.status === 'SUSPENDED') {
      return deny('AGENT_REVOKED', 'agent_suspended');
    }

    // Step 2 — Policy status + expiry.
    if (policy.status === 'REVOKED') return deny('POLICY_REVOKED');
    if (policy.status === 'EXPIRED' || new Date(policy.expiresAt).getTime() <= now.getTime()) {
      return deny('POLICY_EXPIRED');
    }

    // Step 3 — Scope match. The action must be allowed by some scope; if a
    // merchant domain is supplied it must be on the scope's allow-list (when
    // present); spend limit is handled in step 4.
    const matched = matchScope(policy.scopes, action, merchantDomain);
    if (!matched) return deny('SCOPE_NOT_GRANTED');

    // Step 4 — Spend limit. Only checked when both amount AND a scope-level
    // spendLimit are present. The verify path supplies the running total in
    // `input.spend`. Currency mismatch is checked across all three sources
    // (request, spend window, scope limit) — any inequality is a hard deny.
    if (amount && matched.spendLimit && spend) {
      if (
        spend.currency !== matched.spendLimit.currency ||
        (currency && currency !== matched.spendLimit.currency)
      ) {
        return deny('SCOPE_NOT_GRANTED', 'currency_mismatch');
      }
      const requested = parseDecimal(amount);
      const already = parseDecimal(spend.windowSpend);
      const limit = parseDecimal(matched.spendLimit.amount);
      if (requested + already > limit) return deny('SPEND_LIMIT_EXCEEDED');
    }

    // Step 5 — Trust band. Builtin policy enforces trustBand >= VERIFIED
    // unless the policy explicitly opts into WATCH (signaled via a scope
    // metadata field — not yet schema-pinned, deferred to M-019).
    if ((TRUST_BAND_RANK[agent.trustBand] ?? -1) < TRUST_BAND_RANK.VERIFIED) {
      return deny('TRUST_SCORE_TOO_LOW');
    }

    return {
      decision: 'APPROVE',
      obligations: [],
      engineMetadata: { matchedScope: matched.category },
    };
  }
}

function matchScope(
  scopes: PolicyEvaluationInput['policy']['scopes'],
  action: string,
  merchantDomain?: string,
): PolicyEvaluationInput['policy']['scopes'][number] | null {
  // Action is dotted, e.g. "commerce.purchase". A scope matches if the
  // action's first segment equals scope.category AND the action is in
  // scope.actions (or scope.actions is empty/omitted = wildcard).
  const [head] = action.split('.');
  for (const s of scopes) {
    if (s.category !== head) continue;
    if (s.actions && s.actions.length > 0 && !s.actions.includes(action)) continue;
    if (merchantDomain && s.merchantDomains && s.merchantDomains.length > 0) {
      if (!s.merchantDomains.includes(merchantDomain)) continue;
    }
    return s;
  }
  return null;
}

function parseDecimal(s: string): number {
  // For the builtin engine we accept JS-number precision. Production
  // engines (Cedar/OPA) use bigint. Deferred to M-033 for Cedar.
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) throw new Error(`invalid decimal: ${s}`);
  return n;
}

function deny(denialReason: DenialReason, subReason?: string): PolicyEvaluationResult {
  return { decision: 'DENY', denialReason, subReason, obligations: [] };
}
