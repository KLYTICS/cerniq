import { CedarPolicyEngine, type CedarEvaluatorLike } from './cedar.engine';
import type { PolicyEvaluationInput } from './engine.interface';

function baseInput(over: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  return {
    agent: {
      id: 'agt_1',
      status: 'ACTIVE',
      trustScore: 700,
      trustBand: 'VERIFIED',
      principalId: 'p_1',
    },
    policy: {
      id: 'pol_1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      scopes: [],
      // Cedar engines stash the compiled artifact on the policy snapshot.
      compiledArtifact: { dummyArtifact: true },
    } as never,
    action: 'commerce.purchase',
    amount: '100.00',
    currency: 'USD',
    now: new Date(),
    spend: { windowSpend: '0.00', limit: '500.00', currency: 'USD' },
    ...over,
  };
}

class FakeEvaluator implements CedarEvaluatorLike {
  constructor(
    private readonly response: Awaited<ReturnType<CedarEvaluatorLike['isAuthorized']>> | Error,
  ) {}
  async isAuthorized() {
    if (this.response instanceof Error) throw this.response;
    return this.response;
  }
}

describe('CedarPolicyEngine', () => {
  it('approves when Cedar Allows + spend within limit', async () => {
    const engine = new CedarPolicyEngine(new FakeEvaluator({ decision: 'Allow' }));
    const r = await engine.evaluate(baseInput());
    expect(r.decision).toBe('APPROVE');
  });

  it('denies when Cedar Denies, mapping cerniq.deny_reason obligation', async () => {
    const engine = new CedarPolicyEngine(
      new FakeEvaluator({
        decision: 'Deny',
        diagnostics: { reason: 'merchant_not_in_allowlist' },
        obligations: [{ kind: 'cerniq.deny_reason', data: { reason: 'SCOPE_NOT_GRANTED' } }],
      }),
    );
    const r = await engine.evaluate(baseInput());
    expect(r.decision).toBe('DENY');
    if (r.decision === 'DENY') {
      expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
      expect(r.subReason).toBe('merchant_not_in_allowlist');
    }
  });

  it('falls back to SCOPE_NOT_GRANTED when Cedar Denies without cerniq.deny_reason', async () => {
    const engine = new CedarPolicyEngine(new FakeEvaluator({ decision: 'Deny' }));
    const r = await engine.evaluate(baseInput());
    if (r.decision === 'DENY') expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
  });

  it('rejects unknown denial-reason claims (keeps the public enum stable)', async () => {
    const engine = new CedarPolicyEngine(
      new FakeEvaluator({
        decision: 'Deny',
        obligations: [{ kind: 'cerniq.deny_reason', data: { reason: 'COMPLETELY_MADE_UP' } }],
      }),
    );
    const r = await engine.evaluate(baseInput());
    if (r.decision === 'DENY') expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
  });

  it('maps Cedar evaluation errors to POLICY_REVOKED with diagnostic', async () => {
    const engine = new CedarPolicyEngine(
      new FakeEvaluator(new Error('cedar parse: unbalanced paren')),
    );
    const r = await engine.evaluate(baseInput());
    if (r.decision === 'DENY') {
      expect(r.denialReason).toBe('POLICY_REVOKED');
      expect(r.subReason).toMatch(/cedar_eval_error/);
    }
  });

  it('fails closed when no compiled artifact present', async () => {
    const engine = new CedarPolicyEngine(new FakeEvaluator({ decision: 'Allow' }));
    const policy = baseInput().policy as PolicyEvaluationInput['policy'] & {
      compiledArtifact?: unknown;
    };
    policy.compiledArtifact = undefined;
    const r = await engine.evaluate({ ...baseInput(), policy });
    if (r.decision === 'DENY') {
      expect(r.denialReason).toBe('POLICY_REVOKED');
      expect(r.subReason).toBe('cedar_artifact_missing');
    }
  });

  it('still applies the spend gate after a Cedar Allow', async () => {
    const engine = new CedarPolicyEngine(new FakeEvaluator({ decision: 'Allow' }));
    const r = await engine.evaluate(
      baseInput({
        amount: '600.00',
        spend: { windowSpend: '0.00', limit: '500.00', currency: 'USD' },
      }),
    );
    if (r.decision === 'DENY') expect(r.denialReason).toBe('SPEND_LIMIT_EXCEEDED');
  });
});
