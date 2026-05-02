// AegisVerifier — the public entry point for the relying-party verifier.
//
// Verification algorithm (fail-fast, in order):
//   1. Parse compact JWS.
//   2. alg=EdDSA only.
//   3. Validate iat/exp against now() ± clockSkew.
//   4. Resolve verifying key (header.kid → JWKS, else claims.sub → callback).
//   5. Verify Ed25519 signature.
//   6. Replay check (jti).
//   7. Revocation check (agent status).
//   8. Scope/spend check vs request context.
//
// The verifier never throws on malformed input — it returns a structured
// VerifyOutcomeFailure. It only throws for programmer/infrastructure errors
// (config mistakes, JWKS endpoint unreachable, etc.), in which case the
// thrown value is a {@link VerifyError} subclass.

import { ConfigError, VerifyError } from './errors.js';
import { JwksClient } from './jwks.js';
import type { JwksKey } from './types.js';
import { parseCompactJws, verifyEdDSA, type ParsedJws } from './jwt.js';
import { normalizeClaims, remainingTtlSeconds } from './policy-claims.js';
import { MemoryReplayCache } from './replay-cache.js';
import { RevocationCache } from './revocation-cache.js';
import { checkScopeAndSpend } from './scope-check.js';
import type {
  AegisVerifierConfig,
  AgentStatusSnapshot,
  DenialReason,
  ReplayCache,
  VerifyContext,
  VerifyOptions,
  VerifyOutcome,
  VerifyOutcomeFailure,
  VerifyOutcomeSuccess,
} from './types.js';
import { now, nowSeconds } from './_internal/time.js';

const DEFAULT_BASE_URL = 'https://api.aegislabs.io/v1';
const DEFAULT_JWKS_TTL = 3600;
const DEFAULT_REVOCATION_TTL = 30;
const DEFAULT_REPLAY_MAX = 10_000;
const DEFAULT_SKEW_SECONDS = 5;

export class AegisVerifier {
  private readonly config: Required<
    Omit<AegisVerifierConfig, 'replayCache' | 'fetch' | 'logger'>
  > & {
    replayCache: ReplayCache;
    fetchImpl: typeof globalThis.fetch;
    logger: AegisVerifierConfig['logger'];
  };

  private readonly jwksClient: JwksClient;
  private readonly revocationCache: RevocationCache;

  constructor(config: AegisVerifierConfig) {
    if (typeof config !== 'object' || config === null) {
      throw new ConfigError('AegisVerifier: config object is required');
    }
    if (typeof config.getAgentPublicKey !== 'function') {
      throw new ConfigError(
        'AegisVerifier: getAgentPublicKey callback is required. ' +
          'Supply a function (agentId) => Promise<Uint8Array> that resolves the agent public key. ' +
          'See README "Resolving agent keys".',
      );
    }
    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new ConfigError(
        'AegisVerifier: no fetch implementation available. Pass `fetch: customFetch` or run on a runtime with global fetch.',
      );
    }

    this.config = {
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      jwksCacheTtlSeconds: config.jwksCacheTtlSeconds ?? DEFAULT_JWKS_TTL,
      revocationCacheTtlSeconds: config.revocationCacheTtlSeconds ?? DEFAULT_REVOCATION_TTL,
      replayCacheMaxSize: config.replayCacheMaxSize ?? DEFAULT_REPLAY_MAX,
      clockSkewSeconds: config.clockSkewSeconds ?? DEFAULT_SKEW_SECONDS,
      getAgentPublicKey: config.getAgentPublicKey,
      replayCache:
        config.replayCache ??
        new MemoryReplayCache({ maxSize: config.replayCacheMaxSize ?? DEFAULT_REPLAY_MAX }),
      fetchImpl,
      logger: config.logger,
    };

