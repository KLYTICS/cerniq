// Ports for the pure verify algorithm. Both the Nest adapter and the CF
// Worker implement these. Keep the surface minimal — every additional port
// makes a future port harder.
//
// CLAUDE.md invariant #2: zero framework imports. Types only. The previous
// version pulled `TrustBand` from `@prisma/client` which would prevent the
// Cloudflare Workers adapter from importing this file (no Prisma at the
// edge). The local definition below is the canonical wire-shape; the Nest
// adapter widens its Prisma `TrustBand` enum into this shape at the boundary.

export type TrustBand = 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';

export type DenialReason =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_REVOKED'
  | 'INVALID_SIGNATURE'
  | 'POLICY_EXPIRED'
  | 'POLICY_REVOKED'
  | 'SCOPE_NOT_GRANTED'
  | 'SPEND_LIMIT_EXCEEDED'
  | 'TRUST_SCORE_TOO_LOW'
  | 'ANOMALY_FLAGGED';

export interface VerifyAlgorithmInput {
  token: string;
  action?: string;
  amount?: number;
  currency?: string;
  merchantId?: string;
  merchantDomain?: string;
  /**
   * Per-call minimum trust score the relying party requires. Set on a
   * per-verify basis so the same agent can be approved for low-risk calls
   * and denied for high-risk ones without separate policies.
   * Defaults to 0 if absent (no minimum).
   */
  minTrustScore?: number;
  /**
   * Principal ID of the relying party making this verify call (i.e. the
   * owner of the verify-only API key). Required so denial-audit rows have
   * a real `principalId` even when the agent is unknown — eliminates the
   * `'unknown'` fabrication that violated CLAUDE.md invariant #4.
   */
  relyingPartyPrincipalId: string;
}

export interface VerifyAlgorithmOutput {
  valid: boolean;
  agentId: string | null;
  principalId: string | null;
  trustScore: number;
  trustBand: TrustBand | null;
  scopesGranted: string[];
  denialReason: DenialReason | null;
  verifiedAt: string;
  ttl: number;
  /** Latency in milliseconds — caller emits as a metric. */
  latencyMs: number;
  /**
   * ID of the audit row this verify call produced, if any. Relying parties
   * use this to reference the specific decision in support tickets and
   * downstream chains.
   */
  auditEventId: string | null;
}

export interface AgentSnapshot {
  id: string;
  publicKey: string;
  status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED' | 'REVOKED';
  trustScore: number;
  trustBand: TrustBand;
  principalId: string;
  /**
   * Set by BATE when an anomaly detector triggers a hard-flag. Causes
   * ANOMALY_FLAGGED denial regardless of trust score.
   */
  flagged?: boolean;
}

export interface PolicySnapshot {
  id: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  expiresAt: string | Date;
  scopes: Array<{
    category: string;
    spendLimit?: { currency: string; maxPerTransaction?: number; maxPerDay?: number; maxPerMonth?: number };
    allowedDomains?: string[];
  }>;
}

export interface AgentTokenClaims {
  sub: string; // agentId
  pid: string; // policyId
  act?: string;
  amt?: number;
  cur?: string;
  dom?: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface AuditAppendInput {
  /** Real agent FK. Null for AGENT_NOT_FOUND denials. */
  agentId: string | null;
  /** Claimed agentId from the request. Always populated when known, even on null `agentId`. */
  claimedAgentId?: string | null;
  principalId: string;
  action: string;
  decision: 'APPROVED' | 'DENIED' | 'FLAGGED';
  denialReason?: string | null;
  relyingParty?: string | null;
  requestedAmount?: number | null;
  currency?: string | null;
  policyId?: string | null;
  policySnapshot?: unknown;
  trustScoreAtEvent: number;
  trustBandAtEvent: TrustBand;
}

export interface BateSignalInput {
  agentId: string;
  signalType:
    | 'CLEAN_TRANSACTION'
    | 'PRINCIPAL_KYC_VERIFIED'
    | 'CONSISTENT_GEOGRAPHY'
    | 'NORMAL_VELOCITY'
    | 'RELYING_PARTY_FRAUD_REPORT'
    | 'VELOCITY_ANOMALY'
    | 'GEOGRAPHIC_INCONSISTENCY'
    | 'SPEND_PATTERN_DEVIATION'
    | 'POLICY_VIOLATION_ATTEMPT'
    | 'FAILED_VERIFY_SPIKE'
    | 'DELEGATION_CHAIN_ANOMALY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  source: string;
  payload: Record<string, unknown>;
}

export interface SpendLimit {
  currency: string;
  maxPerTransaction?: number;
  maxPerDay?: number;
  maxPerMonth?: number;
}

export interface VerifyPorts {
  getAgent(agentId: string): Promise<AgentSnapshot | null>;
  getPolicy(policyId: string): Promise<PolicySnapshot | null>;
  /** JWT signature verification. Returns decoded claims or null. */
  verifyJwt(token: string, publicKeyB64u: string): Promise<AgentTokenClaims | null>;
  /** Decode without verification — used to look up the public key. */
  decodeJwtUnsafe(token: string): AgentTokenClaims | null;

  /**
   * Atomically consume a JWT `jti` (replay-cache port). Returns true if
   * this is the first sighting; false if it has already been consumed.
   * MUST throw on infrastructure failure — never return false on outage,
   * which would silently approve replays.
   */
  consumeJti(jti: string, ttlSeconds: number): Promise<boolean>;

  checkSpend(
    agentId: string,
    policyId: string,
    amount: number,
    currency: string,
    limit: SpendLimit,
  ): Promise<boolean>;

  /** Persist spend record. Implementations decide sync/async semantics. */
  recordSpend(
    agentId: string,
    policyId: string,
    amount: number,
    currency: string,
    ctx: { merchantId?: string; merchantDomain?: string },
  ): void;

  /**
   * Append an audit row. Returns the auditEventId so the caller can
   * embed it in the response (relying parties use it to reference the
   * specific decision in support tickets).
   */
  recordAudit(event: AuditAppendInput): Promise<string>;

  /** Fire-and-forget: BATE signal ingestion. */
  ingestSignal(signal: BateSignalInput): void;
  /** Fire-and-forget: bump agent.lastSeenAt. */
  touchAgent(agentId: string): void;

  /** Mandatory clock — guarantees deterministic latency math in tests. */
  now(): Date;

  featureFlags?: { bateEnabled?: boolean };
}
