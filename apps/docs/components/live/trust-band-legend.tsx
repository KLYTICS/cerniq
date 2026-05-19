import { TRUST_BAND_THRESHOLDS } from '@aegis/types';

// Band metadata. The thresholds themselves come from the wire constant —
// the cross-package parity test (tests/cross-package/docs-trust-bands-parity.spec.ts)
// fails the build if this component ever mirrors the numbers instead of
// importing them.

const BAND_META: Record<
  keyof typeof TRUST_BAND_THRESHOLDS,
  { color: string; meaning: string }
> = {
  PLATINUM: {
    color: 'var(--aegis-cyan)',
    meaning:
      'Top tier. Sustained clean history, KYC-verified principal, no recent anomalies. Policies may grant maximum spend and broadest scope.',
  },
  VERIFIED: {
    color: 'var(--aegis-violet)',
    meaning:
      'Default for established agents. Policies typically run at the principal’s default scope and limits.',
  },
  WATCH: {
    color: 'var(--aegis-pending)',
    meaning:
      'Recent anomalies or a fresh agent without enough signal. Policies should cap spend and apply tighter scope.',
  },
  FLAGGED: {
    color: 'var(--aegis-denied)',
    meaning:
      'Active negative signal — fraud report, repeated denials, or rule-based anomaly. Most policies will deny outright.',
  },
};

// Render highest threshold first.
const ORDERED = (Object.entries(TRUST_BAND_THRESHOLDS) as Array<
  [keyof typeof TRUST_BAND_THRESHOLDS, number]
>).sort((a, b) => b[1] - a[1]);

export function TrustBandLegend() {
  return (
    <div className="my-6 overflow-hidden rounded-lg border border-[var(--aegis-mist)] bg-[var(--aegis-ink)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--aegis-steel)] text-xs uppercase tracking-wider text-[var(--aegis-fog)]">
          <tr>
            <th className="px-4 py-3 text-left">Band</th>
            <th className="px-4 py-3 text-left">Threshold</th>
            <th className="px-4 py-3 text-left">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {ORDERED.map(([band, threshold]) => {
            const meta = BAND_META[band];
            return (
              <tr key={band} className="border-t border-[var(--aegis-mist)]">
                <td className="px-4 py-3">
                  <span
                    className="inline-flex items-center gap-2 font-mono"
                    style={{ color: meta.color }}
                  >
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }}
                    />
                    {band}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono">&ge; {threshold}</td>
                <td className="px-4 py-3 text-[var(--aegis-fog)]">{meta.meaning}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-[var(--aegis-mist)] bg-[var(--aegis-graphite)] px-4 py-2 text-xs text-[var(--aegis-shadow)]">
        Live source: <code className="font-mono">packages/types/src/constants.ts &rarr; TRUST_BAND_THRESHOLDS</code>
      </div>
    </div>
  );
}
