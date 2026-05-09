// TrialCountdown — FREE-tier verifier showing trial consumption + a
// rough "exhausts in N days" projection. Server component.
//
// API gap (Round 21 followup): /v1/billing/plan does not yet expose
// `trialUsedCount`/`trialExhaustedAt`. We proxy via `monthVerifyCount` /
// `monthlyQuota` because on FREE the monthly cap == the trial cap. We
// label this clearly in the UI (small "(approx.)" hint) so the operator
// sees we are not fabricating a real trial counter.

import type { ReactElement } from 'react';

import type { PlanSummary } from '../../../lib/api-client';
import { deriveTrialView } from '../../../lib/billing';

const NUM = new Intl.NumberFormat('en-US');

interface Props {
  plan: PlanSummary;
}

export function TrialCountdown({ plan }: Props): ReactElement | null {
  if (plan.planTier !== 'FREE') return null;
  const v = deriveTrialView(plan);

  if (v.used === null || v.quota === null || v.pct === null || v.remaining === null) {
    return (
      <section
        aria-label="Trial usage"
        style={{
          border: '1px solid var(--border)',
          padding: '12px 16px',
          marginBottom: 16,
          background: 'var(--bg-elev)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 4,
          }}
        >
          trial verifies
        </div>
        <div className="muted">Usage data unavailable.</div>
      </section>
    );
  }

  const projection = projectTrialDays(v.used, v.quota);

  return (
    <section
      aria-label="Trial usage"
      style={{
        border: '1px solid var(--border)',
        padding: '12px 16px',
        marginBottom: 16,
        background: 'var(--bg-elev)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 6,
        }}
      >
        trial verifies {v.proxied ? '(approx.)' : ''}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontFamily: 'var(--mono)',
          fontSize: 14,
        }}
      >
        <span style={{ minWidth: 140 }}>
          {NUM.format(v.used)} / {NUM.format(v.quota)}
        </span>
        <Bar pct={v.pct} />
        <span style={{ minWidth: 64, textAlign: 'right' }}>{v.pct.toFixed(2)}%</span>
        <span className="muted" style={{ minWidth: 140, textAlign: 'right' }}>
          {NUM.format(v.remaining)} remaining
        </span>
      </div>
      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
        {projection}
      </div>
    </section>
  );
}

function Bar({ pct }: { pct: number }): ReactElement {
  const color = pct >= 95 ? 'var(--danger)' : pct >= 75 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Trial verifies consumed"
      style={{
        flex: 1,
        height: 6,
        background: 'var(--border)',
        position: 'relative',
        minWidth: 120,
      }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          height: '100%',
          background: color,
        }}
      />
    </div>
  );
}

// Crude projection: assume usage is uniformly distributed across the
// current calendar month; extrapolate when the trial will exhaust.
// Returns a human sentence; never returns a fake "0 days" — when we
// can't project, we say so.
function projectTrialDays(used: number, quota: number): string {
  if (used <= 0) return 'No trial verifies consumed yet.';
  if (used >= quota) return 'Trial fully consumed — upgrade to continue verifying.';
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  if (dayOfMonth <= 0) return 'Projection unavailable.';
  const perDay = used / dayOfMonth;
  if (perDay <= 0) return 'Projection unavailable.';
  const daysToExhaust = Math.max(0, Math.ceil((quota - used) / perDay));
  if (daysToExhaust >= 999) return 'At current rate, trial will not exhaust this month.';
  return `At current rate, trial exhausts in approximately ${daysToExhaust} day${daysToExhaust === 1 ? '' : 's'}.`;
}
