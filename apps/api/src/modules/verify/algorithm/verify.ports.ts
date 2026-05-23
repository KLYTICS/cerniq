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
  | 'POLICY_REVOKED'
  | 'POLICY_EXPIRED'
  | 'SCOPE_NOT_GRANTED'
  | 'TRIAL_EXHAUSTED'           // ADR-0014: free-trial lifetime cap (HTTP 402)
  | 'SPEND_LIMIT_EXCEEDED'
  | 'TRUST_SCORE_TOO_LOW'
  | 'ANOMALY_FLAGGED'
  | 'INTENT_MISMATCH';          // ADR-0016: intent-bound attestation

/**
 * DenialContext.kind — closed-enum discriminator that lives BELOW the
 * locked ADR-0004 denial-precedence enum. Five distinct rejection
 * conditions (signature / aud / iss / iat / replay) currently collapse
 * to INVALID_SIGNATURE in the public response; the discriminator below
 * lets operators + integrators differentiate them WITHOUT growing the
 * locked enum (which would require a 90-day customer notice + major
 * version bump per CLAUDE.md invariant #6).
 *
 * Each `deny()` callsite MUST emit a kind. TS exhaustiveness via the
 * discriminated union catches missing kinds at compile time; the
 * cross-package parity test (`fapi-denial-context-parity.spec.ts`)
 * catches new denial reasons added without context-kind wiring.
 *
 * Threat-model split: the discriminator IS returned in the public
 * `/v1/verify` response (operator-debug + integrator-debug win).
 * Specifics (expected aud, max-age threshold, etc.) are NOT carried on
 * this type — the service layer reconstructs them from input + config
 * for structured-log emission only. That keeps operator config out of
 * buyer-visible response bodies while still letting ops debug without
 * a log lookup.
 */
export type DenialContextKind =
  // Step 1 — malformed token (cannot determine claimed agent)
  | 'token_malformed'
  // Step 2 — agent
  | 'agent_unknown'                  // unknown agent_id
  | 'agent_revoked'                  // explicitly REVOKED
  | 'agent_suspended'                // status other than ACTIVE/REVOKED (collapses to AGENT_NOT_FOUND publicly)
  // Step 3 — cryptographic signature
  | 'signature_invalid'
  // Step 3.4-3.6 — RFC 9101 JAR claim binding (each → INVALID_SIGNATURE publicly)
  | 'jar_aud_mismatch'               // token aud differs from operator's expectedAudience
  | 'jar_iss_sub_mismatch'           // token iss !== sub under strict-iss enforcement
  | 'jar_iat_stale'                  // token iat older than maxTokenAgeSeconds
  // Step 3.7 — replay cache
  | 'replay_consumed'                // jti already consumed (→ INVALID_SIGNATURE)
  | 'replay_port_outage'             // cache port threw (→ ANOMALY_FLAGGED, fail-closed)
  // Step 4 — policy
  | 'policy_missing'                 // policy_id not in DB (collapses to POLICY_EXPIRED publicly)
  | 'policy_revoked'
  | 'policy_expired'
  // Step 5 — scope category
  | 'scope_category_not_granted'
  // Step 6 — domain allow-list
  | 'scope_domain_not_allowed'
  // Step 6.5 — RAR evaluation (each → SCOPE_NOT_GRANTED publicly).
  // Names align 1:1 with RarDenyReason in rar.types.ts.
  | 'rar_type_unauthorized'
  | 'rar_action_unauthorized'
  | 'rar_instrument_not_whitelisted'
  | 'rar_destination_not_whitelisted'
  | 'rar_resource_not_whitelisted'
  | 'rar_limit_exceeded'
  | 'rar_currency_unauthorized'
  | 'rar_pii_disallowed'
  | 'rar_outside_trading_hours'
  | 'rar_no_authorization_details'
  // Step 7 — spend limits
  | 'spend_limit_exceeded'
  // Step 8 — trust score
  | 'trust_below_minimum'
  // Step 9 — anomaly hard-flag
  | 'anomaly_flagged'
  // Pre-algorithm gates surfaced through this enum for service-layer parity
  // (used by billing/trial gates that compose with the algorithm — emitted
  // by the service adapter, not by verifyAlgorithm directly).
  | 'plan_limit_exceeded'
  | 'trial_exhausted'
  // Intent manifest mismatch (ADR-0016) — wired through BATE today; reserved
  // here so the union enumerates every possible denialReason mapping.
  | 'intent_mismatch';

/**
 * Public-safe denial context surfaced in the algorithm output. The
 * shape is intentionally minimal: just the discriminator kind. Anything
 * richer would risk leaking operator config or per-deployment policy
 * thresholds into buyer-visible responses (see threat-model split in
 * DenialContextKind JSDoc).
 */
export interface DenialContext {
  kind: DenialContextKind;
}

/** Closed enumeration of all DenialContextKind values. Exported for
 *  parity-test consumption (so the cross-package spec can lock the
 *  set without re-listing every value in two places). KEEP IN SYNC
 *  with the union above — TS exhaustiveness in the algorithm will
 *  catch most drift, but the parity test catches the SET-level drift. */
