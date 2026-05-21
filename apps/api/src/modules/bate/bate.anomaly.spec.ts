import type { BateSignal } from '@prisma/client';

import { BateAnomalyDetector, ANOMALY_THRESHOLDS, type DetectorWindow } from './bate.anomaly';

const detector = new BateAnomalyDetector();
const now = new Date('2026-05-02T12:00:00Z');

function emptyWindow(over: Partial<DetectorWindow> = {}): DetectorWindow {
  return {
    now,
    signals: [],
    recentDenials: [],
    recentSpends: [],
    recentLocations: [],
    delegationChainDepth: 0,
    ...over,
  };
}

function clean(at: Date): BateSignal {
  return {
    id: 's',
    signalType: 'CLEAN_TRANSACTION',
    severity: 'LOW',
    source: 'verify',
    agentId: 'a',
    occurredAt: at,
    payload: {},
  } as never;
}

describe('R-1 velocity anomaly', () => {
  it('emits HIGH at warn threshold', () => {
    const signals = Array.from({ length: ANOMALY_THRESHOLDS.velocityPerMinuteWarn }, () => clean(new Date(now.getTime() - 30_000)));
    const out = detector.r1VelocityAnomaly(emptyWindow({ signals }));
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('HIGH');
    expect(out[0]?.signalType).toBe('VELOCITY_ANOMALY');
  });

  it('emits CRITICAL at crit threshold', () => {
    const signals = Array.from({ length: ANOMALY_THRESHOLDS.velocityPerMinuteCrit + 5 }, () => clean(new Date(now.getTime() - 30_000)));
    const out = detector.r1VelocityAnomaly(emptyWindow({ signals }));
    expect(out[0]?.severity).toBe('CRITICAL');
  });

  it('emits nothing below warn', () => {
    const signals = Array.from({ length: 5 }, () => clean(new Date(now.getTime() - 30_000)));
    expect(detector.r1VelocityAnomaly(emptyWindow({ signals }))).toEqual([]);
  });

  it('ignores signals older than 1 minute', () => {
    const signals = Array.from({ length: 200 }, () => clean(new Date(now.getTime() - 90_000)));
    expect(detector.r1VelocityAnomaly(emptyWindow({ signals }))).toEqual([]);
  });
});

describe('R-2 geographic inconsistency', () => {
  it('emits HIGH at distinct-country warn threshold', () => {
    const recentLocations = Array.from({ length: ANOMALY_THRESHOLDS.distinctCountries24hWarn }, (_, i) => ({
      countryCode: ['US', 'GB', 'JP', 'BR', 'AU', 'IN', 'DE', 'FR'][i] ?? 'XX',
      timestamp: new Date(now.getTime() - 1000),
    }));
    const out = detector.r2GeographicInconsistency(emptyWindow({ recentLocations }));
    expect(out[0]?.signalType).toBe('GEOGRAPHIC_INCONSISTENCY');
    expect(out[0]?.severity).toBe('HIGH');
  });

  it('ignores locations older than 24h', () => {
    const recentLocations = Array.from({ length: 10 }, (_, i) => ({
      countryCode: ['US', 'GB', 'JP', 'BR', 'AU', 'IN', 'DE', 'FR', 'CA', 'MX'][i] ?? 'XX',
      timestamp: new Date(now.getTime() - 90_000_000), // > 24h
    }));
    expect(detector.r2GeographicInconsistency(emptyWindow({ recentLocations }))).toEqual([]);
  });
});

