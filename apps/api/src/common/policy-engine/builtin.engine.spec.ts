import { BuiltinPolicyEngine } from './builtin.engine';
import type { PolicyEvaluationInput } from './engine.interface';

const engine = new BuiltinPolicyEngine();

const baseInput = (overrides: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput => ({
  agent: {
    id: 'agt_1',
    status: 'ACTIVE',
    trustScore: 700,
    trustBand: 'VERIFIED' as never,
    principalId: 'p_1',
  },
  policy: {
    id: 'pol_1',
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: [{ category: 'commerce', actions: ['commerce.purchase'], spendLimit: { amount: '500.00', currency: 'USD', window: 'per_day' } }],
  },
  action: 'commerce.purchase',
  amount: '100.00',
  currency: 'USD',
  now: new Date(),
  spend: { windowSpend: '0.00', limit: '500.00', currency: 'USD' },
  ...overrides,
});

describe('BuiltinPolicyEngine', () => {
  it('approves a clean request', async () => {
    const r = await engine.evaluate(baseInput());
    expect(r.decision).toBe('APPROVE');
  });

  it('denies revoked agent', async () => {
    const r = await engine.evaluate(baseInput({ agent: { ...baseInput().agent, status: 'REVOKED' } }));
    expect(r.decision).toBe('DENY');
    if (r.decision === 'DENY') expect(r.denialReason).toBe('AGENT_REVOKED');
  });

  it('denies revoked policy', async () => {
    const r = await engine.evaluate(baseInput({ policy: { ...baseInput().policy, status: 'REVOKED' } }));
    expect(r.decision).toBe('DENY');
    if (r.decision === 'DENY') expect(r.denialReason).toBe('POLICY_REVOKED');
  });

  it('denies expired policy by timestamp', async () => {
    const r = await engine.evaluate(baseInput({ policy: { ...baseInput().policy, expiresAt: new Date(Date.now() - 1000).toISOString() } }));
    expect(r.decision).toBe('DENY');
    if (r.decision === 'DENY') expect(r.denialReason).toBe('POLICY_EXPIRED');
  });

  it('denies action not in scope', async () => {
    const r = await engine.evaluate(baseInput({ action: 'data.export' }));
    expect(r.decision).toBe('DENY');
    if (r.decision === 'DENY') expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
  });

  it('denies merchant domain not in allow-list', async () => {
    const r = await engine.evaluate(baseInput({
      policy: { ...baseInput().policy, scopes: [{ category: 'commerce', actions: ['commerce.purchase'], merchantDomains: ['delta.com'] }] },
      merchantDomain: 'evil.example',
    }));
    expect(r.decision).toBe('DENY');
    if (r.decision === 'DENY') expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
  });

  it('denies spend over limit', async () => {
    const r = await engine.evaluate(baseInput({ amount: '600.00', spend: { windowSpend: '0.00', limit: '500.00', currency: 'USD' } }));
    expect(r.decision).toBe('DENY');
    if (r.decision === 'DENY') expect(r.denialReason).toBe('SPEND_LIMIT_EXCEEDED');
  });

  it('denies low trust band', async () => {
    const r = await engine.evaluate(baseInput({ agent: { ...baseInput().agent, trustBand: 'WATCH' as never, trustScore: 200 } }));
    expect(r.decision).toBe('DENY');
    if (r.decision === 'DENY') expect(r.denialReason).toBe('TRUST_SCORE_TOO_LOW');
  });

  it('denies currency mismatch with descriptive subReason', async () => {
    const r = await engine.evaluate(baseInput({ amount: '100.00', currency: 'EUR', spend: { windowSpend: '0.00', limit: '500.00', currency: 'USD' } }));
    expect(r.decision).toBe('DENY');
    if (r.decision === 'DENY') {
      expect(r.denialReason).toBe('SCOPE_NOT_GRANTED');
      expect(r.subReason).toBe('currency_mismatch');
    }
  });
});
