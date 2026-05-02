import { BateScorer } from './bate.scorer';
import type { BateSignal, BateSignalType, SignalSeverity } from '@prisma/client';

const NOW = Date.now();
let id = 0;

function signal(
  type: BateSignalType,
  severity: SignalSeverity = 'MEDIUM',
  daysAgo = 0,
): BateSignal {
  return {
    id: `sig_${++id}`,
    agentId: 'agt_test',
    signalType: type,
    severity,
    source: 'internal',
    payload: {},
    idempotencyKey: null,
    processed: true,
    processedAt: new Date(),
    scoreDelta: null,
    occurredAt: new Date(NOW - daysAgo * 86_400_000),
  } as BateSignal;
}

describe('BateScorer', () => {
  const scorer = new BateScorer();

  it('clamps to [0, 1000]', () => {
    const score = scorer.compute({
      currentScore: 9999,
      createdAt: new Date(0),
      recentSignals: [],
    });
    expect(score).toBeLessThanOrEqual(1000);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('starts a fresh agent at neutral with no signals', () => {
    const score = scorer.compute({
      currentScore: 500,
      createdAt: new Date(NOW - 1_000),
      recentSignals: [],
    });
    expect(score).toBe(500);
  });

  it('penalises a CRITICAL fraud report by -500', () => {
    const score = scorer.compute({
      currentScore: 700,
      createdAt: new Date(NOW - 1_000),
      recentSignals: [signal('RELYING_PARTY_FRAUD_REPORT', 'CRITICAL')],
    });
    expect(score).toBeLessThanOrEqual(200);
  });

  it('rewards an aged agent with clean transactions', () => {
    const signals: BateSignal[] = Array.from({ length: 25 }, () => signal('CLEAN_TRANSACTION', 'LOW'));
    const score = scorer.compute({
      currentScore: 500,
      createdAt: new Date(NOW - 200 * 86_400_000), // 200-day-old agent
      recentSignals: signals,
    });
    expect(score).toBeGreaterThanOrEqual(620);
  });

  it('caps clean-transaction bonus at +20 per scoring run', () => {
    const signals = Array.from({ length: 50 }, () => signal('CLEAN_TRANSACTION', 'LOW'));
    const a = scorer.compute({ currentScore: 500, createdAt: new Date(), recentSignals: signals.slice(0, 20) });
    const b = scorer.compute({ currentScore: 500, createdAt: new Date(), recentSignals: signals });
    expect(b).toBeLessThanOrEqual(a + 1); // marginal age delta is ~0
  });

  it('maps scores to bands per spec', () => {
    expect(scorer.bandFromScore(900)).toBe('PLATINUM');
    expect(scorer.bandFromScore(750)).toBe('PLATINUM');
    expect(scorer.bandFromScore(749)).toBe('VERIFIED');
    expect(scorer.bandFromScore(500)).toBe('VERIFIED');
    expect(scorer.bandFromScore(499)).toBe('WATCH');
    expect(scorer.bandFromScore(250)).toBe('WATCH');
    expect(scorer.bandFromScore(249)).toBe('FLAGGED');
    expect(scorer.bandFromScore(0)).toBe('FLAGGED');
  });
});
