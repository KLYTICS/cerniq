import { Injectable } from '@nestjs/common';
import type { BateSignal, BateSignalType, TrustBand } from '@prisma/client';

import {
  AGE_COHORT_CAP,
  AGE_COHORT_POINTS_PER_DAY,
  FRAUD_REPORT_SEVERITY_PENALTY,
  NORMAL_VELOCITY_BONUS,
  NORMAL_VELOCITY_DISTINCT_DAYS_THRESHOLD,
  PER_TYPE_CAP_PER_WINDOW,
  RELYING_PARTY_WEIGHT_CAP,
  RELYING_PARTY_WEIGHT_FLOOR,
  SCORE_CEILING,
  SCORE_FLOOR,
  SIGNAL_DELTA,
  TRUST_BAND_CUTOFFS,
  WEIGHTS_VERSION,
} from './bate.weights';

export interface AgentScoringInput {
  currentScore: number;
  createdAt: Date;
  recentSignals: BateSignal[];
  /** Optional signal-level relying-party trust weights; missing => 1.0. */
  relyingPartyWeights?: Record<string, number>;
}

export interface ScoringExplanation {
  finalScore: number;
  delta: number;
  contributors: { kind: string; delta: number; reason: string }[];
  weightsVersion: string;
}

/**
 * BATE — Behavioural Attestation Engine, scoring kernel.
 * Spec: `03_AEGIS_TECHNICAL_SPEC.md` § 3.2 + `docs/BATE_ALGORITHM.md`.
 *
 * Pure function. Takes current score + age + signals, returns the new
 * score in [0, 1000]. Deterministic and side-effect-free so we can replay
 * history and add ML on top later.
 *
 * Tunables live in `bate.weights.ts`; cold-start policy in `bate.cold-start.ts`.
 */
@Injectable()
export class BateScorer {
  compute(input: AgentScoringInput): number {
    return this.explain(input).finalScore;
  }

  /**
   * Same calculation as `compute`, but also returns a per-contributor
   * breakdown — useful for the dashboard "why did my score change" panel
   * and for replaying history during weight reviews.
   */
  explain(input: AgentScoringInput): ScoringExplanation {
    const start = input.currentScore;
    const counts = countByType(input.recentSignals);
    const contributors: ScoringExplanation['contributors'] = [];

    let score = start;

    for (const [type, count] of typedEntries(counts)) {
      if (count === 0) continue;
      if (type === 'RELYING_PARTY_FRAUD_REPORT') continue; // handled below
      if (type === 'NORMAL_VELOCITY') continue; // handled via day-threshold bonus
      const perOccurrence = SIGNAL_DELTA[type] ?? 0;
      if (perOccurrence === 0) continue;
      const raw = perOccurrence * count;
      const cap = PER_TYPE_CAP_PER_WINDOW[type] ?? Number.POSITIVE_INFINITY;
      const clamped = Math.sign(raw) * Math.min(Math.abs(raw), cap);
      score += clamped;
      contributors.push({
        kind: type,
        delta: clamped,
        reason: `${count} × ${perOccurrence}${Math.abs(raw) > cap ? ` (capped at ±${cap})` : ''}`,
      });
    }

    let fraudDelta = 0;
    for (const s of input.recentSignals) {
      if (s.signalType !== 'RELYING_PARTY_FRAUD_REPORT') continue;
      const base = FRAUD_REPORT_SEVERITY_PENALTY[s.severity];
      const rpWeight = clamp(
        input.relyingPartyWeights?.[s.source] ?? 1.0,
        RELYING_PARTY_WEIGHT_FLOOR,
        RELYING_PARTY_WEIGHT_CAP,
      );
      fraudDelta += Math.round(base * rpWeight);
    }
    if (fraudDelta !== 0) {
      const cap = PER_TYPE_CAP_PER_WINDOW.RELYING_PARTY_FRAUD_REPORT;
      const clamped = Math.sign(fraudDelta) * Math.min(Math.abs(fraudDelta), cap);
      score += clamped;
      contributors.push({
        kind: 'RELYING_PARTY_FRAUD_REPORT',
        delta: clamped,
        reason: `severity-weighted, RP-weighted${Math.abs(fraudDelta) > cap ? ` (capped at ±${cap})` : ''}`,
      });
    }

    const normalVelocityDays = countDistinctSignalDays(input.recentSignals, 'NORMAL_VELOCITY');
    if (normalVelocityDays >= NORMAL_VELOCITY_DISTINCT_DAYS_THRESHOLD) {
      score += NORMAL_VELOCITY_BONUS;
      contributors.push({
        kind: 'NORMAL_VELOCITY',
        delta: NORMAL_VELOCITY_BONUS,
        reason: `${normalVelocityDays} distinct days ≥ threshold ${NORMAL_VELOCITY_DISTINCT_DAYS_THRESHOLD}`,
      });
    }

    const ageDays = Math.floor((Date.now() - input.createdAt.getTime()) / 86_400_000);
    const ageBonus = Math.min(ageDays * AGE_COHORT_POINTS_PER_DAY, AGE_COHORT_CAP);
    if (ageBonus > 0) {
      score += ageBonus;
      contributors.push({
        kind: 'AGE_COHORT',
        delta: ageBonus,
        reason: `${ageDays} days × ${AGE_COHORT_POINTS_PER_DAY}, capped at ${AGE_COHORT_CAP}`,
      });
    }

    const final = Math.max(SCORE_FLOOR, Math.min(SCORE_CEILING, Math.round(score)));
    return {
      finalScore: final,
      delta: final - start,
      contributors,
      weightsVersion: WEIGHTS_VERSION,
    };
  }

  bandFromScore(score: number): TrustBand {
    for (const cutoff of TRUST_BAND_CUTOFFS) {
      if (score >= cutoff.min) return cutoff.band;
    }
    return 'FLAGGED';
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function countByType(signals: BateSignal[]): Partial<Record<BateSignalType, number>> {
  const counts: Partial<Record<BateSignalType, number>> = {};
  for (const s of signals) {
    counts[s.signalType] = (counts[s.signalType] ?? 0) + 1;
  }
  return counts;
}

function typedEntries<K extends string, V>(o: Partial<Record<K, V>>): [K, V][] {
  return Object.entries(o) as [K, V][];
}

function countDistinctSignalDays(signals: BateSignal[], type: BateSignalType): number {
  const days = new Set<string>();
  for (const s of signals) {
    if (s.signalType === type) days.add(s.occurredAt.toISOString().slice(0, 10));
  }
  return days.size;
}
