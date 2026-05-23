// Public types for @okoro/verifier-rp. Hand-written rather than generated;
// these are the surface third parties code against.

/**
 * Denial reasons returned in a failed VerifyOutcome. Mirrors the OKORO denial
 * precedence (see CLAUDE.md § Architecture invariants #6) but extends it with
 * REPLAY_DETECTED — a relying-party-local determination that the same `jti`
 * has been verified before.
 *
 * Note: REPLAY_DETECTED collapses to INVALID_SIGNATURE in the wire response
 * by default — relying parties should not leak whether a verification failed
 * because of a forged signature vs. a replayed token. The category remains
 * available in the typed outcome for logging.
 */
export type DenialReason =
  | 'INVALID_SIGNATURE'
  | 'POLICY_EXPIRED'
  | 'POLICY_REVOKED'
  | 'AGENT_REVOKED'
  | 'AGENT_NOT_FOUND'
  | 'SCOPE_NOT_GRANTED'
  | 'TRIAL_EXHAUSTED'
  | 'SPEND_LIMIT_EXCEEDED'
  | 'REPLAY_DETECTED'
  | 'TRUST_SCORE_TOO_LOW'
  | 'ANOMALY_FLAGGED';

export type TrustBand = 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';

export type AgentStatusValue = 'pending_verification' | 'active' | 'suspended' | 'revoked';

export interface AgentStatusSnapshot {
  agentId: string;
  status: AgentStatusValue;
  trustScore: number;
  trustBand: TrustBand;
  lastSeenAt?: string | null;
  /** Optional public key — if the relying party's status endpoint returns it. */
  publicKey?: string;
}

export interface OkoroJwtHeader {
  alg: 'EdDSA';
  typ?: 'JWT';
  kid?: string;
}

/**
 * Claims OKORO agent tokens carry. Field names match
 * `packages/sdk-ts/src/crypto.ts#signAgentToken`.
 */
export interface OkoroJwtClaims {
  /** Subject — the agent id. */
  sub: string;
  /** Policy id. */
  pid: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expires, epoch seconds. */
  exp: number;
  /** Unique token id, used for replay defense. */
  jti: string;
  /** Action being authorized (e.g. "commerce.purchase"). */
  act: string;
  /** Optional amount (only present for commerce-class actions). */
  amt?: number;
  /** Optional currency. */
  cur?: string;
  /** Optional merchant domain. */
  dom?: string;
  /** Optional merchant id. */
  mid?: string;
  /** Optional principal id (the developer that owns the agent). */
  iss?: string;
  /** Optional scope categories baked into the token by OKORO. */
  scopes?: string[];
  /** Optional trust band echoed by OKORO at issue time. */
  tb?: TrustBand;
  /** Optional allowed domains echoed from policy. */
  ad?: string[];
}

/**
 * Request-time context the relying party already knows. The verifier checks
 * the token's claims against this.
 */
export interface VerifyContext {
  action?: string;
  amount?: number;
  currency?: string;
  merchantDomain?: string;
  merchantId?: string;
  /** Optional minimum trust score required for this request. */
  minTrustScore?: number;
}

export interface VerifyOutcomeSuccess {
  valid: true;
  agentId: string;
  principalId: string | null;
  policyId: string;
  scopes: string[];
  trustBand: TrustBand | null;
  trustScore: number | null;
  claims: OkoroJwtClaims;
  /** Time of verification — epoch milliseconds. */
  verifiedAt: number;
}

export interface VerifyOutcomeFailure {
  valid: false;
  reason: DenialReason;
  detail?: string;
  /** When parsing succeeded but later checks failed, the partial claims. */
  claims?: OkoroJwtClaims;
  verifiedAt: number;
}

export type VerifyOutcome = VerifyOutcomeSuccess | VerifyOutcomeFailure;

/** Pluggable replay cache contract. Default impl is in-memory LRU. */
export interface ReplayCache {
  has(jti: string): boolean | Promise<boolean>;
  set(jti: string, ttlSeconds: number): void | Promise<void>;
  delete(jti: string): void | Promise<void>;
  size(): number | Promise<number>;
}

/** Pluggable logger. Default is no-op. */
export interface Logger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Callback the relying party supplies to look up an agent's Ed25519 public
 * key. OKORO's `/v1/agents/:id/status` endpoint does not include the public
 * key in its public response, so the relying party must wire either:
 *   (a) a cached fetch against an authenticated OKORO endpoint, or
 *   (b) the public key it stored at agent registration time, or
 *   (c) a JWKS subset endpoint per agent id.
 *
 * Returns the 32-byte raw public key. Throw to fail the verification.
 */
export type GetAgentPublicKey = (agentId: string) => Promise<Uint8Array>;

/** Webhook hook — invoked when revocation should be invalidated immediately. */
export type RevocationWebhookHandler = (agentId: string) => void;

export interface OkoroVerifierConfig {
  /**
   * Base URL for the OKORO API. Used for JWKS fetch and agent status fetch.
   * Default: `https://api.okoroapp.com/v1`.
   */
  baseUrl?: string;
  /**
   * Required: how to look up an agent's public key. See {@link GetAgentPublicKey}.
   * If omitted, the verifier fails at construction time.
   */
  getAgentPublicKey: GetAgentPublicKey;
  /** JWKS cache TTL in seconds. Default 3600. */
  jwksCacheTtlSeconds?: number;
  /** Revocation cache TTL in seconds. Default 30. */
  revocationCacheTtlSeconds?: number;
  /** Replay cache max size. Default 10_000. */
  replayCacheMaxSize?: number;
  /**
   * Token TTL clock skew in seconds, applied symmetrically to iat and exp.
   * Default 5.
   */
  clockSkewSeconds?: number;
  /** Inject a custom replay cache (e.g. Redis-backed). */
  replayCache?: ReplayCache;
  /** Inject a custom fetch implementation (default: globalThis.fetch). */
  fetch?: typeof globalThis.fetch;
  /** Optional structured logger. */
  logger?: Logger;
}

export interface VerifyOptions {
  /** Required scope category — fails with SCOPE_NOT_GRANTED if absent. */
  requiredScope?: string;
  /** Override default skew for this call. */
  clockSkewSeconds?: number;
}

export interface JwksKey {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
  use?: 'sig';
  alg?: 'EdDSA';
}

export interface JwksDocument {
  keys: JwksKey[];
}
