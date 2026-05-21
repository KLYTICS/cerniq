// Top-of-page metric strip. Computed from the same agent list the table
// renders — no separate API round-trip, no risk of "active total > total".

import type { AgentRow } from '../../../lib/api-client';
import { fmtNum, fmtPct } from '../../../lib/format';

interface Props {
  agents: AgentRow[];
  total: number;
}

export function AgentMetricStrip({ agents, total }: Props) {
  const active = agents.filter((a) => a.status === 'ACTIVE').length;
  const revoked = agents.filter((a) => a.status === 'REVOKED').length;
  const pending = agents.filter((a) => a.status === 'PENDING_VERIFICATION').length;
  const flagged = agents.filter((a) => a.trustBand === 'FLAGGED').length;
  const trustAvg =
    agents.length > 0
      ? agents.reduce((sum, a) => sum + a.trustScore, 0) / agents.length
      : 0;
  const flaggedRate = agents.length > 0 ? (flagged / agents.length) * 100 : 0;

  return (
    <dl className="metric-strip" aria-label="Agents summary">
      <Item label="total" value={fmtNum(total)} />
      <Item label="active" value={fmtNum(active)} tone={active < total ? 'warn' : 'ok'} />
      <Item label="pending" value={fmtNum(pending)} tone={pending > 0 ? 'warn' : 'muted'} />
      <Item label="revoked" value={fmtNum(revoked)} tone={revoked > 0 ? 'muted' : 'muted'} />
      <Item label="flagged" value={fmtPct(flaggedRate)} tone={flagged > 0 ? 'crit' : 'ok'} />
      <Item label="trust avg" value={agents.length > 0 ? trustAvg.toFixed(0) : '–'} />
    </dl>
  );
}

function Item({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'crit' | 'muted' }) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
