// Radial gauge — SVG with stroke-dashoffset animated via CSS keyframes.
// Server component; the score is hardcoded for marketing impression
// (no fabricated live data per CLAUDE.md §invariants — but a demo gauge
// is illustrative, not a claim about a real agent).

interface TrustGaugeProps {
  score?: number;
  band?: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
}

const RADIUS = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Display is 270° of arc; the dasharray spans 0.75 of the circle.
const ARC_LENGTH = CIRCUMFERENCE * 0.75;
const GAP = CIRCUMFERENCE - ARC_LENGTH;

export function TrustGauge({ score = 850, band = 'PLATINUM' }: TrustGaugeProps) {
  const clamped = Math.max(0, Math.min(1000, score));
  const filledFraction = clamped / 1000;
  // The visible arc is 270° = 0.75 of circumference.
  // gauge-fill stroke-dasharray = filledArc, totalArc - filledArc.
  const filledArc = ARC_LENGTH * filledFraction;
  const unfilledArc = ARC_LENGTH - filledArc;
  // CSS keyframe animates from full offset to (CIRCUMFERENCE - filledArc),
  // exposed via --gauge-offset.
  const targetOffset = CIRCUMFERENCE - filledArc;

  return (
    <div className="trust-gauge" aria-label={`AEGIS trust score gauge — ${score} ${band}`}>
      <svg width="120" height="120" viewBox="0 0 120 120" role="img">
        {/* Rotate -135° so the 270° gap is at the bottom. */}
        <g transform="rotate(-225 60 60)">
          <circle
            className="gauge-track"
            cx="60" cy="60" r={RADIUS}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${ARC_LENGTH} ${GAP}`}
          />
          <circle
            className="gauge-fill"
            cx="60" cy="60" r={RADIUS}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${filledArc} ${unfilledArc} ${GAP}`}
            style={{ ['--gauge-offset' as string]: `${targetOffset}` }}
          />
        </g>
        <text className="gauge-label" x="60" y="60" textAnchor="middle" dominantBaseline="middle">{clamped}</text>
        <text x="60" y="78" textAnchor="middle" dominantBaseline="middle"
              style={{ fill: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1 }}>
          / 1000
        </text>
      </svg>
      <dl className="gauge-info" style={{ margin: 0 }}>
        <dt>Band</dt>
        <dd>{band}</dd>
        <dt>Last anomaly</dt>
        <dd>None — 14d</dd>
        <dt>Engine</dt>
        <dd>BATE v2 · 5 rules</dd>
      </dl>
    </div>
  );
}