export const ALL_DENIAL_CONTEXT_KINDS: readonly DenialContextKind[] = [
  'token_malformed',
  'agent_unknown',
  'agent_revoked',
  'agent_suspended',
  'signature_invalid',
  'jar_aud_mismatch',
  'jar_iss_sub_mismatch',
  'jar_iat_stale',
  'replay_consumed',
  'replay_port_outage',
  'policy_missing',
  'policy_revoked',
  'policy_expired',
  'scope_category_not_granted',
  'scope_domain_not_allowed',
  'rar_type_unauthorized',
  'rar_action_unauthorized',
  'rar_instrument_not_whitelisted',
  'rar_destination_not_whitelisted',
  'rar_resource_not_whitelisted',
  'rar_limit_exceeded',
  'rar_currency_unauthorized',
  'rar_pii_disallowed',
  'rar_outside_trading_hours',
  'rar_no_authorization_details',
  'spend_limit_exceeded',
  'trust_below_minimum',
  'anomaly_flagged',
  'plan_limit_exceeded',
  'trial_exhausted',
  'intent_mismatch',
] as const;

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
  /**
   * Public-safe discriminator below the locked ADR-0004 denial-precedence
   * enum. Set whenever `denialReason` is set (denial paths) and null on
   * approval. Lets operators and integrators differentiate the five
   * INVALID_SIGNATURE rejection conditions (signature / aud / iss / iat /
   * replay) and the seven RAR sub-reasons (action_unauthorized /
   * limit_exceeded / etc.) without growing the locked enum.
   *
   * See `DenialContextKind` JSDoc for the threat-model split that keeps
   * operator config (expected aud, max-age threshold) OUT of this field —
   * the service-adapter emits those specifics to structured logs only.
   */
  denialContext: DenialContext | null;
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
  scopes: {
    category: string;
    spendLimit?: { currency: string; maxPerTransaction?: number; maxPerDay?: number; maxPerMonth?: number };
    allowedDomains?: string[];
  }[];
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

  // RFC 9101 (JAR) optional claims. When present, the verify algorithm
  // enforces them after signature verification. Keeping these fields
  // here (not in the Nest-side AgentTokenClaims) ensures the Cloudflare
  // Worker adapter sees the same shape — CLAUDE.md invariant #2.

  /** RFC 9101 / RFC 7519 §4.1.1 — Issuer. Usually equals `sub`. */
  iss?: string;
  /** RFC 9101 / RFC 7519 §4.1.3 — Audience (AEGIS issuer URL). */
  aud?: string;
  /** RFC 9396 RAR — inline authorization_details signed by the agent.
   *  When non-empty, the algorithm evaluates them via the pure RAR
   *  evaluator at Step 6.5 (between scope/domain and spend). A RAR
   *  denial maps to SCOPE_NOT_GRANTED to honor the locked denial
   *  precedence — the buyer-facing detail flows through observability,
   *  not the denialReason enum. */
  authorization_details?: ReadonlyArray<Record<string, unknown>>;
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

  /**
   * RFC 9101 (JAR) audience binding — return the URL this AS expects to
   * see in a signed token's `aud` claim. The Nest adapter returns the
   * operator-configured AEGIS issuer URL (typically `config.apiBaseUrl`,
   * env `AEGIS_ISSUER`); the Worker adapter returns its own configured
   * audience.
   *
   * Return `undefined` to disable aud-claim binding (backward-compat for
   * deployments that haven't set the env yet, AND for tests that don't
   * exercise this path).
   *
   * When THIS returns a string AND the token CARRIES an aud claim AND
   * they don't match → INVALID_SIGNATURE at Step 3.4. Tokens without an
   * aud claim flow through unchanged. This is the layered-defense shape:
   * operator opts in by setting the env, agents opt in by signing aud
   * into their JARs.
   */
  expectedAudience?(): string | undefined;

  /**
   * RFC 9101 (JAR) max-iat-age binding — return the maximum allowed age
   * in seconds for a token's `iat` claim. When configured, tokens whose
   * `iat` is older than (now - this) are rejected with INVALID_SIGNATURE
   * at Step 3.6, EVEN IF `exp` is still in the future.
   *
   * Defense against long-lived tokens being replayed within their exp
   * window after credential exposure (logs, screenshots). `exp` + jti
   * replay cache already bound the replay window; this gate tightens it.
   *
   * Return `undefined` to disable. Operator opts in via
   * `AEGIS_MAX_TOKEN_AGE_SECONDS` env. 300s (5 min) is the conventional
   * FAPI 2.0 ceiling.
   */
  maxTokenAgeSeconds?(): number | undefined;

  /**
   * RFC 9101 §4 — when true, enforce that a token's `iss` claim (if
   * present) equals its `sub` claim. RFC 9101 specifies `iss` SHOULD
   * be the client_id; in AEGIS that's the agent_id (= sub). A mismatch
   * is a client-SDK bug or impersonation attempt and is rejected with
   * INVALID_SIGNATURE at Step 3.5.
   *
   * Return false / undefined to skip the check (backward compat for
   * SDKs that set `iss` to something else, e.g. principal_id).
   * Operator opts in via `AEGIS_STRICT_JAR_ISS` env.
   */
  requireIssMatchesSub?(): boolean | undefined;

  featureFlags?: { bateEnabled?: boolean };
}
