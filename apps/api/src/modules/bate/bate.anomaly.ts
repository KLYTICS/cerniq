// BATE anomaly detector — rule-based v1 (M-007 extension).
//
// Five rules R-1..R-5 from `docs/BATE_ALGORITHM.md` § 6 — each is a pure
// function over a stream of recent BATE signals + spend records. The
// detector emits NEW signals (`VELOCITY_ANOMALY`, `GEOGRAPHIC_INCONSISTENCY`,
// etc.) which the BATE scorer then weights via `bate.weights.ts`.
//
// Design:
//   - Pure functions. Deterministic. Side-effect-free. Replayable.
//   - Each rule takes a window of signals + a clock; returns 0..N
//     emitted signals.
//   - Operators tune thresholds in `bate.weights.ts` so the rule set
//     stays declarative.
//   - The detector runs in a worker (NOT the verify hot path) so a
//     slow rule never affects p99 verify latency.
//
// Locked: rule names + their emitted `BateSignalType`. Changes require
// an ADR + WORK_BOARD entry because BATE history replay depends on
// stable signal semantics.

import type { BateSignal, BateSignalType, SignalSeverity } from '@prisma/client';

export interface DetectorWindow {
  /** Now (server clock). */
  now: Date;
  /** Recent signals (oldest first), typically the last 24 h. */
  signals: BateSignal[];
  /** Recent verify decisions (DENIED / FLAGGED) for the agent. */
  recentDenials: { denialReason: string; timestamp: Date }[];
  /** Recent spend records for the agent (oldest first). */
  recentSpends: { amount: number; currency: string; timestamp: Date }[];
  /** Geographic signals (typically derived from request IPs). */
  recentLocations: { countryCode: string; timestamp: Date }[];
  /** Active delegation chain length (0 = no delegations). */
  delegationChainDepth: number;
}

export interface EmittedSignal {
  signalType: BateSignalType;
  severity: SignalSeverity;
  reason: string;
  source: string; // who/what produced the signal — used by relying-party trust weights
}

/** Tunables exported from `bate.weights.ts` siblings — kept here close to the rules. */
export const ANOMALY_THRESHOLDS = Object.freeze({
  /** R-1: more than this many verifies/min trips VELOCITY_ANOMALY. */
  velocityPerMinuteWarn: 30,
  velocityPerMinuteCrit: 100,
  /** R-2: more than this many distinct countries in 24h trips GEOGRAPHIC_INCONSISTENCY. */
  distinctCountries24hWarn: 3,
  distinctCountries24hCrit: 6,
  /**
   * R-3: spend stddev > this fraction of mean trips SPEND_PATTERN_DEVIATION.
   * NOTE: the mathematical maximum CV for n=5 samples approaches sqrt(n-1)=2.0
   * asymptotically (never reached with finite values). Setting 2.0 would make
   * this threshold unreachable at the minimum sample size; 1.5 is already
   * extreme (stddev = 150% of mean) and reliably detectable.
   */
  spendCoefficientOfVariation: 1.5,
  spendMinSampleSize: 5,
  /** R-4: more than this fraction DENIED in last hour trips FAILED_VERIFY_SPIKE. */
  failedVerifyRateWarn: 0.25,
  failedVerifyRateCrit: 0.5,
  /** R-4: minimum verifies in window before the rate is meaningful. */
  failedVerifyMinSamples: 10,
  /** R-5: delegation depth > this trips DELEGATION_CHAIN_ANOMALY. */
  delegationDepthWarn: 3,
  delegationDepthCrit: 6,
});

export class BateAnomalyDetector {
  /**
   * Run all five rules over a window. Returns the union of their
   * emitted signals (possibly empty). Pure; safe to call from a
   * BullMQ worker, a cron, or a test.
   */
  detect(w: DetectorWindow): EmittedSignal[] {
    return [
      ...this.r1VelocityAnomaly(w),
      ...this.r2GeographicInconsistency(w),
      ...this.r3SpendPatternDeviation(w),
      ...this.r4FailedVerifySpike(w),
      ...this.r5DelegationChainAnomaly(w),
    ];
  }

  /** R-1 — verifies per minute exceeds the warn / crit thresholds. */
  r1VelocityAnomaly(w: DetectorWindow): EmittedSignal[] {
    const oneMinAgo = w.now.getTime() - 60_000;
    const recent = w.signals.filter(
      (s) => s.signalType === 'CLEAN_TRANSACTION' && s.occurredAt.getTime() >= oneMinAgo,
    );
    const count = recent.length;
    if (count >= ANOMALY_THRESHOLDS.velocityPerMinuteCrit) {
      return [{ signalType: 'VELOCITY_ANOMALY', severity: 'CRITICAL', source: 'detector.r1', reason: `${count} verifies/min` }];
    }
    if (count >= ANOMALY_THRESHOLDS.velocityPerMinuteWarn) {
      return [{ signalType: 'VELOCITY_ANOMALY', severity: 'HIGH', source: 'detector.r1', reason: `${count} verifies/min` }];
    }
    return [];
  }

