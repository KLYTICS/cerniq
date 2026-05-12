// Bloomberg-density agent table. Per memory `feedback_less_cards`: tabular
// layout, monospace, every column carries operator-relevant data.

import { relativeTime, shortId, statusTone, trustBandTone } from '../../../lib/format';
import type { AgentRow } from '../../../lib/api-client';
import { Copyable } from '../../../components/CopyButton';
import { StatusDot } from '../../../components/StatusDot';
import { AgentIdLink } from './AgentIdLink';
import { RevokeAgentButton } from './RevokeAgentButton';

interface Props {
  agents: AgentRow[];
}

export function AgentTable({ agents }: Props) {
  if (agents.length === 0) {
    return (
      <div className="data-empty">
        <p>No agents registered yet.</p>
        <pre className="hint">{`# from your terminal:
aegis agents register --runtime anthropic --label "shopper-bot"`}</pre>
      </div>
    );
  }

  // Active = recently seen within 5 min. Drives the pulsing dot on the row,
  // a Bloomberg-classic "live" indicator without forcing a real-time refresh.
  const liveThresholdMs = 5 * 60_000;
  function isLive(a: AgentRow): boolean {
    if (!a.lastSeenAt) return false;
    return Date.now() - new Date(a.lastSeenAt).getTime() < liveThresholdMs;
  }

  return (
    <div className="table-scroll">
      <table className="data-table dense" aria-label="Registered agents">
        <thead>
          <tr>
            <th>id</th>
            <th>label</th>
            <th>runtime</th>
            <th>model</th>
            <th>status</th>
            <th className="num">trust</th>
            <th>band</th>
            <th>last seen</th>
            <th>registered</th>
            <th aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.agentId}>
              <td className="mono">
                <Copyable value={a.agentId} label="agent id">
                  <AgentIdLink agentId={a.agentId}>{shortId(a.agentId, 8, 4)}</AgentIdLink>
                </Copyable>
              </td>
              <td className="dim">{a.label ?? '–'}</td>
              <td className="mono">{a.runtime.toLowerCase()}</td>
              <td className="mono dim">{a.model ?? '–'}</td>
              <td>
                <StatusDot
                  status={a.status}
                  pulse={a.status === 'ACTIVE' && isLive(a)}
                  label={
                    <span className={`badge badge-${statusTone(a.status)}`}>
                      {a.status.toLowerCase()}
                    </span>
                  }
                />
              </td>
              <td className="num mono">{a.trustScore}</td>
              <td>
                <span className={`badge badge-${trustBandTone(a.trustBand)}`}>{a.trustBand}</span>
              </td>
              <td className="dim">{relativeTime(a.lastSeenAt)}</td>
              <td className="dim">{relativeTime(a.registeredAt)}</td>
              <td className="row-actions">
                {a.status !== 'REVOKED' ? <RevokeAgentButton agentId={a.agentId} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
