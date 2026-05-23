// Audit — principal-wide recent verify decisions. The audit API is
// per-agent (`/v1/agents/:id/audit`), so we fan out across agents with
// bounded concurrency and a small per-agent slice. For deep audit work
// (export, full pagination), use the per-agent page.

import type { Metadata } from 'next';

import {
  CerniqApiError,
  CerniqAuthMissingError,
  listAgents,
  listAudit,
  type AgentRow,
  type AuditRow,
} from '../../lib/api-client';
import { authConfigured } from '../../lib/auth';
import { fmtNum, fmtPct, relativeTime, shortId } from '../../lib/format';

export const metadata: Metadata = {
  title: 'Audit · CERNIQ',
};

const MAX_AGENT_FANOUT = 50;
const PER_AGENT_SLICE = 10;
const FANOUT_CONCURRENCY = 6;
const RENDER_LIMIT = 200;

interface CombinedRow {
  event: AuditRow;
  agent: AgentRow;
}

interface Result {
  rows: CombinedRow[];
  agentsTotal: number;
  agentsScanned: number;
  agentsWithErrors: number;
}

async function fetchAggregatedAudit(): Promise<
  Result | { error: { code: string; message: string } }
> {
  let agentList;
  try {
    agentList = await listAgents({ limit: MAX_AGENT_FANOUT });
  } catch (err) {
    if (err instanceof CerniqAuthMissingError) {
      return {
        error: { code: err.code, message: 'Set CERNIQ_DASHBOARD_API_KEY to populate this view.' },
      };
    }
    if (err instanceof CerniqApiError) return { error: { code: err.code, message: err.message } };
    return { error: { code: 'UNKNOWN', message: 'Unexpected error contacting CERNIQ API.' } };
  }

  const combined: CombinedRow[] = [];
  let errors = 0;

  const queue = agentList.agents.slice();
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const agent = queue.shift();
      if (!agent) return;
      try {
        const page = await listAudit(agent.agentId, { limit: PER_AGENT_SLICE });
        for (const e of page.events) combined.push({ event: e, agent });
      } catch {
        errors += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: FANOUT_CONCURRENCY }, () => worker()));

  combined.sort(
    (a, b) => new Date(b.event.timestamp).getTime() - new Date(a.event.timestamp).getTime(),
  );

  return {
    rows: combined.slice(0, RENDER_LIMIT),
    agentsTotal: agentList.total,
    agentsScanned: agentList.agents.length,
    agentsWithErrors: errors,
  };
}

export default async function AuditPage() {
  const data = await fetchAggregatedAudit();

  return (
    <section className="cerniq-page">
      <header className="cerniq-page-header">
        <h1>Audit</h1>
        <p className="muted">
          Recent verify decisions across all your agents. Each row is signed and chained (CLAUDE.md
          invariant 3) — the public key at <code>/.well-known/audit-signing-key</code>
          lets external auditors verify integrity offline.
        </p>
      </header>

      {!authConfigured() ? (
        <div className="data-empty">
          <p>
            Set <code>CERNIQ_DASHBOARD_API_KEY</code> to populate this view.
          </p>
        </div>
      ) : 'error' in data ? (
        <div className="data-empty error" role="alert">
          <p>
            <strong>{data.error.code}</strong> — {data.error.message}
          </p>
        </div>
      ) : (
        <AuditBody data={data} />
      )}
    </section>
  );
}

function AuditBody({ data }: { data: Result }) {
  const approved = data.rows.filter((r) => r.event.decision === 'approved').length;
  const denied = data.rows.filter((r) => r.event.decision === 'denied').length;
  const flagged = data.rows.filter((r) => r.event.decision === 'flagged').length;
  const denialRate = data.rows.length > 0 ? (denied / data.rows.length) * 100 : 0;

  return (
    <>
      <dl className="metric-strip" aria-label="Audit summary">
        <Metric label="events" value={fmtNum(data.rows.length)} />
        <Metric label="approved" value={fmtNum(approved)} tone="ok" />
        <Metric label="denied" value={fmtNum(denied)} tone={denied > 0 ? 'crit' : 'muted'} />
        <Metric label="flagged" value={fmtNum(flagged)} tone={flagged > 0 ? 'warn' : 'muted'} />
        <Metric
          label="denial rate"
          value={fmtPct(denialRate)}
          tone={denialRate > 1 ? 'warn' : 'ok'}
        />
      </dl>

      {data.agentsWithErrors > 0 ? (
        <p className="form-warning" role="status">
          {data.agentsWithErrors} agent(s) failed to return audit — partial view.
        </p>
      ) : null}
      {data.agentsTotal > MAX_AGENT_FANOUT ? (
        <p className="form-warning" role="status">
          {data.agentsTotal} agents total — scanning the most recent {MAX_AGENT_FANOUT}. For deep
          audit, open an agent's detail page.
        </p>
      ) : null}

      {data.rows.length === 0 ? (
        <div className="data-empty">
          <p>No verify decisions in the recent window.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table dense" aria-label="Recent verify decisions">
            <thead>
              <tr>
                <th>when</th>
                <th>agent</th>
                <th>decision</th>
                <th>reason</th>
                <th>policy</th>
                <th className="num">amount</th>
                <th>domain</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(({ event, agent }) => (
                <tr key={event.id}>
                  <td className="dim">{relativeTime(event.timestamp)}</td>
                  <td className="mono">
                    <a href={`/agents/${encodeURIComponent(agent.agentId)}`}>
                      {shortId(agent.agentId, 6, 4)}
                    </a>
                  </td>
                  <td>
                    <span className={`badge badge-${decisionTone(event.decision)}`}>
                      {event.decision}
                    </span>
                  </td>
                  <td className="mono dim">{event.decisionReason ?? '–'}</td>
                  <td className="mono dim">
                    {event.policyId ? shortId(event.policyId, 6, 4) : '–'}
                  </td>
                  <td className="num mono">
                    {event.amount !== null && event.amount !== undefined
                      ? `${event.amount} ${event.currency ?? ''}`
                      : '–'}
                  </td>
                  <td className="dim">{event.domain ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function decisionTone(decision: string): 'ok' | 'warn' | 'crit' | 'muted' {
  if (decision === 'approved') return 'ok';
  if (decision === 'denied') return 'crit';
  if (decision === 'flagged') return 'warn';
  return 'muted';
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'crit' | 'muted';
}) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
