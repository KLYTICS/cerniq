// Pure /v1/verify algorithm — framework-free.
//
// CLAUDE.md invariant #2: every line in here must run unmodified on
// Cloudflare Workers. No NestJS, no Prisma, no ioredis, no Node-specific
// APIs. Everything I/O-shaped is delivered through the `VerifyPorts`
// interface which both `apps/api` (Nest adapter) and `workers/cf-verify`
// (CF Worker adapter) implement.
//
// Step ordering is locked by `docs/SECURITY.md` § Denial Precedence and
// `docs/decisions/0004-denial-precedence-public-api.md`. Do not reorder
// without a major version bump.

import type {
  AgentTokenClaims,
  DenialContextKind,
  TrustBand,
  VerifyAlgorithmInput,
  VerifyAlgorithmOutput,
  VerifyPorts,
} from './verify.ports';
import { evaluateRar } from '../rar/rar.evaluator';
import type {
  AegisAuthorizationDetail,
  RarCandidate,
  RarDenyReason,
} from '../rar/rar.types';

const VERIFY_TTL_SECONDS = 30;
const REPLAY_CACHE_HARD_CEILING_SECONDS = 90;

export async function verifyAlgorithm(
  input: VerifyAlgorithmInput,
  ports: VerifyPorts,
): Promise<VerifyAlgorithmOutput> {
  const startMs = ports.now().getTime();
  const rpId = input.relyingPartyPrincipalId;

  // Step 1 — Decode token shape (no signature check yet — used to look up the
  // agent's public key). A malformed token can't reveal which agent it
  // claims to be, so the only valid denial here is INVALID_SIGNATURE.
  const provisional = ports.decodeJwtUnsafe(input.token);
  if (!provisional) {
    return await deny(ports, {
      reason: 'INVALID_SIGNATURE',
      contextKind: 'token_malformed',
      principalIdForResponse: null,
      principalIdForAudit: rpId,
      input,
      startMs,
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'FLAGGED',
    });
  }
  const { sub: agentId, pid: policyId } = provisional;

  // Step 2 — Agent lookup. Denial precedence: NOT_FOUND → REVOKED → other-non-active.
  // When the agent is unknown the audit row still needs a principalId; we use
  // the relying party's so the row is queryable by them. The response surface
  // returns null for principalId because there's no agent-side principal to
  // identify — see deny() docs.
  const agent = await ports.getAgent(agentId);
  if (!agent) {
    return await deny(ports, {
      reason: 'AGENT_NOT_FOUND',
      contextKind: 'agent_unknown',
      principalIdForResponse: null,
      principalIdForAudit: rpId,
      input,
      startMs,
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'FLAGGED',
    });
  }
  if (agent.status === 'REVOKED') {
    return await deny(ports, {
      reason: 'AGENT_REVOKED',
      contextKind: 'agent_revoked',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }
  if (agent.status !== 'ACTIVE') {
    // SUSPENDED leaks nothing — collapse to NOT_FOUND. We DO know the principal
    // here so audit + response carry it. Discriminator distinguishes SUSPENDED
    // from truly-unknown in the context kind (operator sees `agent_suspended`
    // in logs; public response sees AGENT_NOT_FOUND + kind=agent_suspended).
    return await deny(ports, {
      reason: 'AGENT_NOT_FOUND',
      contextKind: 'agent_suspended',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }

  // Step 3 — Cryptographic signature verification.
  const claims = await ports.verifyJwt(input.token, agent.publicKey);
  if (!claims) {
    return await deny(ports, {
      reason: 'INVALID_SIGNATURE',
      contextKind: 'signature_invalid',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }

  // Step 3.4 — RFC 9101 (JAR) audience binding. When the algorithm port
  // provides an expected audience (operator-configured via AEGIS_ISSUER)
  // AND the agent's signed token carries an `aud` claim, they MUST match.
  // The claim is cryptographically committed inside the JWT — an attacker
  // who harvested a token signed for a different AEGIS deployment cannot
  // replay it here.
  //
  // Backward compat: tokens without an `aud` claim flow through (pre-JAR
  // baseline). Deployments without `expectedAudience` wired flow through
  // (port returns undefined). The gate fires ONLY when both sides have
  // opted in — operator via env, agent via signing aud into the JAR.
  //
  // Maps to INVALID_SIGNATURE because the token IS cryptographically
  // valid but invalid FOR THIS VERIFIER. ADR-0004 locks the denial enum;
  // INVALID_SIGNATURE is the semantically-closest fit. Future round can
  // add `denialContext.aud_mismatch` for operator transparency without
  // changing the public enum.
  const expectedAud = ports.expectedAudience?.();
  if (expectedAud !== undefined && claims.aud !== undefined && claims.aud !== expectedAud) {
    return await deny(ports, {
      reason: 'INVALID_SIGNATURE',
      contextKind: 'jar_aud_mismatch',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }

  // Step 3.5 — RFC 9101 §4 issuer-vs-subject consistency. When the
  // operator opts in (env AEGIS_STRICT_JAR_ISS), tokens with iss !== sub
  // are rejected — RFC 9101 specifies iss SHOULD be the client_id, which
  // in AEGIS is the agent_id (= sub). A mismatch is either a client-SDK
  // bug or an impersonation attempt; both fail closed.
  if (
    ports.requireIssMatchesSub?.() === true &&
    claims.iss !== undefined &&
    claims.iss !== claims.sub
  ) {
    return await deny(ports, {
      reason: 'INVALID_SIGNATURE',
      contextKind: 'jar_iss_sub_mismatch',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }

  // Step 3.6 — RFC 9101 iat freshness. When the operator opts in (env
  // AEGIS_MAX_TOKEN_AGE_SECONDS), tokens whose iat is older than the
  // configured ceiling are rejected EVEN IF exp is in the future. This
  // tightens the replay window beyond what jti + exp can guarantee:
  // a token harvested from a debug log within its exp window cannot be
  // replayed indefinitely.
  //
  // Conventional FAPI 2.0 ceiling is 300s (5 min). Operator picks the
  // exact value based on their clock-skew tolerance and replay-window
  // appetite.
  const maxAge = ports.maxTokenAgeSeconds?.();
  if (maxAge !== undefined && typeof claims.iat === 'number') {
    const nowSec = Math.floor(ports.now().getTime() / 1000);
    if (nowSec - claims.iat > maxAge) {
      return await deny(ports, {
        reason: 'INVALID_SIGNATURE',
        contextKind: 'jar_iat_stale',
        principalIdForResponse: agent.principalId,
        principalIdForAudit: agent.principalId,
        input,
        startMs,
        trustScoreAtEvent: agent.trustScore,
        trustBandAtEvent: agent.trustBand,
      });
    }
  }

  // Step 3.7 — Replay-cache check (CRIT-3 fix). Even a cryptographically
  // valid token can only be consumed once. The TTL is the token's residual
  // lifetime, capped at HARD_CEILING_SECONDS for defense-in-depth.
  //
  // If `consumeJti` THROWS (Redis outage etc.) we treat the call as
  // ANOMALY_FLAGGED rather than approve under uncertainty — fail-closed
  // per CLAUDE.md invariant #4.
  const remainingTtl = Math.max(1, claims.exp - Math.floor(startMs / 1000));
  const cappedTtl = Math.min(REPLAY_CACHE_HARD_CEILING_SECONDS, remainingTtl);
  let firstUse: boolean;
  try {
    firstUse = await ports.consumeJti(claims.jti, cappedTtl);
  } catch {
    return await deny(ports, {
      reason: 'ANOMALY_FLAGGED',
      contextKind: 'replay_port_outage',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }
  if (!firstUse) {
    return await deny(ports, {
      reason: 'INVALID_SIGNATURE',
      contextKind: 'replay_consumed',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }

  // Step 4 — Policy lookup. POLICY_REVOKED before POLICY_EXPIRED. Missing
  // policies collapse into POLICY_EXPIRED to avoid leaking which IDs ever existed.
  const policy = await ports.getPolicy(policyId);
  if (!policy) {
    return await deny(ports, {
      reason: 'POLICY_EXPIRED',
      contextKind: 'policy_missing',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }
  if (policy.status === 'REVOKED') {
    return await deny(ports, {
      reason: 'POLICY_REVOKED',
      contextKind: 'policy_revoked',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }
  if (ports.now().getTime() > new Date(policy.expiresAt).getTime()) {
    return await deny(ports, {
      reason: 'POLICY_EXPIRED',
      contextKind: 'policy_expired',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }

  // Step 5 — Scope check.
  const requestedCategory = (input.action ?? 'general').split('.')[0];
  const matchingScope = policy.scopes.find((s) => s.category === requestedCategory);
  if (input.action && !matchingScope) {
    return await deny(ports, {
      reason: 'SCOPE_NOT_GRANTED',
      contextKind: 'scope_category_not_granted',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }

  // Step 6 — Domain allow-list.
  if (
    matchingScope?.allowedDomains?.length &&
    input.merchantDomain &&
    !matchingScope.allowedDomains.includes(input.merchantDomain)
  ) {
    return await deny(ports, {
      reason: 'SCOPE_NOT_GRANTED',
      contextKind: 'scope_domain_not_allowed',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }

  // Step 6.5 — RAR (RFC 9396) evaluation. When the agent signed
  // authorization_details into the JWT (RFC 9101 JAR with inline RAR),
  // AEGIS enforces them as a SCOPE_NOT_GRANTED gate. The agent
  // committed to these constraints inside the signed payload — flipping
  // them en route fails Ed25519, and the algorithm runs the evaluator
  // BEFORE recording spend so a RAR denial doesn't pollute state.
  //
  // Denial precedence is locked at 11 reasons (ADR-0004). RAR fits
  // semantically into SCOPE_NOT_GRANTED — the buyer's signed scope
  // doesn't authorize this action. The specific RAR deny reason
  // (limit_exceeded / outside_trading_hours / etc.) flows to the
  // operator through structured logging + future denialContext, NOT
  // through the locked enum.
  if (claims.authorization_details && claims.authorization_details.length > 0) {
    const candidate = deriveRarCandidate(input, claims, ports.now());
    const details = claims.authorization_details as unknown as readonly AegisAuthorizationDetail[];
    const rarResult = evaluateRar(details, candidate);
    if (!rarResult.ok) {
      // RAR sub-reasons flow through the discriminator (rar_action_unauthorized
      // / rar_limit_exceeded / etc.) rather than collapsing to a generic
      // 'scope_not_granted' kind — the agent who signed the JAR already
      // knew their own RAR limits, so the specific reason isn't a leak.
      return await deny(ports, {
        reason: 'SCOPE_NOT_GRANTED',
        contextKind: rarDenyReasonToKind(rarResult.reason),
        principalIdForResponse: agent.principalId,
        principalIdForAudit: agent.principalId,
        input,
        startMs,
        trustScoreAtEvent: agent.trustScore,
        trustBandAtEvent: agent.trustBand,
      });
    }
  }

  // Step 7 — Spend limits.
  if (input.amount && matchingScope?.spendLimit) {
    const allowed = await ports.checkSpend(
      agentId,
      policyId,
      input.amount,
      input.currency ?? matchingScope.spendLimit.currency,
      matchingScope.spendLimit,
    );
    if (!allowed) {
      return await deny(ports, {
        reason: 'SPEND_LIMIT_EXCEEDED',
        contextKind: 'spend_limit_exceeded',
        principalIdForResponse: agent.principalId,
        principalIdForAudit: agent.principalId,
        input,
        startMs,
        trustScoreAtEvent: agent.trustScore,
        trustBandAtEvent: agent.trustBand,
      });
    }
  }

  // Step 8 — Trust score gate.
  if (input.minTrustScore && agent.trustScore < input.minTrustScore) {
    return await deny(ports, {
      reason: 'TRUST_SCORE_TOO_LOW',
      contextKind: 'trust_below_minimum',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }

  // Step 9 — Anomaly hard-flag.
  if (agent.flagged) {
    return await deny(ports, {
      reason: 'ANOMALY_FLAGGED',
      contextKind: 'anomaly_flagged',
      principalIdForResponse: agent.principalId,
      principalIdForAudit: agent.principalId,
      input,
      startMs,
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });
  }

  // ----- approval path -----
  const { trustScore, trustBand } = agent;

  // Audit FIRST — wait for the chain entry so the response can carry
  // `auditEventId`. Spend record + signal + touch are fire-and-forget.
  const auditEventId = await ports.recordAudit({
    agentId,
    principalId: agent.principalId,
    action: input.action ?? 'verify',
    decision: 'APPROVED',
    relyingParty: input.merchantDomain ?? null,
    requestedAmount: input.amount ?? null,
    currency: input.currency ?? null,
    policyId,
    policySnapshot: policy.scopes,
    trustScoreAtEvent: trustScore,
    trustBandAtEvent: trustBand,
  });

  if (input.amount && matchingScope?.spendLimit) {
    ports.recordSpend(agentId, policyId, input.amount, input.currency ?? 'USD', {
      merchantId: input.merchantId,
      merchantDomain: input.merchantDomain,
    });
  }

  if (ports.featureFlags?.bateEnabled !== false) {
    ports.ingestSignal({
      agentId,
      signalType: 'CLEAN_TRANSACTION',
      severity: 'LOW',
      source: 'internal',
      payload: { action: input.action, amount: input.amount, merchantDomain: input.merchantDomain },
    });
  }

  ports.touchAgent(agentId);

  const finishedAt = ports.now();
  return {
    valid: true,
    agentId,
    principalId: agent.principalId,
    trustScore,
    trustBand,
    scopesGranted: policy.scopes.map((s) => s.category),
    verifiedAt: finishedAt.toISOString(),
    ttl: VERIFY_TTL_SECONDS,
    denialReason: null,
    latencyMs: finishedAt.getTime() - startMs,
    auditEventId,
    denialContext: null,
  };
}

/**
 * Build a RarCandidate from the verify input + signed JWT claims.
 * Pure helper — exposed for testability but not part of the public
 * algorithm API. The candidate's `type` is taken from the first
 * authorization_detail (matches the evaluator's first-match semantics)
 * so the same RAR detail evaluates consistently across the standalone
 * /v1/verify/rar/evaluate endpoint and the integrated /v1/verify path.
 */
function deriveRarCandidate(
  input: VerifyAlgorithmInput,
  claims: AgentTokenClaims,
  now: Date,
): RarCandidate {
  const firstDetail = claims.authorization_details?.[0];
  const detailType = typeof firstDetail?.type === 'string' ? firstDetail.type : 'agent_action';
  return {
    type: detailType,
    action: input.action ?? 'verify',
    amount_usd: input.amount,
    currency: input.currency,
    destination: input.merchantId,
    at: now,
  };
}

/**
 * Deny path. Refactored to take a single options object — previous
 * positional signature had grown to 8 args and each new field (the
 * round-10 `contextKind` discriminator below) made it worse. Refactoring
 * to an options object now keeps future denial fields (audit-chain
 * canonicalization, intent-mismatch specifics) from compounding the
 * positional-arg sprawl.
 *
 * Two distinct principalIds are passed:
 *
 *   `principalIdForResponse` — what the relying party sees in the response
 *   body. Null when the agent is unknown (we can't truthfully name a
 *   principal). When the agent is known, this is `agent.principalId`.
 *
 *   `principalIdForAudit` — what the audit row is filed under. ALWAYS a
 *   real principalId: the agent's when known, otherwise the relying party's
 *   (so the RP can query their own forensic stream of failed verifies).
 *   Never the synthesised string `'unknown'` — that was the CRIT-5 bug.
 *
 * `agentId` is the real Agent FK (string | null), passed through to the
 * audit row as both `agentId` (FK) and `claimedAgentId` (immutable record
 * of the request). The schema's nullable FK with SetNull on agent deletion
 * preserves the audit chain through GDPR Art. 17 erasures.
 *
 * `contextKind` is the round-10 discriminator that distinguishes the
 * five INVALID_SIGNATURE rejection conditions (signature / aud / iss /
 * iat / replay) and the seven RAR sub-reasons. TS exhaustiveness on
 * `DenialContextKind` catches missing-kind at compile time.
 */
interface DenyOptions {
  reason: VerifyAlgorithmOutput['denialReason'];
  contextKind: DenialContextKind;
  principalIdForResponse: string | null;
  principalIdForAudit: string;
  input: VerifyAlgorithmInput;
  startMs: number;
  trustScoreAtEvent: number;
  trustBandAtEvent: TrustBand;
}

async function deny(
  ports: VerifyPorts,
  opts: DenyOptions,
): Promise<VerifyAlgorithmOutput> {
  const now = ports.now();
  const claimedAgentId = ports.decodeJwtUnsafe(opts.input.token)?.sub ?? null;

  // Always audit denials — SOC2 evidence and the audit chain depend on it.
  let auditEventId: string | null = null;
  try {
    auditEventId = await ports.recordAudit({
      // Real FK only when the agent exists. We can't FK-link to a claimed
      // agent that doesn't actually exist in the DB.
      agentId: opts.principalIdForResponse !== null ? claimedAgentId : null,
      claimedAgentId,
      principalId: opts.principalIdForAudit,
      action: opts.input.action ?? 'verify',
      decision: 'DENIED',
      denialReason: opts.reason,
      relyingParty: opts.input.merchantDomain ?? null,
      requestedAmount: opts.input.amount ?? null,
      currency: opts.input.currency ?? null,
      trustScoreAtEvent: opts.trustScoreAtEvent,
      trustBandAtEvent: opts.trustBandAtEvent,
    });
  } catch {
    // Audit port throws on durable failure — surface as null auditEventId.
    auditEventId = null;
  }

  return {
    valid: false,
    agentId: claimedAgentId,
    principalId: opts.principalIdForResponse,
    trustScore: opts.trustScoreAtEvent,
    trustBand: opts.trustBandAtEvent,
    scopesGranted: [],
    verifiedAt: now.toISOString(),
    ttl: 0,
    denialReason: opts.reason,
    latencyMs: now.getTime() - opts.startMs,
    auditEventId,
    denialContext: { kind: opts.contextKind },
  };
}

/**
 * Map a RAR evaluator deny reason to the matching DenialContextKind.
 * Keeps the algorithm pure (no service-side log enrichment needed) by
 * preserving the specific RAR sub-reason in the public discriminator.
 * RAR scope is signed into the token by the agent, so disclosing the
 * specific RAR rejection to the relying party doesn't leak operator
 * config — the agent already knew their own RAR limits.
 */
function rarDenyReasonToKind(reason: RarDenyReason): DenialContextKind {
  switch (reason) {
    case 'type_unauthorized':
      return 'rar_type_unauthorized';
    case 'action_unauthorized':
      return 'rar_action_unauthorized';
    case 'instrument_not_whitelisted':
      return 'rar_instrument_not_whitelisted';
    case 'destination_not_whitelisted':
      return 'rar_destination_not_whitelisted';
    case 'resource_not_whitelisted':
      return 'rar_resource_not_whitelisted';
    case 'limit_exceeded':
      return 'rar_limit_exceeded';
    case 'currency_unauthorized':
      return 'rar_currency_unauthorized';
    case 'pii_disallowed':
      return 'rar_pii_disallowed';
    case 'outside_trading_hours':
      return 'rar_outside_trading_hours';
    case 'no_authorization_details':
      // Algorithm guards on length > 0 before invoking evaluator, so this
      // case is unreachable from verifyAlgorithm. Included for TS
      // exhaustiveness — defends against future refactors that drop the
      // length guard.
      return 'rar_no_authorization_details';
  }
}
