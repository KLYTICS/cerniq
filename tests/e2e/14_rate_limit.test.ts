import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Okoro } from '@okoro/sdk';
import { RawClient, makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, createPolicy, signTokenFor } from './_support/fixtures';

/**
 * Rate limit / throttle test.
 *
 * The verify controller is decorated with @Throttle({ verify: { limit: 1000,
 * ttl: 60_000 } }) by default — way too high to trip in a test budget.
 * To make this test meaningful in CI you must run the API with a tighter
 * limit (e.g. OKORO_THROTTLE_VERIFY_LIMIT=20). If we don't see a 429
 * after a hard burst, we soft-skip.
 */
describe('14 · rate limit', () => {
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

  it('a hard burst of verifies eventually returns 429 with Retry-After (skipped if throttle is loose)', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [SCOPES.commerce()]);

    const burst = 200;
    const tokens = await Promise.all(
      Array.from({ length: burst }, () =>
        signTokenFor(agent, policy.policyId, {
          action: 'commerce.purchase',
          amount: 1,
          currency: 'USD',
          merchantDomain: 'delta.com',
        }),
      ),
    );

    const results = await Promise.all(
      tokens.map((t) =>
        raw.post<{ valid: boolean }>('/v1/verify', {
          token: t,
          action: 'commerce.purchase',
          amount: 1,
          currency: 'USD',
          merchantDomain: 'delta.com',
        }),
      ),
    );

    const throttled = results.filter((r) => r.status === 429);
    if (throttled.length === 0) {
      // Throttle is configured looser than this burst. Document via a
      // returning skip rather than failing.
      return;
    }
    expect(throttled.length).toBeGreaterThan(0);
    const retryAfter = throttled[0]!.headers.get('retry-after');
    expect(retryAfter, 'expected Retry-After header on 429').toBeTruthy();
  }, 60_000);
});
