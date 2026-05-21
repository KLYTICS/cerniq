import { OpaWasmEvaluator, buildOpaArtifact } from './opa-wasm.evaluator';

interface FakePolicy {
  evaluate: jest.Mock;
  setData: jest.Mock;
}
interface FakeOpaModule {
  loadPolicy: jest.Mock;
}

function fakeOpa(result: { allow: boolean; deny_reasons?: string[]; metadata?: Record<string, unknown> }): { mod: FakeOpaModule; policy: FakePolicy } {
  const policy: FakePolicy = {
    evaluate: jest.fn(() => [{ result }]),
    setData: jest.fn(),
  };
  const mod: FakeOpaModule = {
    loadPolicy: jest.fn(async () => policy),
  };
  return { mod, policy };
}

describe('OpaWasmEvaluator', () => {
  it('loads and evaluates a policy artifact', async () => {
    const { mod, policy } = fakeOpa({ allow: true });
    const evaluator = new OpaWasmEvaluator(mod);
    const wasmBytes = Buffer.from(new Uint8Array([1, 2, 3])).toString('base64');
    const r = await evaluator.evaluate({
      artifact: { wasmBytes, cacheKey: 'k1' },
      document: { agent: { id: 'a' }, action: 'commerce.purchase' },
    });
    expect(r.allow).toBe(true);
    expect(mod.loadPolicy).toHaveBeenCalledTimes(1);
    expect(policy.evaluate).toHaveBeenCalledWith({ agent: { id: 'a' }, action: 'commerce.purchase' });
  });

  it('caches loaded policies by cacheKey', async () => {
    const { mod } = fakeOpa({ allow: true });
    const evaluator = new OpaWasmEvaluator(mod);
    const wasmBytes = Buffer.from(new Uint8Array([7])).toString('base64');
    await evaluator.evaluate({ artifact: { wasmBytes, cacheKey: 'same' }, document: {} });
    await evaluator.evaluate({ artifact: { wasmBytes, cacheKey: 'same' }, document: {} });
    expect(mod.loadPolicy).toHaveBeenCalledTimes(1); // cached on second call
  });

  it('reloads policy when cacheKey changes', async () => {
    const { mod } = fakeOpa({ allow: true });
    const evaluator = new OpaWasmEvaluator(mod);
    const w1 = Buffer.from(new Uint8Array([1])).toString('base64');
    const w2 = Buffer.from(new Uint8Array([2])).toString('base64');
    await evaluator.evaluate({ artifact: { wasmBytes: w1, cacheKey: 'k1' }, document: {} });
    await evaluator.evaluate({ artifact: { wasmBytes: w2, cacheKey: 'k2' }, document: {} });
    expect(mod.loadPolicy).toHaveBeenCalledTimes(2);
  });

  it('returns implicit deny on empty result array', async () => {
    const policy: FakePolicy = { evaluate: jest.fn(() => []), setData: jest.fn() };
    const mod: FakeOpaModule = { loadPolicy: jest.fn(async () => policy) };
    const evaluator = new OpaWasmEvaluator(mod);
    const r = await evaluator.evaluate({
      artifact: { wasmBytes: Buffer.from([0]).toString('base64'), cacheKey: 'x' },
      document: {},
    });
    expect(r.allow).toBe(false);
    expect(r.deny_reasons).toEqual([]);
  });

  it('surfaces deny_reasons + metadata from the policy result', async () => {
    const { mod } = fakeOpa({
      allow: false,
      deny_reasons: ['POLICY_EXPIRED', 'TRUST_SCORE_TOO_LOW'],
      metadata: { matched_rule: 'r17' },
    });
    const evaluator = new OpaWasmEvaluator(mod);
    const r = await evaluator.evaluate({
      artifact: { wasmBytes: Buffer.from([0]).toString('base64'), cacheKey: 'x' },
      document: {},
    });
    expect(r.allow).toBe(false);
    expect(r.deny_reasons).toEqual(['POLICY_EXPIRED', 'TRUST_SCORE_TOO_LOW']);
    expect(r.metadata).toEqual({ matched_rule: 'r17' });
  });

  it('throws when artifact.wasmBytes is missing', async () => {
    const { mod } = fakeOpa({ allow: true });
    const evaluator = new OpaWasmEvaluator(mod);
    await expect(
      evaluator.evaluate({ artifact: {}, document: {} }),
    ).rejects.toThrow(/wasmBytes/);
  });

  it('filters non-string entries from deny_reasons', async () => {
    // OPA WASM result documents are loosely typed; defense in depth.
    const { mod } = fakeOpa({ allow: false, deny_reasons: ['POLICY_EXPIRED', null as unknown as string, 42 as unknown as string] });
    const evaluator = new OpaWasmEvaluator(mod);
    const r = await evaluator.evaluate({
      artifact: { wasmBytes: Buffer.from([0]).toString('base64'), cacheKey: 'x' },
      document: {},
    });
    expect(r.deny_reasons).toEqual(['POLICY_EXPIRED']);
  });
});

describe('buildOpaArtifact', () => {
  it('encodes wasm bytes as base64', () => {
    const out = buildOpaArtifact({ wasmBytes: new Uint8Array([1, 2, 3]), cacheKey: 'k' });
    expect(out.wasmBytes).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(out.cacheKey).toBe('k');
  });
});
