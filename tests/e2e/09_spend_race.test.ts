import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Okoro } from '@okoro/sdk';
import { makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, createPolicy, signTokenFor } from './_support/fixtures';

/**
 * The TOCTOU test.
 *
 * Pre-sign 50 tokens for $5 each (= $250 against a $100/day cap).
 * Fire all 50 verifies in parallel. The number that come back valid:true,
 * multiplied by the per-tx amount, must NOT exceed the daily cap.
 *
 * Naive read-then-write spend tracking will let many through. Atomic
 * counters (Redis INCRBY + Lua check, or row-level lock with returning)
 * will hold the line.
 */
describe('09 · spend race (TOCTOU)', () => {
  let sdk: Okoro;
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

  it('50 concurrent verifies under a $100/day cap — sum approved <= cap', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [
      SCOPES.commerce({ maxPerTransaction: 50, maxPerDay: 100, allowedDomains: ['delta.com'] }),
    ]);

    const N = 50;
    const PER = 5;
    const tokens = await Promise.all(
      Array.from({ length: N }, () =>
        signTokenFor(agent, policy.policyId, {
          action: 'commerce.purchase',
          amount: PER,
          currency: 'USD',
          merchantDomain: 'delta.com',
        }),
      ),
    );

    const results = await Promise.all(
      tokens.map((token) =>
        sdk.verify(token, { action: 'commerce.purchase', amount: PER, currency: 'USD', merchantDomain: 'delta.com' }),
      ),
    );

    const approved = results.filter((r) => r.valid);
    const denied = results.filter((r) => !r.valid);
    const approvedTotal = approved.length * PER;

    // Must not approve more spend than the cap allows.
    expect(approvedTotal).toBeLessThanOrEqual(100);
    // At least one approval must succeed (otherwise spend evaluation is broken).
    expect(approved.length).toBeGreaterThan(0);
    // Denials must cite spend limit, not be a generic 500 / network error.
    for (const d of denied) {
      expect(d.denialReason).toBe('SPEND_LIMIT_EXCEEDED');
    }
  }, 60_000);
});
