// Edge verify path — CF Worker fast path for cache-hit verifies.
//
// Decision: when (a) the agent record is cached + ACTIVE, (b) the policy
// is cached + ACTIVE + not expired, (c) the JWT signature verifies with
// the cached pubkey, (d) the action falls inside a scope (category +
// optional action allow-list + optional merchant domain), and (e) any
// spend bound is within today's running window — the Worker returns
// APPROVED at the edge in <30 ms.
//
// On ANY of:
//   - cache miss on agent or policy
//   - agent != ACTIVE
//   - policy revoked / expired (per-cache-record check)
//   - signature failure → DENY at edge (INVALID_SIGNATURE) WITHOUT origin
//     fallback (this is unambiguous and we want the latency win)
//   - scope mismatch
//   - DPoP required but absent (when AEGIS_DPOP_REQUIRED env is set)
// we forward to origin so it can update spend windows and BATE signals.
//
// Denial precedence (ADR-0004) is preserved bit-for-bit.

import type { CachedPolicy, KvCache } from './kv-cache';
import { decodeUnsafe, verifyEd25519, type AgentTokenClaims } from './token';
import type { DenialContextKind, VerifyRequest, VerifyResponse } from '@aegis/types';

export interface EdgeVerifyResult {
  /**
   * `decided` — the Worker has a final answer; return it.
   * `forward` — the Worker can't decide; caller forwards to origin.
   */
  outcome: 'decided' | 'forward';
  response?: VerifyResponse;
}

const VERIFY_TTL_SECONDS = 30;

export async function edgeVerify(body: VerifyRequest, cache: KvCache): Promise<EdgeVerifyResult> {
  const { token } = body;
  if (typeof token !== 'string' || token.length === 0) {
    return {
      outcome: 'decided',
      response: deny('INVALID_SIGNATURE', null, null, 0, null, 'token_malformed'),
    };
  }
  const decoded = decodeUnsafe(token);
  if (!decoded) {
    return {
      outcome: 'decided',
      response: deny('INVALID_SIGNATURE', null, null, 0, null, 'token_malformed'),
    };
  }
  const { sub: agentId, pid: policyId } = decoded.claims;

  // Edge can't decide on iat/exp clock skew with ±1s tolerance — leave
  // it to origin. But hard-expired tokens are decisive.
  // The exp check at the edge is a SOFT version of origin's Step 3.6 iat
  // freshness (which is operator-opt-in via AEGIS_MAX_TOKEN_AGE_SECONDS).
  // Edge can only enforce hard-exp deterministically without round-trip;
  // tighter iat-freshness needs origin's config. Discriminator stays
  // 'signature_invalid' (vs 'jar_iat_stale') because exp != iat.
  const nowS = Math.floor(Date.now() / 1000);
  if (typeof decoded.claims.exp === 'number' && decoded.claims.exp + 30 < nowS) {
    return {
      outcome: 'decided',
      response: deny('INVALID_SIGNATURE', agentId, null, 0, null, 'signature_invalid'),
    };
  }

  const [agent, policy] = await Promise.all([cache.getAgent(agentId), cache.getPolicy(policyId)]);
  if (!agent || !policy) return { outcome: 'forward' };
  if (agent.status === 'REVOKED') {
    return {
      outcome: 'decided',
      response: deny(
        'AGENT_REVOKED',
        agent.id,
        agent.principalId,
        agent.trustScore,
        agent.trustBand,
        'agent_revoked',
      ),
    };
  }
  if (agent.status === 'SUSPENDED') {
    return { outcome: 'forward' }; // Origin handles SUSPENDED nuance.
  }
  if (policy.status !== 'ACTIVE' || policy.expiresAtMs <= Date.now()) {
    const reason = policy.status === 'REVOKED' ? 'POLICY_REVOKED' : 'POLICY_EXPIRED';
    const kind: DenialContextKind =
      policy.status === 'REVOKED' ? 'policy_revoked' : 'policy_expired';
    return {
      outcome: 'decided',
      response: deny(reason, agent.id, agent.principalId, agent.trustScore, agent.trustBand, kind),
    };
  }

  // Signature verify with the cached pubkey.
  const sigOk = await verifyEd25519(agent.publicKey, decoded.signingInput, decoded.signature);
  if (!sigOk) {
    return {
      outcome: 'decided',
      response: deny(
        'INVALID_SIGNATURE',
        agent.id,
        agent.principalId,
        agent.trustScore,
        agent.trustBand,
        'signature_invalid',
      ),
    };
  }

  // Scope match. Edge does the cheap check (category + action +
  // domain) and forwards to origin for RAR-in-JAR evaluation (Step 6.5
  // on origin) — RAR requires the pure evaluator, not a cache decision.
  // Discriminator distinguishes category-fail from domain-fail; the
  // matchScope helper returns the failure mode so we don't re-derive it.
  const scopeMatch = matchScope(policy.scopes, decoded.claims, body);
  if (!scopeMatch.matched) {
    return {
      outcome: 'decided',
      response: deny(
        'SCOPE_NOT_GRANTED',
        agent.id,
        agent.principalId,
        agent.trustScore,
        agent.trustBand,
        scopeMatch.failKind,
      ),
    };
  }

  // RAR in JAR — forward to origin. Edge intentionally doesn't carry
  // the RAR evaluator (Phase 3 may add it). If the agent signed
  // authorization_details into the token, origin owns the decision.
  if (decoded.claims.authorization_details && decoded.claims.authorization_details.length > 0) {
    return { outcome: 'forward' };
  }

  // Spend gate (per_day window only — per_request is intrinsically bounded
  // and lifetime requires durable counters that the edge doesn't own).
  if (scopeMatch.spendLimit?.window === 'per_day' && body.amount && body.currency) {
    // VerifyRequest.amount is a number; Number.parseFloat needs a string.
    // Stringify so the parsed value mirrors the origin path's decimal handling.
    const requested = Number.parseFloat(String(body.amount));
    const limit = Number.parseFloat(scopeMatch.spendLimit.amount);
    if (Number.isFinite(requested) && Number.isFinite(limit)) {
      const dayUtc = new Date().toISOString().slice(0, 10);
      const already = await cache.getDaySpend(agent.id, policy.id, body.currency, dayUtc);
      if (requested + already > limit) {
        return {
          outcome: 'decided',
          response: deny(
            'SPEND_LIMIT_EXCEEDED',
            agent.id,
            agent.principalId,
            agent.trustScore,
            agent.trustBand,
            'spend_limit_exceeded',
          ),
        };
      }
    } else {
      // Couldn't parse — let origin resolve.
      return { outcome: 'forward' };
    }
  } else if (scopeMatch.spendLimit && body.amount) {
    // per_request / lifetime: hand to origin so it can hit the durable counter.
    return { outcome: 'forward' };
  }

  // Trust band — cached value is good enough; origin re-evaluates BATE.
  if (agent.trustBand === 'FLAGGED') {
    return {
      outcome: 'decided',
      response: deny(
        'TRUST_SCORE_TOO_LOW',
        agent.id,
        agent.principalId,
        agent.trustScore,
        agent.trustBand,
        'trust_below_minimum',
      ),
    };
  }

  return {
    outcome: 'decided',
    response: {
      valid: true,
      agentId: agent.id,
      principalId: agent.principalId,
      trustScore: agent.trustScore,
      trustBand: agent.trustBand,
      scopesGranted: [scopeMatch.matchedScope.category],
      denialReason: null,
      verifiedAt: new Date().toISOString(),
      ttl: VERIFY_TTL_SECONDS,
      denialContext: null,
    },
  };
}

