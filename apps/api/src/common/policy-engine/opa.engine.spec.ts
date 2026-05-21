import type { PolicyEvaluationInput } from './engine.interface';
import { OpaPolicyEngine, type OpaEvaluatorLike } from './opa.engine';

class FakeOpa implements OpaEvaluatorLike {
  constructor(private readonly resp: Awaited<ReturnType<OpaEvaluatorLike['evaluate']>> | Error) {}
  async evaluate() {
    if (this.resp instanceof Error) throw this.resp;
    return this.resp;
  }
}

function input(over: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  return {
    agent: { id: 'agt_1', status: 'ACTIVE', trustScore: 700, trustBand: 'VERIFIED', principalId: 'p_1' },
    policy: {
      id: 'pol_1', status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      scopes: [],
      compiledArtifact: { wasm: true },
    } as never,
    action: 'commerce.purchase',
    amount: '100.00',
    currency: 'USD',
    now: new Date(),
    spend: { windowSpend: '0.00', limit: '500.00', currency: 'USD' },
    ...over,
  };
}

describe('OpaPolicyEngine', () => {
  it('approves on allow=true within spend limit', async () => {
    const engine = new OpaPolicyEngine(new FakeOpa({ allow: true }));
    expect((await engine.evaluate(input())).decision).toBe('APPROVE');
  });

  it('denies on allow=false, mapping the first deny_reason', async () => {
    const engine = new OpaPolicyEngine(new FakeOpa({ allow: false, deny_reasons: ['POLICY_EXPIRED'] }));
    const r = await engine.evaluate(input());
    if (r.decision === 'DENY') expect(r.denialReason).toBe('POLICY_EXPIRED');
  });

  it('falls back to SCOPE_NOT_GRANTED when allow=false with no deny_reasons', async () => {
    const engine = new OpaPolicyEngine(new FakeOpa({ allow: false }));
    const r = await engine.evaluate(input());
    if (r.decision === 'DENY') expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
  });

  it('rejects unknown deny_reason values (locked enum)', async () => {
    const engine = new OpaPolicyEngine(new FakeOpa({ allow: false, deny_reasons: ['HOMEGROWN_REASON'] }));
    const r = await engine.evaluate(input());
    if (r.decision === 'DENY') expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
  });

  it('preserves multiple reason names in subReason for forensics', async () => {
    const engine = new OpaPolicyEngine(new FakeOpa({ allow: false, deny_reasons: ['SCOPE_NOT_GRANTED', 'TRUST_SCORE_TOO_LOW'] }));
    const r = await engine.evaluate(input());
    if (r.decision === 'DENY') {
      expect(r.subReason).toBe('SCOPE_NOT_GRANTED,TRUST_SCORE_TOO_LOW');
      expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
    }
  });

  it('maps eval errors to POLICY_REVOKED', async () => {
    const engine = new OpaPolicyEngine(new FakeOpa(new Error('opa: rule undefined')));
    const r = await engine.evaluate(input());
    if (r.decision === 'DENY') {
      expect(r.denialReason).toBe('POLICY_REVOKED');
      expect(r.subReason).toMatch(/opa_eval_error/);
    }
  });

  it('fails closed when no compiled artifact', async () => {
    const engine = new OpaPolicyEngine(new FakeOpa({ allow: true }));
    const i = input();
    (i.policy as PolicyEvaluationInput['policy'] & { compiledArtifact?: unknown }).compiledArtifact = undefined;
    const r = await engine.evaluate(i);
    if (r.decision === 'DENY') expect(r.subReason).toBe('opa_artifact_missing');
  });

  it('applies spend gate after allow', async () => {
    const engine = new OpaPolicyEngine(new FakeOpa({ allow: true }));
    const r = await engine.evaluate(input({
      amount: '600.00',
      spend: { windowSpend: '0.00', limit: '500.00', currency: 'USD' },
    }));
    if (r.decision === 'DENY') expect(r.denialReason).toBe('SPEND_LIMIT_EXCEEDED');
  });
});
