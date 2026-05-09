// Small colored pip rendered inline before status text. Designed to be
// tone-driven (ok/warn/crit/muted), with optional `pulse` for live states
// like "ACTIVE just-seen". Uses the shared `statusTone` mapping so badges
// and dots stay in lockstep.

import type { ReactNode } from 'react';

import { statusTone } from '../lib/format';

interface Props {
  status: string;
  pulse?: boolean;
  label?: ReactNode;
}

export function StatusDot({ status, pulse = false, label }: Props) {
  const tone = statusTone(status);
  return (
    <span className="status" aria-label={`Status: ${status}`}>
      <span
        className={`status-dot status-dot-${tone}${pulse ? ' status-dot-pulse' : ''}`}
        aria-hidden="true"
      />
      {label ?? status.toLowerCase()}
    </span>
  );
}
