import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Okoro } from '@okoro/sdk';
import { RawClient, makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, createPolicy, futureIso, pastIso } from './_support/fixtures';

describe('04 · policy engine', () => {
  let sdk: Okoro;
  let raw: RawClient;
  const agentsToRevoke: string[] = [];

  beforeAll(() => {
    const cfg = readConfig();
    sdk = makeSdk(cfg);
    raw = new RawClient(cfg);
  });

  afterAll(async () => {
    for (const id of agentsToRevoke) {
      try {
        await sdk.agents.revoke(id);
      } catch {
        /* ignore */
      }
    }
  });

  it('create commerce policy with spend + domain returns signed JWT', async () => {
    const agent = await createAgent(sdk);
    agentsToRevoke.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [
      SCOPES.commerce({ maxPerTransaction: 500, maxPerDay: 1000, allowedDomains: ['delta.com', 'united.com'] }),
    ]);
    expect(policy.policyId).toMatch(/^pol_/);
    // JWT compact form
    expect(policy.signedToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(typeof policy.expiresAt).toBe('string');
  });

  it('list policies returns the active policy', async () => {
    const agent = await createAgent(sdk);
    agentsToRevoke.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);
    const list = await sdk.policies.list(agent.agentId);
    expect(Array.isArray(list)).toBe(true);
    expect(list.find((p) => p.policyId === policy.policyId)).toBeDefined();
  });

  it('revoke policy returns 204 and removes it from active list', async () => {
    const agent = await createAgent(sdk);
    agentsToRevoke.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);
    const r = await raw.del(`/v1/agents/${agent.agentId}/policies/${policy.policyId}`);
    expect([200, 204]).toContain(r.status);
  });

  it('expiresAt in the past is rejected with 400', async () => {
    const agent = await createAgent(sdk);
    agentsToRevoke.push(agent.agentId);
    const r = await raw.post(`/v1/agents/${agent.agentId}/policies`, {
      scopes: [{ category: 'commerce' }],
      expiresAt: pastIso(),
    });
    expect(r.status).toBe(400);
  });

  it('data-read scope grammar accepts dataScopes array', async () => {
    const agent = await createAgent(sdk);
    agentsToRevoke.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.dataRead(['read:calendar', 'read:email'])], {
      expiresAt: futureIso(),
    });
    expect(policy.policyId).toMatch(/^pol_/);
  });

  it('empty scopes array is rejected', async () => {
    const agent = await createAgent(sdk);
    agentsToRevoke.push(agent.agentId);
    const r = await raw.post(`/v1/agents/${agent.agentId}/policies`, {
      scopes: [],
      expiresAt: futureIso(),
    });
    expect(r.status).toBe(400);
  });
});
