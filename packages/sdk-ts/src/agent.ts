import type { HttpClient } from './http.js';
import type { AgentRecord, AgentStatus, RegisterAgentInput, TrustBand } from './types.js';

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

  revoke(agentId: string): Promise<void> {
    return this.http.request<void>(`/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
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
