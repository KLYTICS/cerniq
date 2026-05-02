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
  TrustBand,
  VerifyAlgorithmInput,
  VerifyAlgorithmOutput,
  VerifyPorts,
} from './verify.ports';

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
    return await deny(ports, 'INVALID_SIGNATURE', null, rpId, input, startMs, 0, 'FLAGGED');
  }
  const { sub: agentId, pid: policyId } = provisional;

  // Step 2 — Agent lookup. Denial precedence: NOT_FOUND → REVOKED → other-non-active.
  // When the agent is unknown the audit row still needs a principalId; we use
  // the relying party's so the row is queryable by them. The response surface
  // returns null for principalId because there's no agent-side principal to
  // identify — see deny() docs.
  const agent = await ports.getAgent(agentId);
  if (!agent) {
    return await deny(ports, 'AGENT_NOT_FOUND', null, rpId, input, startMs, 0, 'FLAGGED');
  }
  if (agent.status === 'REVOKED') {
    return await deny(ports, 'AGENT_REVOKED', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
  }
  if (agent.status !== 'ACTIVE') {
    // SUSPENDED leaks nothing — collapse to NOT_FOUND. We DO know the principal
    // here so audit + response carry it.
    return await deny(ports, 'AGENT_NOT_FOUND', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
  }

  // Step 3 — Cryptographic signature verification.
  const claims = await ports.verifyJwt(input.token, agent.publicKey);
  if (!claims) {
    return await deny(ports, 'INVALID_SIGNATURE', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
  }

  // Step 3.5 — Replay-cache check (CRIT-3 fix). Even a cryptographically
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
    return await deny(ports, 'ANOMALY_FLAGGED', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
  }
  if (!firstUse) {
    return await deny(ports, 'INVALID_SIGNATURE', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
  }

  // Step 4 — Policy lookup. POLICY_REVOKED before POLICY_EXPIRED. Missing
  // policies collapse into POLICY_EXPIRED to avoid leaking which IDs ever existed.
  const policy = await ports.getPolicy(policyId);
  if (!policy) {
    return await deny(ports, 'POLICY_EXPIRED', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
  }
  if (policy.status === 'REVOKED') {
    return await deny(ports, 'POLICY_REVOKED', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
  }
  if (ports.now().getTime() > new Date(policy.expiresAt).getTime()) {
    return await deny(ports, 'POLICY_EXPIRED', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
  }

  // Step 5 — Scope check.
  const requestedCategory = (input.action ?? 'general').split('.')[0];
  const matchingScope = policy.scopes.find((s) => s.category === requestedCategory);
  if (input.action && !matchingScope) {
    return await deny(ports, 'SCOPE_NOT_GRANTED', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
  }

  // Step 6 — Domain allow-list.
  if (
    matchingScope?.allowedDomains?.length &&
    input.merchantDomain &&
    !matchingScope.allowedDomains.includes(input.merchantDomain)
  ) {
    return await deny(ports, 'SCOPE_NOT_GRANTED', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
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
      return await deny(ports, 'SPEND_LIMIT_EXCEEDED', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
    }
  }

  // Step 8 — Trust score gate.
  if (input.minTrustScore && agent.trustScore < input.minTrustScore) {
    return await deny(ports, 'TRUST_SCORE_TOO_LOW', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
  }

  // Step 9 — Anomaly hard-flag.
  if (agent.flagged) {
    return await deny(ports, 'ANOMALY_FLAGGED', agent.principalId, agent.principalId, input, startMs, agent.trustScore, agent.trustBand);
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
  };
}

/**
 * Deny path. Two distinct principalIds are passed:
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
 */
async function deny(
  ports: VerifyPorts,
  reason: VerifyAlgorithmOutput['denialReason'],
  principalIdForResponse: string | null,
  principalIdForAudit: string,
  input: VerifyAlgorithmInput,
  startMs: number,
  trustScoreAtEvent: number,
  trustBandAtEvent: TrustBand,
): Promise<VerifyAlgorithmOutput> {
  const now = ports.now();
  const claimedAgentId = ports.decodeJwtUnsafe(input.token)?.sub ?? null;

  // Always audit denials — SOC2 evidence and the audit chain depend on it.
  let auditEventId: string | null = null;
  try {
    auditEventId = await ports.recordAudit({
      // Real FK only when the agent exists. We can't FK-link to a claimed
      // agent that doesn't actually exist in the DB.
      agentId: principalIdForResponse !== null ? claimedAgentId : null,
      claimedAgentId,
      principalId: principalIdForAudit,
      action: input.action ?? 'verify',
      decision: 'DENIED',
      denialReason: reason,
      relyingParty: input.merchantDomain ?? null,
      requestedAmount: input.amount ?? null,
      currency: input.currency ?? null,
      trustScoreAtEvent,
      trustBandAtEvent,
    });
  } catch {
    // Audit port throws on durable failure — surface as null auditEventId.
    auditEventId = null;
  }

  return {
    valid: false,
    agentId: claimedAgentId,
    principalId: principalIdForResponse,
    trustScore: trustScoreAtEvent,
    trustBand: trustBandAtEvent,
    scopesGranted: [],
    verifiedAt: now.toISOString(),
    ttl: 0,
    denialReason: reason,
    latencyMs: now.getTime() - startMs,
    auditEventId,
  };
}
