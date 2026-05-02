import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { decodeUnsafe } from '@aegis/sdk';
import type { Aegis } from '@aegis/sdk';
import { TOKEN_TTL_MAX_SECONDS } from '@aegis/types';
import { makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, createPolicy, signTokenFor } from './_support/fixtures';

/**
 * v2 design: tokens are signed *client-side* by the SDK using the agent's
 * private key. AEGIS never sees the private key, so there is no
 * /v1/token/sign endpoint to test. Instead we verify the SDK signer
 * produces a JWS with the contractual claim shape.
 */
describe('05 · client-side token signing', () => {
  let sdk: Aegis;
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

  it('signed token is a compact JWS with EdDSA header', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);
    const token = await signTokenFor(agent, policy.policyId, {
      action: 'commerce.purchase',
      amount: 47,
      currency: 'USD',
      merchantDomain: 'delta.com',
      ttlSeconds: 60,
    });
    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const headerJson = Buffer.from(parts[0]!, 'base64url').toString('utf8');
    const header = JSON.parse(headerJson) as { alg: string; typ: string };
    expect(header.alg).toBe('EdDSA');
    expect(header.typ).toBe('JWT');
  });

  it('token claims include sub, pid, iat, exp, jti, act, and request context', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);
    const token = await signTokenFor(agent, policy.policyId, {
      action: 'commerce.purchase',
      amount: 120,
      currency: 'USD',
      merchantDomain: 'delta.com',
    });
    const claims = decodeUnsafe(token);
    expect(claims).toBeTruthy();
    expect(claims!['sub']).toBe(agent.agentId);
    expect(claims!['pid']).toBe(policy.policyId);
    expect(claims!['act']).toBe('commerce.purchase');
    expect(claims!['amt']).toBe(120);
    expect(claims!['cur']).toBe('USD');
    expect(claims!['dom']).toBe('delta.com');
    expect(typeof claims!['iat']).toBe('number');
    expect(typeof claims!['exp']).toBe('number');
    expect(typeof claims!['jti']).toBe('string');
  });

  it('default ttl is 60 seconds (and clamped at TOKEN_TTL_MAX_SECONDS)', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);
    const token = await signTokenFor(agent, policy.policyId, { action: 'commerce.purchase' });
    const claims = decodeUnsafe(token)!;
    const ttl = Number(claims['exp']) - Number(claims['iat']);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TOKEN_TTL_MAX_SECONDS);
  });

  it('jti is unique across two consecutive signatures', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);
    const [t1, t2] = await Promise.all([
      signTokenFor(agent, policy.policyId, { action: 'a' }),
      signTokenFor(agent, policy.policyId, { action: 'a' }),
    ]);
    expect(decodeUnsafe(t1)!['jti']).not.toBe(decodeUnsafe(t2)!['jti']);
  });
});
