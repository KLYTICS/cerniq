import type { HttpClient } from './http.js';
import type { CreatePolicyInput, PolicyRecord } from './types.js';

export class PolicyClient {
  constructor(private readonly http: HttpClient) {}

  create(agentId: string, input: CreatePolicyInput): Promise<PolicyRecord> {
    const expiresAt =
      input.expiresAt instanceof Date ? input.expiresAt.toISOString() : input.expiresAt;
    return this.http.request<PolicyRecord>(
      `/agents/${encodeURIComponent(agentId)}/policies`,
      {
        method: 'POST',
        body: { label: input.label, scopes: input.scopes, expiresAt },
      },
    );
  }

  list(agentId: string): Promise<PolicyRecord[]> {
    return this.http.request(`/agents/${encodeURIComponent(agentId)}/policies`, { method: 'GET' });
  }

  revoke(agentId: string, policyId: string): Promise<void> {
    return this.http.request(
      `/agents/${encodeURIComponent(agentId)}/policies/${encodeURIComponent(policyId)}`,
      { method: 'DELETE' },
    );
  }
}
