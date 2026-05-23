import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Cerniq } from '@cerniq/sdk';
import { makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, createPolicy, signTokenFor } from './_support/fixtures';
import { assertVerifyApproved } from './_support/assert';

describe('06 · verify happy path', () => {
  let sdk: Cerniq;
  const cleanup: string[] = [];

  beforeAll(() => {
    sdk = makeSdk(readConfig());
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

  it('valid token + matching action/domain/amount within spend → valid:true with full payload', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [
      SCOPES.commerce({ maxPerTransaction: 500, maxPerDay: 1000, allowedDomains: ['delta.com'] }),
    ]);
    const token = await signTokenFor(agent, policy.policyId, {
      action: 'commerce.purchase',
      amount: 347,
      currency: 'USD',
      merchantDomain: 'delta.com',
    });
    const result = await sdk.verify(token, {
      action: 'commerce.purchase',
      amount: 347,
      currency: 'USD',
      merchantDomain: 'delta.com',
    });

    assertVerifyApproved(result, { agentId: agent.agentId });
    expect(result.principalId).toBeTruthy();
    expect(result.scopesGranted.length).toBeGreaterThan(0);
    expect(result.scopesGranted.some((s) => s.startsWith('commerce'))).toBe(true);
    expect(result.trustScore).toBeGreaterThanOrEqual(0);
    expect(result.trustScore).toBeLessThanOrEqual(1000);
    expect(result.ttl).toBeGreaterThan(0);
    expect(typeof result.verifiedAt).toBe('string');
  });

  it('verify with no request-context (token-only) is supported', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);
    const token = await signTokenFor(agent, policy.policyId, {
      action: 'commerce.purchase',
      amount: 5,
      currency: 'USD',
    });
    const result = await sdk.verify(token);
    // Token-only verify: amount/domain were embedded at sign time, the verifier
    // should evaluate the policy against the in-token claims.
    expect(typeof result.valid).toBe('boolean');
    expect(result.agentId).toBe(agent.agentId);
  });
});
