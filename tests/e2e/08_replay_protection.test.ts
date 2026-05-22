import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Okoro } from '@okoro/sdk';
import { makeSdk, readConfig } from './_support/client';
import { SCOPES, createAgent, createPolicy, signTokenFor } from './_support/fixtures';

/**
 * Replay protection: a per-request token (jti) must not be approved twice.
 *
 * Even if the API's verify is "idempotent on the wire" (returning a cached
 * 200 for the same token), the audit log MUST not record two distinct
 * APPROVED decisions for the same jti. The strict reading of the contract
 * is that the second verify is denied (INVALID_SIGNATURE per the v1 spec
 * note) — but we accept either of:
 *
 *   - second response valid:false with INVALID_SIGNATURE / SCOPE_NOT_GRANTED
 *   - second response valid:true but identical eventId (same audit row)
 *
 * Failure mode we DO catch: two APPROVED audit rows with distinct eventIds
 * for the same jti — that's the bug worth catching.
 */
describe('08 · replay protection', () => {
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

  it('verifying the same token twice does not produce two distinct APPROVED audit events', async () => {
    const agent = await createAgent(sdk);
    cleanup.push(agent.agentId);
    const policy = await createPolicy(sdk, agent.agentId, [
      SCOPES.commerce({ maxPerTransaction: 500, maxPerDay: 1000, allowedDomains: ['delta.com'] }),
    ]);
    const token = await signTokenFor(agent, policy.policyId, {
      action: 'commerce.purchase',
      amount: 11,
      currency: 'USD',
      merchantDomain: 'delta.com',
    });
    const ctx = { action: 'commerce.purchase', amount: 11, currency: 'USD', merchantDomain: 'delta.com' };

    const first = await sdk.verify(token, ctx);
    const second = await sdk.verify(token, ctx);

    // First must be valid (otherwise this test is moot).
    expect(first.valid).toBe(true);

    if (second.valid) {
      // Idempotent shape: same auditEventId or same trust state. If the API
      // exposes auditEventId it MUST be identical; otherwise the second
      // call must be a denial.
      type WithAudit = { auditEventId?: string | null };
      const a = (first as unknown as WithAudit).auditEventId;
      const b = (second as unknown as WithAudit).auditEventId;
      if (a !== undefined || b !== undefined) {
        expect(b).toBe(a);
      } else {
        // No auditEventId in response — surface as a failure: the contract
        // says replay must not produce two distinct approvals.
        throw new Error(
          'Same jti verified twice and both returned valid:true with no auditEventId field — cannot prove single-approval invariant.',
        );
      }
    } else {
      expect(['INVALID_SIGNATURE', 'SCOPE_NOT_GRANTED', 'POLICY_REVOKED']).toContain(second.denialReason);
    }
  });
});
