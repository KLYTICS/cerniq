import { CedarWasmEvaluator, compileCedarPolicy } from './cedar-wasm.evaluator';

interface CedarMod {
  isAuthorized: jest.Mock;
}

function fakeCedar(response: { decision: 'Allow' | 'Deny'; diagnostics?: { reason?: string; errors?: string[] } } | Error): CedarMod {
  return {
    isAuthorized: jest.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  };
}

describe('CedarWasmEvaluator', () => {
  it('passes principal/action/resource/context/policies/entities into cedar-wasm', async () => {
    const cedar = fakeCedar({ decision: 'Allow', diagnostics: {} });
    const evaluator = new CedarWasmEvaluator(cedar as never);
    await evaluator.isAuthorized({
      principal: 'Agent::"agt_1"',
      action: 'Action::"commerce.purchase"',
      resource: 'MerchantDomain::"delta.com"',
      context: { trustBand: 'VERIFIED' },
      artifact: { policies: 'permit(principal, action, resource);', entities: [{ uid: 'x' }] },
    });
    expect(cedar.isAuthorized).toHaveBeenCalledWith(expect.objectContaining({
      principal: 'Agent::"agt_1"',
      action: 'Action::"commerce.purchase"',
      resource: 'MerchantDomain::"delta.com"',
      policies: 'permit(principal, action, resource);',
      entities: JSON.stringify([{ uid: 'x' }]),
    }));
  });

  it('throws when artifact.policies is missing', async () => {
    const cedar = fakeCedar({ decision: 'Allow' });
    const evaluator = new CedarWasmEvaluator(cedar as never);
    await expect(
      evaluator.isAuthorized({
        principal: 'Agent::"a"', action: 'Action::"x"', resource: 'r', context: {},
        artifact: {},
      }),
    ).rejects.toThrow(/artifact\.policies/);
  });

  it('extracts aegis_deny_reason annotation as obligation', async () => {
    const cedar = fakeCedar({
      decision: 'Deny',
      diagnostics: { reason: 'matched policy_x with aegis_deny_reason("SPEND_LIMIT_EXCEEDED")' },
    });
    const evaluator = new CedarWasmEvaluator(cedar as never);
    const r = await evaluator.isAuthorized({
      principal: 'p', action: 'a', resource: 'r', context: {},
      artifact: { policies: 'permit(...);', entities: [] },
    });
    expect(r.decision).toBe('Deny');
    expect(r.obligations).toEqual([{ kind: 'aegis.deny_reason', data: { reason: 'SPEND_LIMIT_EXCEEDED' } }]);
  });

  it('returns no obligations when diagnostics have no aegis_deny_reason', async () => {
    const cedar = fakeCedar({ decision: 'Deny', diagnostics: { reason: 'no policy matched' } });
    const evaluator = new CedarWasmEvaluator(cedar as never);
    const r = await evaluator.isAuthorized({
      principal: 'p', action: 'a', resource: 'r', context: {},
      artifact: { policies: 'permit(...);' },
    });
    expect(r.obligations).toBeUndefined();
  });

  it('throws clearly when cedar-wasm is not installed (no module + no inject)', () => {
    // Detect whether @cedar-policy/cedar-wasm is actually present in this environment.
    let cedarAvailable = false;
    try { require('@cedar-policy/cedar-wasm'); cedarAvailable = true; } catch { /* not installed */ }

    if (cedarAvailable) {
      // Real module available — no-inject constructor must succeed.
      expect(() => new CedarWasmEvaluator(undefined as never)).not.toThrow();
    } else {
      // Module absent — constructor must throw with a helpful install hint.
      expect(() => new CedarWasmEvaluator(undefined as never)).toThrow(/pnpm install/i);
    }
  });
});

describe('compileCedarPolicy', () => {
  it('passes through valid policy text + default empty entities', () => {
    const out = compileCedarPolicy({ policiesText: 'permit(principal, action, resource);' });
    expect(out.policies).toBe('permit(principal, action, resource);');
    expect(out.entities).toEqual([]);
  });

  it('runs the validator and rejects bad policies', () => {
    expect(() =>
      compileCedarPolicy(
        { policiesText: 'permit(' },
        () => ({ ok: false, errors: ['unbalanced paren'] }),
      ),
    ).toThrow(/unbalanced paren/);
  });

  it('passes through when validator says ok', () => {
    const out = compileCedarPolicy(
      { policiesText: 'permit(principal, action, resource);' },
      () => ({ ok: true }),
    );
    expect(out.policies).toMatch(/permit/);
  });
});
