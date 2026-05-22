import { AgentClient, type HandshakeVerified } from './agent.js';
import { signAgentToken, signHandshake } from './crypto.js';
import { HttpClient } from './http.js';
import { PolicyClient } from './policy.js';
import type { AegisConfig, SignContext, VerifyResult } from './types.js';

const DEFAULT_BASE_URL = 'https://api.aegislabs.io';
const DEFAULT_TIMEOUT_MS = 5_000;

export class Aegis {
  readonly agents: AgentClient;
  readonly policies: PolicyClient;
  private readonly http: HttpClient;

  constructor(config: AegisConfig = {}) {
    this.http = new HttpClient({
      apiKey: config.apiKey,
      verifyKey: config.verifyKey,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetch: config.fetch,
      userAgent: config.userAgent,
      onWriteResponse: config.onWriteResponse,
    });
    this.agents = new AgentClient(this.http);
    this.policies = new PolicyClient(this.http);
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
    return await this.agents.verifyHandshake(agentId, signature);
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
export {
  AUTO_IDEMPOTENT_METHODS,
  FIRST_SEEN_HEADER,
  IDEMPOTENCY_HEADER,
  REPLAY_HEADER,
  generateIdempotencyKey,
  parseReplayHeaders,
  resolveIdempotencyKey,
} from './idempotency.js';
export type {
  AutoAttachMode,
  IdempotencyOptions,
  OnWriteResponse,
  ReplayMetadata,
  WriteResponseInfo,
} from './idempotency.js';
export {
  AegisWebhookSignatureInvalidError,
  AegisWebhookSignatureMalformedError,
  AegisWebhookTimestampError,
  DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  verifyWebhookSignature,
} from './webhook.js';
export type { VerifiedWebhook, VerifyWebhookOptions } from './webhook.js';
export type * from './types.js';
