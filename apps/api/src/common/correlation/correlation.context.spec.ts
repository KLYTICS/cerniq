import { CorrelationContext } from './correlation.context';

describe('CorrelationContext', () => {
  it('returns undefined outside of run()', () => {
    expect(CorrelationContext.current()).toBeUndefined();
    expect(CorrelationContext.txId()).toBeUndefined();
  });

  it('exposes the bound state inside run()', () => {
    const state = { txId: 'tx_outer', principalId: 'p1' };
    CorrelationContext.run(state, () => {
      expect(CorrelationContext.current()?.txId).toBe('tx_outer');
      expect(CorrelationContext.current()?.principalId).toBe('p1');
      expect(CorrelationContext.txId()).toBe('tx_outer');
    });
  });

  it('shallow-clones the input so caller mutations do not leak', () => {
    const state = { txId: 'tx_a' };
    CorrelationContext.run(state, () => {
      CorrelationContext.withFields({ principalId: 'p_inner' });
      expect(CorrelationContext.current()?.principalId).toBe('p_inner');
    });
    // Caller's reference must not have been mutated.
    expect((state as { principalId?: string }).principalId).toBeUndefined();
  });

  it('isolates nested run() invocations', () => {
    CorrelationContext.run({ txId: 'tx_outer', principalId: 'p_outer' }, () => {
      CorrelationContext.run({ txId: 'tx_inner' }, () => {
        expect(CorrelationContext.current()?.txId).toBe('tx_inner');
        expect(CorrelationContext.current()?.principalId).toBeUndefined();
      });
      expect(CorrelationContext.current()?.txId).toBe('tx_outer');
      expect(CorrelationContext.current()?.principalId).toBe('p_outer');
    });
  });

  it('withFields merges keys atomically', () => {
    CorrelationContext.run({ txId: 'tx_x' }, () => {
      CorrelationContext.withFields({ principalId: 'p1', apiKeyId: 'k1' });
      const snap = CorrelationContext.current();
      expect(snap?.txId).toBe('tx_x');
      expect(snap?.principalId).toBe('p1');
      expect(snap?.apiKeyId).toBe('k1');
    });
  });

  it('withFields outside a run is a no-op (does not throw)', () => {
    expect(() => CorrelationContext.withFields({ principalId: 'p_lost' })).not.toThrow();
    expect(CorrelationContext.current()).toBeUndefined();
  });

  it('does not bleed across concurrent runs', async () => {
    // Two interleaved promise chains each set a distinct txId; assert that
    // the inner reads always observe their own.
    const observed: Array<{ branch: string; txId: string | undefined }> = [];

    async function branch(label: string, txId: string, delayMs: number): Promise<void> {
      await CorrelationContext.run({ txId }, async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        observed.push({ branch: label, txId: CorrelationContext.txId() });
      });
    }

    await Promise.all([branch('A', 'tx_A', 5), branch('B', 'tx_B', 1), branch('C', 'tx_C', 3)]);

    const byBranch = Object.fromEntries(observed.map((o) => [o.branch, o.txId]));
    expect(byBranch.A).toBe('tx_A');
    expect(byBranch.B).toBe('tx_B');
    expect(byBranch.C).toBe('tx_C');
  });
});
