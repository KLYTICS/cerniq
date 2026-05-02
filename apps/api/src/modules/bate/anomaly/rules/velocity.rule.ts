// R-1 Velocity rule.
//
// Triggers when a single agent records more than R1_MAX_VERIFIES_PER_WINDOW
// verify calls inside any sliding R1_WINDOW_MS-millisecond window. We slide
// the window forward over the (timestamp-sorted) observation list with two
// pointers and report the densest window we saw.

import {
  R1_MAX_VERIFIES_PER_WINDOW,
  R1_WINDOW_MS,
  type AnomalyEvent,
  type AnomalyInput,
  type Rule,
} from '../anomaly.types';

export class VelocityRule implements Rule {
  readonly id = 'R-1' as const;

  evaluate(input: AnomalyInput): AnomalyEvent[] {
    const verifies = input.recentVerifies;
    if (verifies.length <= R1_MAX_VERIFIES_PER_WINDOW) return [];

    // Sort ascending by timestamp without mutating caller's array.
    const sorted = [...verifies].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    let left = 0;
    let peakCount = 0;
    let peakWindowStart = 0;
    let peakWindowEnd = 0;

    for (let right = 0; right < sorted.length; right++) {
      const rightTs = sorted[right].timestamp.getTime();
      while (rightTs - sorted[left].timestamp.getTime() > R1_WINDOW_MS) {
        left++;
      }
      const count = right - left + 1;
      if (count > peakCount) {
        peakCount = count;
        peakWindowStart = sorted[left].timestamp.getTime();
        peakWindowEnd = rightTs;
      }
    }

    if (peakCount <= R1_MAX_VERIFIES_PER_WINDOW) return [];

    // Severity scales with how much the agent overshot the threshold.
    // 1× overshoot is HIGH; 2× is CRITICAL; ties stay HIGH (operator can
    // tighten later — see anomaly.types.ts).
    const severity = peakCount >= R1_MAX_VERIFIES_PER_WINDOW * 2 ? 'CRITICAL' : 'HIGH';

    return [
      {
        rule: this.id,
        signalType: 'VELOCITY_ANOMALY',
        severity,
        payload: {
          windowMs: R1_WINDOW_MS,
          threshold: R1_MAX_VERIFIES_PER_WINDOW,
          peakCount,
          peakWindowStart: new Date(peakWindowStart).toISOString(),
          peakWindowEnd: new Date(peakWindowEnd).toISOString(),
        },
      },
    ];
  }
}
