import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import type { Cerniq, DenialReason } from '@cerniq/sdk';
import { DENIAL_REASON_PRECEDENCE } from '@cerniq/types';
import { makeSdk, readConfig } from '../_support/client';
import {
  SCOPES,
  createAgent,
  createPolicy,
  futureIso,
  signTokenFor,
  tamperToken,
} from '../_support/fixtures';

/**
 * Property: when multiple denial conditions hold simultaneously, the API
 * MUST report the highest-precedence reason (top wins), per CLAUDE.md
 * § Architecture invariants #6.
 *
 * Strategy: independently toggle a set of conditions, generate a token,
 * verify, and assert the response cites the *first* (most-significant)
 * reason among those toggled.
 */

interface Conditions {
  // ordered top-to-bottom in precedence:
  agentNotFound: boolean;
  agentRevoked: boolean;
  invalidSignature: boolean;
  policyRevoked: boolean;
  policyExpired: boolean;
  scopeMismatch: boolean;
  spendOver: boolean;
}

function expectedReasonFor(c: Conditions): DenialReason | null {
  if (c.agentNotFound) return 'AGENT_NOT_FOUND';
  if (c.agentRevoked) return 'AGENT_REVOKED';
  if (c.invalidSignature) return 'INVALID_SIGNATURE';
  if (c.policyRevoked) return 'POLICY_REVOKED';
  if (c.policyExpired) return 'POLICY_EXPIRED';
  if (c.scopeMismatch) return 'SCOPE_NOT_GRANTED';
  if (c.spendOver) return 'SPEND_LIMIT_EXCEEDED';
  return null;
}

describe('property · denial precedence', () => {
  let sdk: Cerniq;
  const created: string[] = [];

  beforeAll(() => {
    sdk = makeSdk(readConfig());
  });

  afterAll(async () => {
    for (const id of created) {
      try {
        await sdk.agents.revoke(id);
      } catch {
        /* ignore */
      }
    }
  });

  it('precedence array is fixed and well-known (regression guard)', () => {
    expect([...DENIAL_REASON_PRECEDENCE]).toEqual([
      'AGENT_NOT_FOUND',
      'AGENT_REVOKED',
      'INVALID_SIGNATURE',
      'POLICY_REVOKED',
      'POLICY_EXPIRED',
      'SCOPE_NOT_GRANTED',
      'SPEND_LIMIT_EXCEEDED',
      'TRUST_SCORE_TOO_LOW',
      'ANOMALY_FLAGGED',
    ]);
  });

  it('when 2+ conditions hold simultaneously, response cites the highest-precedence reason', async () => {
    // Fast-check arbitrary: each condition is an independent boolean.
    // Limit numRuns to keep network cost bounded; runs > 12 would re-cover.
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          agentRevoked: fc.boolean(),
          invalidSignature: fc.boolean(),
          policyRevoked: fc.boolean(),
          scopeMismatch: fc.boolean(),
          spendOver: fc.boolean(),
        }),
        async (raw) => {
          const c: Conditions = {
            agentNotFound: false, // not exercised here — would require a different fixture path
            policyExpired: false, // skip wall-clock waits in property test
            ...raw,
          };
          // At least two must hold to make the test meaningful.
          const setBits =
            +c.agentRevoked +
            +c.invalidSignature +
            +c.policyRevoked +
            +c.scopeMismatch +
            +c.spendOver;
          if (setBits < 2) return;

          const agent = await createAgent(sdk);
          created.push(agent.agentId);

          const policy = await createPolicy(
            sdk,
            agent.agentId,
            [
              c.scopeMismatch
                ? SCOPES.dataRead(['read:calendar']) // a token claiming commerce will mismatch
                : SCOPES.commerce({
                    maxPerTransaction: 50,
                    maxPerDay: 100,
                    allowedDomains: ['delta.com'],
                  }),
            ],
            { expiresAt: futureIso(60 * 60) },
          );

          // Optionally revoke policy.
          if (c.policyRevoked) {
            await sdk.policies.revoke(agent.agentId, policy.policyId);
          }

          // Build a token claiming commerce.purchase $200 (over a $50 cap).
          const amount = c.spendOver ? 200 : 25;
          let token = await signTokenFor(agent, policy.policyId, {
            action: 'commerce.purchase',
            amount,
            currency: 'USD',
            merchantDomain: 'delta.com',
          });
          if (c.invalidSignature) token = tamperToken(token);

          // Optionally revoke agent.
          if (c.agentRevoked) {
            await sdk.agents.revoke(agent.agentId);
          }

          const result = await sdk.verify(token, {
            action: 'commerce.purchase',
            amount,
            currency: 'USD',
            merchantDomain: 'delta.com',
          });

          const expected = expectedReasonFor(c);
          if (expected === null) {
            // No condition triggered — should be valid.
            expect(result.valid).toBe(true);
            return;
          }
          expect(result.valid).toBe(false);
          expect(result.denialReason).toBe(expected);
        },
      ),
      { numRuns: 12, verbose: false },
    );
  }, 120_000);
});
