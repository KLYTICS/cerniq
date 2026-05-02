import { HttpClient } from './http.js';
import { AgentClient } from './agent.js';
import { PolicyClient } from './policy.js';
import { signAgentToken } from './crypto.js';
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

export { generateKeypair, signAgentToken, decodeUnsafe } from './crypto.js';
export {
  AegisError,
  AegisAuthenticationError,
  AegisAuthorizationError,
  AegisNotFoundError,
  AegisValidationError,
  AegisConflictError,
  AegisRateLimitedError,
  AegisInternalError,
  AegisNetworkError,
  fromEnvelope,
} from './errors.js';
export type * from './types.js';