describe('R-3 spend pattern deviation', () => {
  it('flags HIGH on high coefficient of variation', () => {
    // Wildly variable USD spend: 5, 10, 5, 2000, 8 → high stddev, low mean → cv ≈ 1.97 > threshold (1.5).
    const recentSpends = [5, 10, 5, 2000, 8].map((amount) => ({ amount, currency: 'USD', timestamp: new Date(now.getTime() - 1000) }));
    const out = detector.r3SpendPatternDeviation(emptyWindow({ recentSpends }));
    expect(out[0]?.signalType).toBe('SPEND_PATTERN_DEVIATION');
  });

  it('emits nothing on stable spend', () => {
    const recentSpends = [100, 105, 95, 100, 102, 98].map((amount) => ({ amount, currency: 'USD', timestamp: new Date(now.getTime() - 1000) }));
    expect(detector.r3SpendPatternDeviation(emptyWindow({ recentSpends }))).toEqual([]);
  });

  it('skips on small sample size', () => {
    const recentSpends = [5, 5000].map((amount) => ({ amount, currency: 'USD', timestamp: new Date(now.getTime() - 1000) }));
    expect(detector.r3SpendPatternDeviation(emptyWindow({ recentSpends }))).toEqual([]);
  });

  it('evaluates per-currency separately', () => {
    const recentSpends = [
      ...[100, 102, 98, 101, 99].map((amount) => ({ amount, currency: 'USD', timestamp: new Date(now.getTime() - 1000) })),
      ...[5, 8, 5, 9000, 7].map((amount) => ({ amount, currency: 'EUR', timestamp: new Date(now.getTime() - 1000) })),
    ];
    const out = detector.r3SpendPatternDeviation(emptyWindow({ recentSpends }));
    expect(out.find((s) => s.reason.includes('EUR'))).toBeDefined();
    expect(out.find((s) => s.reason.includes('USD'))).toBeUndefined();
  });
});

describe('R-4 failed verify spike', () => {
  it('emits CRITICAL when over half of last-hour verifies are denied', () => {
    const signals = Array.from({ length: 20 }, () => clean(new Date(now.getTime() - 60_000)));
    const recentDenials = Array.from({ length: 12 }, () => ({ denialReason: 'AGENT_REVOKED', timestamp: new Date(now.getTime() - 60_000) }));
    const out = detector.r4FailedVerifySpike(emptyWindow({ signals, recentDenials }));
    expect(out[0]?.severity).toBe('CRITICAL');
  });

  it('skips on small samples', () => {
    const signals = Array.from({ length: 3 }, () => clean(new Date(now.getTime() - 60_000)));
    const recentDenials = Array.from({ length: 3 }, () => ({ denialReason: 'AGENT_REVOKED', timestamp: new Date(now.getTime() - 60_000) }));
    expect(detector.r4FailedVerifySpike(emptyWindow({ signals, recentDenials }))).toEqual([]);
  });

  it('emits nothing on healthy denial rate', () => {
    const signals = Array.from({ length: 50 }, () => clean(new Date(now.getTime() - 60_000)));
    const recentDenials = Array.from({ length: 3 }, () => ({ denialReason: 'AGENT_REVOKED', timestamp: new Date(now.getTime() - 60_000) }));
    expect(detector.r4FailedVerifySpike(emptyWindow({ signals, recentDenials }))).toEqual([]);
  });
});

describe('R-5 delegation chain anomaly', () => {
  it('emits HIGH at warn threshold', () => {
    const out = detector.r5DelegationChainAnomaly(emptyWindow({ delegationChainDepth: ANOMALY_THRESHOLDS.delegationDepthWarn }));
    expect(out[0]?.severity).toBe('HIGH');
  });

  it('emits CRITICAL at crit threshold', () => {
    const out = detector.r5DelegationChainAnomaly(emptyWindow({ delegationChainDepth: ANOMALY_THRESHOLDS.delegationDepthCrit + 1 }));
    expect(out[0]?.severity).toBe('CRITICAL');
  });

  it('emits nothing below warn', () => {
    expect(detector.r5DelegationChainAnomaly(emptyWindow({ delegationChainDepth: 1 }))).toEqual([]);
  });
});

describe('detect()', () => {
  it('runs all five rules and returns union', () => {
    const out = detector.detect(emptyWindow({ delegationChainDepth: ANOMALY_THRESHOLDS.delegationDepthCrit + 1 }));
    expect(out.length).toBeGreaterThan(0);
    expect(out.find((s) => s.signalType === 'DELEGATION_CHAIN_ANOMALY')).toBeDefined();
  });

  it('emits nothing on a calm window', () => {
    expect(detector.detect(emptyWindow())).toEqual([]);
  });
});
