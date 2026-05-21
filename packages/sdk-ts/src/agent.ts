import type { HttpClient } from './http.js';
import type { AgentRecord, AgentStatus, RegisterAgentInput, TrustBand } from './types.js';

export interface HandshakeChallenge {
  agentId: string;
  /** base64url-encoded 256-bit nonce. Single-use, 5 min TTL. */
  challenge: string;
  expiresIn: number;
  protocolVersion: 'aegis-handshake-v1';
  /** UTF-8 string the SDK signs verbatim. */
  message: string;
}

export interface HandshakeVerified {
  agentId: string;
  verifiedAt: string;
  protocolVersion: 'aegis-handshake-v1';
  trustScore: number;
  recordTtlSeconds: number;
}

export interface HandshakeStatus {
  agentId: string;
  verified: boolean;
  verifiedAt?: string;
  protocolVersion?: 'aegis-handshake-v1';
}

export class AgentClient {
  constructor(private readonly http: HttpClient) {}

  register(input: RegisterAgentInput): Promise<AgentRecord> {
    return this.http.request<AgentRecord>('/agents/register', { method: 'POST', body: input });
  }

  get(agentId: string): Promise<AgentRecord> {
    return this.http.request<AgentRecord>(`/agents/${encodeURIComponent(agentId)}`, {
      method: 'GET',
    });
  }

  async revoke(agentId: string): Promise<void> {
    await this.http.request<undefined>(`/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
  }

  status(
    agentId: string,
  ): Promise<{ agentId: string; status: AgentStatus; trustScore: number; trustBand: TrustBand }> {
    return this.http.request(`/agents/${encodeURIComponent(agentId)}/status`, {
      method: 'GET',
      verifyOnly: true,
    });
  }

  audit(
    agentId: string,
    query?: { from?: string; to?: string; limit?: number; cursor?: string },
  ): Promise<{ events: unknown[]; nextCursor: string | null; count: number }> {
    return this.http.request(`/agents/${encodeURIComponent(agentId)}/audit`, {
      method: 'GET',
      query,
    });
  }

  /**
   * Issue a single-use handshake challenge for the agent. Pair with
   * `signHandshake(privateKey, response.message)` and `verifyHandshake()`.
   */
  challenge(agentId: string): Promise<HandshakeChallenge> {
    return this.http.request<HandshakeChallenge>(
      `/agents/${encodeURIComponent(agentId)}/challenge`,
      { method: 'POST' },
    );
  }

  /**
   * Submit a signed handshake response. On success the agent's trust score
   * is lifted to ≥600 and a 30-day proof-of-possession record is cached
   * server-side.
   */
  verifyHandshake(agentId: string, signature: string): Promise<HandshakeVerified> {
    return this.http.request<HandshakeVerified>(
      `/agents/${encodeURIComponent(agentId)}/verify-handshake`,
      { method: 'POST', body: { signature } },
    );
  }

  /**
   * Read the cached handshake-completed record. Returns `verified: false`
   * when the agent has never proven possession (or the record has expired).
   */
  handshakeStatus(agentId: string): Promise<HandshakeStatus> {
    return this.http.request<HandshakeStatus>(
      `/agents/${encodeURIComponent(agentId)}/handshake-status`,
      { method: 'GET' },
    );
  }

  report(
    agentId: string,
    body: {
      eventType:
        | 'fraud_confirmed'
        | 'anomaly'
        | 'policy_violation'
        | 'suspicious_behavior'
        | 'false_positive';
      severity?: 'low' | 'medium' | 'high' | 'critical';
      description?: string;
      transactionId?: string;
      evidence?: Record<string, unknown>;
    },
  ): Promise<{ accepted: true }> {
    return this.http.request(`/agents/${encodeURIComponent(agentId)}/report`, {
      method: 'POST',
      body,
    });
  }
}