  /** R-2 — distinct countries in 24 h exceeds warn / crit thresholds. */
  r2GeographicInconsistency(w: DetectorWindow): EmittedSignal[] {
    const cutoff = w.now.getTime() - 86_400_000;
    const countries = new Set(
      w.recentLocations
        .filter((l) => l.timestamp.getTime() >= cutoff)
        .map((l) => l.countryCode),
    );
    const distinct = countries.size;
    if (distinct >= ANOMALY_THRESHOLDS.distinctCountries24hCrit) {
      return [{ signalType: 'GEOGRAPHIC_INCONSISTENCY', severity: 'CRITICAL', source: 'detector.r2', reason: `${distinct} countries in 24h` }];
    }
    if (distinct >= ANOMALY_THRESHOLDS.distinctCountries24hWarn) {
      return [{ signalType: 'GEOGRAPHIC_INCONSISTENCY', severity: 'HIGH', source: 'detector.r2', reason: `${distinct} countries in 24h` }];
    }
    return [];
  }

  /**
   * R-3 — spend coefficient of variation (σ/μ) exceeds threshold.
   * Skip if sample size below `spendMinSampleSize` (signal is noise on
   * tiny samples). Per-currency: mixing currencies would dominate the
   * σ; we evaluate each currency separately.
   */
  r3SpendPatternDeviation(w: DetectorWindow): EmittedSignal[] {
    const byCcy = new Map<string, number[]>();
    for (const s of w.recentSpends) {
      const arr = byCcy.get(s.currency) ?? [];
      arr.push(s.amount);
      byCcy.set(s.currency, arr);
    }
    const out: EmittedSignal[] = [];
    for (const [currency, amounts] of byCcy) {
      if (amounts.length < ANOMALY_THRESHOLDS.spendMinSampleSize) continue;
      const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      if (mean <= 0) continue;
      const variance = amounts.reduce((acc, x) => acc + (x - mean) ** 2, 0) / amounts.length;
      const stddev = Math.sqrt(variance);
      const cv = stddev / mean;
      if (cv >= ANOMALY_THRESHOLDS.spendCoefficientOfVariation) {
        out.push({
          signalType: 'SPEND_PATTERN_DEVIATION',
          severity: cv >= ANOMALY_THRESHOLDS.spendCoefficientOfVariation * 1.5 ? 'CRITICAL' : 'HIGH',
          source: 'detector.r3',
          reason: `${currency} cv=${cv.toFixed(2)} σ=${stddev.toFixed(2)} μ=${mean.toFixed(2)} n=${amounts.length}`,
        });
      }
    }
    return out;
  }

  /** R-4 — fraction of DENIED verifies in the last hour. */
  r4FailedVerifySpike(w: DetectorWindow): EmittedSignal[] {
    const cutoff = w.now.getTime() - 3_600_000;
    const allRecent = w.signals.filter((s) => s.occurredAt.getTime() >= cutoff);
    const total = allRecent.length;
    if (total < ANOMALY_THRESHOLDS.failedVerifyMinSamples) return [];
    const denials = w.recentDenials.filter((d) => d.timestamp.getTime() >= cutoff).length;
    const rate = denials / Math.max(total, 1);
    if (rate >= ANOMALY_THRESHOLDS.failedVerifyRateCrit) {
      return [{ signalType: 'FAILED_VERIFY_SPIKE', severity: 'CRITICAL', source: 'detector.r4', reason: `${(rate * 100).toFixed(1)}% denied n=${total}` }];
    }
    if (rate >= ANOMALY_THRESHOLDS.failedVerifyRateWarn) {
      return [{ signalType: 'FAILED_VERIFY_SPIKE', severity: 'HIGH', source: 'detector.r4', reason: `${(rate * 100).toFixed(1)}% denied n=${total}` }];
    }
    return [];
  }

  /** R-5 — delegation chain depth too high (transitive-trust attack indicator). */
  r5DelegationChainAnomaly(w: DetectorWindow): EmittedSignal[] {
    const d = w.delegationChainDepth;
    if (d >= ANOMALY_THRESHOLDS.delegationDepthCrit) {
      return [{ signalType: 'DELEGATION_CHAIN_ANOMALY', severity: 'CRITICAL', source: 'detector.r5', reason: `depth=${d}` }];
    }
    if (d >= ANOMALY_THRESHOLDS.delegationDepthWarn) {
      return [{ signalType: 'DELEGATION_CHAIN_ANOMALY', severity: 'HIGH', source: 'detector.r5', reason: `depth=${d}` }];
    }
    return [];
  }
}
