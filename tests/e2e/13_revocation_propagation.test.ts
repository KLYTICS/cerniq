import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Okoro } from '@okoro/sdk';
import { RawClient, makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, createPolicy, signTokenFor } from './_support/fixtures';
import { pollUntil } from './_support/retry';

describe('13 · revocation propagation', () => {
  let sdk: Okoro;
  let raw: RawClient;
  const cleanup: string[] = [];

  beforeAll(() => {
    const cfg = readConfig();
    sdk = makeSdk(cfg);
    raw = new RawClient(cfg);
  });

  afterAll(async () => {
    for (const id of cleanup) {
      try {
        await sdk.agents.revoke(id);
      } catch {
        /* ignore */
      }
    }
  });

  it('revoke agent → /status reflects within 1s and subsequent verify is denied', async () => {
    const agent = await createAgent(sdk);
    // intentional: do NOT push to cleanup since we revoke explicitly here.
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);

    // Sanity: status before revoke.
    const before = await raw.get<{ status: string }>(`/v1/agents/${agent.agentId}/status`, { auth: 'none' });
    expect(before.body.status.toLowerCase()).toMatch(/active|pending/);

    await sdk.agents.revoke(agent.agentId);

    // Status flips to revoked within 1s.
    const after = await pollUntil(
      async () => {
        const r = await raw.get<{ status: string }>(`/v1/agents/${agent.agentId}/status`, { auth: 'none' });
        return r.body;
      },
      (b) => b.status.toLowerCase() === 'revoked',
      { timeoutMs: 1_500, intervalMs: 100 },
    );
    expect(after.status.toLowerCase()).toBe('revoked');

    // A token signed before revocation must now be denied with AGENT_REVOKED.
    const token = await signTokenFor(agent, policy.policyId, {
      action: 'commerce.purchase',
      amount: 1,
      currency: 'USD',
    });
    const result = await sdk.verify(token, { action: 'commerce.purchase', amount: 1, currency: 'USD' });
    expect(result.valid).toBe(false);
    expect(result.denialReason).toBe('AGENT_REVOKED');
  });
});