interface ScopeMatch {
  matched: true;
  matchedScope: CachedPolicy['scopes'][number];
  spendLimit?: CachedPolicy['scopes'][number]['spendLimit'];
}

interface ScopeMiss {
  matched: false;
  matchedScope: never;
  spendLimit?: never;
  /** Discriminator for the specific scope-mismatch reason (round 11
   *  parity with origin's Step 5/6 contextKinds). */
  failKind: DenialContextKind;
}

function matchScope(
  scopes: CachedPolicy['scopes'],
  claims: AgentTokenClaims,
  body: VerifyRequest,
): ScopeMatch | ScopeMiss {
  const action = body.action ?? claims.act ?? '';
  const merchantDomain = body.merchantDomain ?? claims.dom;
  const [head] = action.split('.');

  // Track the strongest reason to surface to the discriminator:
  //   no scope matched the category → scope_category_not_granted
  //   matched category but domain mismatch → scope_domain_not_allowed
  // Origin uses the same two-tier semantics at Step 5 + Step 6.
  let sawCategoryMatch = false;

  for (const s of scopes) {
    if (s.category !== head) continue;
    sawCategoryMatch = true;
    if (s.actions && s.actions.length > 0 && !s.actions.includes(action)) continue;
    if (merchantDomain && s.merchantDomains && s.merchantDomains.length > 0) {
      if (!s.merchantDomains.includes(merchantDomain)) continue;
    }
    return { matched: true, matchedScope: s, spendLimit: s.spendLimit };
  }

  return {
    matched: false,
    matchedScope: undefined as never,
    failKind: sawCategoryMatch ? 'scope_domain_not_allowed' : 'scope_category_not_granted',
  };
}

function deny(
  reason: VerifyResponse['denialReason'],
  agentId: string | null,
  principalId: string | null,
  trustScore: number,
  trustBand: VerifyResponse['trustBand'],
  contextKind: DenialContextKind,
): VerifyResponse {
  return {
    valid: false,
    agentId,
    principalId,
    trustScore,
    trustBand,
    scopesGranted: [],
    denialReason: reason,
    verifiedAt: new Date().toISOString(),
    ttl: 0,
    denialContext: { kind: contextKind },
  };
}
