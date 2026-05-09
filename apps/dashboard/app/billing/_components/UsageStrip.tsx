// UsageStrip — Bloomberg-density MetricStrip for paid-tier monthly usage.
// Server component. Renders one row of label/value pairs and a thin
// progress bar underneath when the plan has a finite quota.

import type { ReactElement } from 'react';

import type { PlanSummary } from '../../../lib/api-client';
import { deriveUsageView } from '../../../lib/billing';

const NUM = new Intl.NumberFormat('en-US');

interface Props {
  plan: PlanSummary;
}

export function UsageStrip({ plan }: Props): ReactElement {
  const v = deriveUsageView(plan);
  return (
    <section aria-label="Monthly verify usage" style={{ marginBottom: 16 }}>
      <dl
        className="metric-strip"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 8 }}
      >
        <div className="metric">
          <dt>monthly verifies</dt>
          <dd>
            {v.used === null
              ? 'unavailable'
              : v.unlimited
                ? `${NUM.format(v.used)} / unlimited`
                : `${NUM.format(v.used)} / ${NUM.format(v.quota ?? 0)}`}
          </dd>
        </div>
        <div className={`metric ${tone(v.pct)}`}>
          <dt>used</dt>
          <dd>{v.pct === null ? '—' : `${v.pct.toFixed(2)}%`}</dd>
        </div>
        <div className="metric">
          <dt>remaining</dt>
          <dd>
            {v.unlimited
              ? '∞'
              : v.remaining === null
                ? 'unavailable'
                : NUM.format(v.remaining)}
          </dd>
        </div>
        <div className="metric">
          <dt>cycle</dt>
          <dd style={{ fontSize: 13 }}>calendar month</dd>
        </div>
      </dl>
      {v.pct !== null ? <ProgressBar pct={v.pct} /> : null}
    </section>
  );
}

function ProgressBar({ pct }: { pct: number }): ReactElement {
  const color = pct >= 95 ? 'var(--danger)' : pct >= 75 ? 'var(--warn)' : 'var(--ok)';
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Monthly quota consumed"
      style={{
        height: 4,
        background: 'var(--border)',
        border: '1px solid var(--border)',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          height: '100%',
          background: color,
          transition: 'width 200ms linear',
        }}
      />
    </div>
  );
}

function tone(pct: number | null): string {
  if (pct === null) return 'metric-muted';
  if (pct >= 95) return 'metric-crit';
  if (pct >= 75) return 'metric-warn';
  return 'metric-ok';
}