    this.jwksClient = new JwksClient({
      baseUrl: this.config.baseUrl,
      cacheTtlSeconds: this.config.jwksCacheTtlSeconds,
      fetchImpl,
      ...(this.config.logger ? { logger: this.config.logger } : {}),
    });
    this.revocationCache = new RevocationCache({
      baseUrl: this.config.baseUrl,
      cacheTtlSeconds: this.config.revocationCacheTtlSeconds,
      fetchImpl,
      ...(this.config.logger ? { logger: this.config.logger } : {}),
    });
  }

  /**
   * Pre-fetch the JWKS at startup so the first verify() call is hot.
   * Optional; call once during boot to avoid first-request latency.
   */
  async prefetchJwks(): Promise<void> {
    await this.jwksClient.prefetch();
  }

  /**
   * Drop the cached revocation status for an agent. Call this from your
   * webhook handler when AEGIS notifies you of `aegis.agent.revoked`.
   */
  invalidateAgent(agentId: string): void {
    this.revocationCache.invalidate(agentId);
  }

  /**
   * Test-only seam: seed the JWKS cache directly (bypasses the network).
   */
  _seedJwks(keys: JwksKey[]): void {
    this.jwksClient._seed(keys);
  }

  /**
   * Verify a token. Returns a {@link VerifyOutcome}. Throws only on
   * infrastructure or config failures (network unreachable, etc.).
   */
  async verify(
    token: string,
    context: VerifyContext = {},
    options: VerifyOptions = {},
  ): Promise<VerifyOutcome> {
    const verifiedAt = now();
    const skew = options.clockSkewSeconds ?? this.config.clockSkewSeconds;

    // 1. Parse.
    const parsed = parseCompactJws(token);
    if (!parsed) {
      return this.fail('INVALID_SIGNATURE', 'malformed token');
    }

    // 2. alg gate.
    if (parsed.header.alg !== 'EdDSA') {
      return this.fail('INVALID_SIGNATURE', `unsupported alg: ${String(parsed.header.alg)}`);
    }

    const claims = normalizeClaims(parsed.claims);

    // 3. Time bounds.
    const nowS = nowSeconds();
    if (claims.exp <= nowS - skew) {
      return this.failWithClaims('POLICY_EXPIRED', `exp=${claims.exp} now=${nowS}`, parsed);
    }
    if (claims.iat > nowS + skew) {
      return this.failWithClaims(
        'INVALID_SIGNATURE',
        `iat in the future: iat=${claims.iat} now=${nowS}`,
        parsed,
      );
    }

    // 4. Resolve the verification key.
    let publicKey: Uint8Array | null = null;
    try {
      if (parsed.header.kid) {
        publicKey = await this.jwksClient.getKey(parsed.header.kid);
        if (!publicKey) {
          return this.failWithClaims(
            'INVALID_SIGNATURE',
            `unknown kid: ${parsed.header.kid}`,
            parsed,
          );
        }
      } else {
        publicKey = await this.config.getAgentPublicKey(claims.agentId);
        if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
          throw new VerifyError(
            'AGENT_KEY_LOOKUP_FAILED',
            `getAgentPublicKey returned invalid key for ${claims.agentId}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof VerifyError) throw err;
      // Lookup callback may throw arbitrary errors — wrap them.
      throw new VerifyError(
        'AGENT_KEY_LOOKUP_FAILED',
        `getAgentPublicKey threw for ${claims.agentId}`,
        err,
      );
    }

    // 5. Verify signature.
    const sigOk = await verifyEdDSA(parsed, publicKey);
    if (!sigOk) {
      return this.failWithClaims('INVALID_SIGNATURE', 'Ed25519 signature mismatch', parsed);
    }

    // 6. Replay defense. We do this *after* signature verification — there's
    // no point caching jtis from forged tokens, and signature-first is also
    // the more constant-time order from a side-channel perspective.
    const seen = await Promise.resolve(this.config.replayCache.has(claims.jti));
    if (seen) {
      // Surface as INVALID_SIGNATURE on the wire so we don't leak whether
      // the failure was forgery vs. replay. The internal reason stays
      // REPLAY_DETECTED for the caller's observability.
      return this.failWithClaims('REPLAY_DETECTED', `jti reused: ${claims.jti}`, parsed);
    }
    const replayTtl = remainingTtlSeconds(claims.exp, nowS) + skew;
    await Promise.resolve(this.config.replayCache.set(claims.jti, replayTtl));

    // 7. Revocation. Lazy-fetch + TTL cache.
    let snapshot: AgentStatusSnapshot;
    try {
      snapshot = await this.revocationCache.getStatus(claims.agentId);
    } catch (err) {
      // Revocation freshness is a security-relevant signal. Per CLAUDE.md
      // invariant #4 we surface it rather than fail open.
      throw err instanceof VerifyError
        ? err
        : new VerifyError('REVOCATION_FETCH_FAILED', 'revocation lookup failed', err);
    }
    if (snapshot.status === 'revoked' || snapshot.status === 'suspended') {
      return this.failWithClaims(
        'AGENT_REVOKED',
        `agent status=${snapshot.status}`,
        parsed,
      );
    }

    // Min trust score gate (relying-party-side policy override).
    if (
      context.minTrustScore !== undefined &&
      snapshot.trustScore < context.minTrustScore
    ) {
      return this.failWithClaims(
        'TRUST_SCORE_TOO_LOW',
        `trustScore=${snapshot.trustScore} < required=${context.minTrustScore}`,
        parsed,
      );
    }

    // 8. Scope / spend.
    const scopeFailure = checkScopeAndSpend(claims, context, options.requiredScope);
    if (scopeFailure) {
      return this.failWithClaims(scopeFailure.reason, scopeFailure.detail, parsed);
    }

    const success: VerifyOutcomeSuccess = {
      valid: true,
      agentId: claims.agentId,
      principalId: claims.principalId,
      policyId: claims.policyId,
      scopes: claims.scopes,
      trustBand: snapshot.trustBand,
      trustScore: snapshot.trustScore,
      claims: parsed.claims,
      verifiedAt,
    };
    return success;
  }

  private fail(reason: DenialReason, detail: string): VerifyOutcomeFailure {
    return { valid: false, reason, detail, verifiedAt: now() };
  }

  private failWithClaims(
    reason: DenialReason,
    detail: string,
    parsed: ParsedJws,
  ): VerifyOutcomeFailure {
    return {
      valid: false,
      reason,
      detail,
      claims: parsed.claims,
      verifiedAt: now(),
    };
  }
}
