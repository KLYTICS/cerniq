import { HttpClient } from './http.js';
import { AgentClient, type HandshakeVerified } from './agent.js';
import { PolicyClient } from './policy.js';
import { signAgentToken, signHandshake } from './crypto.js';
import type { AegisConfig, SignContext, VerifyResult } from './types.js';
import { quickstart, type QuickstartBundle, type QuickstartOptions } from './quickstart.js';
import { detectRuntime, capabilities, type AegisRuntime, type RuntimeCapabilities } from './runtime.js';

const DEFAULT_BASE_URL = 'https://api.aegislabs.io';
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Region → endpoint resolution. Round 25 — scaffold. Every region currently
 * resolves to the single public endpoint `api.aegislabs.io`. Once EU/APAC
 * deployments land, the values become `api-eu.aegislabs.io` /
 * `api-apac.aegislabs.io` and the SDK caller experience does not change.
 */
const REGION_ENDPOINTS: Readonly<Record<string, string>> = Object.freeze({
  us: 'https://api.aegislabs.io',
  eu: 'https://api.aegislabs.io',
  apac: 'https://api.aegislabs.io',
});

type Region = 'us' | 'eu' | 'apac' | 'auto';

/**
 * Resolve the base URL using this precedence:
 *   1. `config.baseUrl` (explicit override)
 *   2. `AEGIS_API_URL` environment variable
 *   3. region-mapped endpoint (`config.region` or `AEGIS_REGION` env)
 *   4. `DEFAULT_BASE_URL`
 */
function resolveBaseUrl(configBaseUrl: string | undefined, configRegion: Region | undefined): string {
  if (configBaseUrl && configBaseUrl.length > 0) return configBaseUrl;
  // type-rationale: process.env is Node-shaped; defensive guard for edge.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).process;
  const envUrl: unknown = proc?.env?.AEGIS_API_URL;
  if (typeof envUrl === 'string' && envUrl.length > 0) return envUrl;
  const region = configRegion ?? (proc?.env?.AEGIS_REGION as Region | undefined);
  if (region && region !== 'auto' && region in REGION_ENDPOINTS) {
    return REGION_ENDPOINTS[region]!;
  }
  return DEFAULT_BASE_URL;
}

export class Aegis {
  readonly agents: AgentClient;
  readonly policies: PolicyClient;
  private readonly http: HttpClient;

  constructor(config: AegisConfig = {}) {
    this.http = new HttpClient({
      apiKey: config.apiKey,
      verifyKey: config.verifyKey,
      baseUrl: resolveBaseUrl(config.baseUrl, config.region),
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetch: config.fetch,
      userAgent: config.userAgent,
    });
    this.agents = new AgentClient(this.http);
    this.policies = new PolicyClient(this.http);
  }

  /**
   * Round 25 — one-call onboarding. Returns `{aegis, agent, policy, sign}`
   * ready for first verify. See `quickstart.ts` for the full option surface.
   */
  static quickstart(opts: QuickstartOptions = {}): Promise<QuickstartBundle> {
    return quickstart(opts);
  }

  /**
   * Round 25 — detected runtime. Static so callers can branch before
   * constructing the client.
   */
  static runtime(): AegisRuntime {
    return detectRuntime();
  }

  /** Round 25 — full capability snapshot. */
  static capabilities(): RuntimeCapabilities {
    return capabilities();
  }

  /**
   * Sign a per-request agent token. Convenience wrapper around the lower-level
   * `signAgentToken` so the most common flow is a single call.
   */
  sign(privateKeyB64u: string, agentId: string, policyId: string, ctx: SignContext): Promise<string> {
    return signAgentToken(privateKeyB64u, agentId, policyId, ctx);
  }

  /**
   * One-call handshake. Issues a challenge, signs the returned message with
   * the supplied Ed25519 private key, posts the signature to verify-handshake,
   * and returns the verified record. Idempotent — safe to call repeatedly;
   * each call mints a fresh nonce.
   *
   * Use this when you have direct access to the agent's private key (CLI
   * one-liner, server-to-server). For browser flows where the key is in a
   * vault or KMS, call `agents.challenge()` and `agents.verifyHandshake()`
   * separately and route the signing through your KMS.
   */
  async handshake(agentId: string, privateKeyB64u: string): Promise<HandshakeVerified> {
    const challenge = await this.agents.challenge(agentId);
    const signature = await signHandshake(privateKeyB64u, challenge.message);
    return this.agents.verifyHandshake(agentId, signature);
  }

  /**
   * Verify an inbound agent token. Relying-party endpoint — uses the
   * verify-only key automatically.
   */
  verify(
    token: string,
    ctx?: {
      action?: string;
      amount?: number;
      currency?: string;
      merchantDomain?: string;
      merchantId?: string;
    },
  ): Promise<VerifyResult> {
    return this.http.request<VerifyResult>('/verify', {
      method: 'POST',
      verifyOnly: true,
      body: { token, ...(ctx ?? {}) },
    });
  }
}

export { generateKeypair, signAgentToken, signHandshake, decodeUnsafe } from './crypto.js';
export {
  AegisError,
  AegisAuthenticationError,
  AegisAuthorizationError,
  AegisNotFoundError,
  AegisValidationError,
  AegisConflictError,
  AegisRateLimitedError,
  AegisInternalError,
  AegisServiceUnavailableError,
  AegisNetworkError,
  fromEnvelope,
  isAegisErrorRetryable,
  catalogEntryFor,
} from './errors.js';
export { withRetry, parseRetryAfter } from './http.js';
export type { RetryOptions } from './http.js';
export { MemoryVerifyCache, buildCacheKey, clampTtlMs } from './cache.js';
export type { VerifyCache, CachedVerify, VerifyCacheContext } from './cache.js';
export { VerifyGateway } from './verify-gateway.js';
export type {
  VerifyGatewayOptions,
  VerifyGatewayHooks,
  VerifyGatewayMetrics,
  BreakerState,
  FallbackMode,
} from './verify-gateway.js';
export type * from './types.js';

// Round 25 supplement — shared denial envelope helper. Re-exported from
// @aegis/types so adapter packages (and any future RP code) can lock the
// envelope shape structurally instead of inlining it. See the parity
// test in tests/cross-package/adapter-denial-envelope-parity.spec.ts.
export {
  buildDenialEnvelope,
  DENIAL_ENVELOPE_REQUIRED_KEYS,
  DENIAL_ENVELOPE_OPTIONAL_KEYS,
  type DenialEnvelope,
  type BuildDenialInput,
} from '@aegis/types';

// Round 25 — Lane A adoption-surface additions.
export { quickstart } from './quickstart.js';
export type { QuickstartOptions, QuickstartBundle } from './quickstart.js';
export {
  detectRuntime,
  capabilities,
  type AegisRuntime,
  type RuntimeCapabilities,
} from './runtime.js';
export {
  memoryKeyStorage,
  fileSystemKeyStorage,
  indexedDBKeyStorage,
  defaultKeyStorage,
  type KeyStorage,
  type StoredKey,
  type KmsKeyStorage,
} from './key-storage.js';
