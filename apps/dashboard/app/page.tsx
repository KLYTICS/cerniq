// Overview — single-pane operator landing. Pulls light, capped data so the
// page always renders fast (server-rendered, no streaming yet). Hard
// numbers only; no fabricated values when the API is unreachable.

import {
  OkoroApiError,
  OkoroAuthMissingError,
  listAgents,
  type AgentRow,
} from '../lib/api-client';
import { authConfigured } from '../lib/auth';
import { fmtNum, fmtPct, relativeTime, statusTone, trustBandTone } from '../lib/format';

interface Overview {
  agents: AgentRow[];
  total: number;
}

interface OverviewError {
  code: string;
  message: string;
}

async function loadOverview(): Promise<Overview | { error: OverviewError }> {
  try {
    const r = await listAgents({ limit: 50 });
    return { agents: r.agents, total: r.total };
  } catch (err) {
    if (err instanceof OkoroAuthMissingError) {
      return { error: { code: err.code, message: 'Set OKORO_DASHBOARD_API_KEY to populate this view.' } };
    }
    if (err instanceof OkoroApiError) return { error: { code: err.code, message: err.message } };
    return { error: { code: 'UNKNOWN', message: 'Unexpected error contacting OKORO API.' } };
  }
}

export default async function HomePage() {
  const overview = await loadOverview();

  return (
    <section className="okoro-overview">
      <h1>OKORO — Agent Gateway &amp; Identity Stack</h1>
      <p className="lede">
        Verified cryptographic identity, scoped authorization, and behavioral attestation for
        every AI agent. OKORO holds public keys only; private keys never leave the SDK.
      </p>

      {!authConfigured() ? (
        <div className="data-empty">
          <p>
            This dashboard reads live data from the OKORO API. Set{' '}
            <code>OKORO_DASHBOARD_API_KEY</code> and{' '}
            <code>OKORO_DASHBOARD_PRINCIPAL_ID</code> in your environment to populate the
            metrics below.
          </p>
        </div>
      ) : 'error' in overview ? (
        <div className="data-empty error" role="alert">
          <p>
            <strong>{overview.error.code}</strong> — {overview.error.message}
          </p>
        </div>
      ) : (
        <OverviewBody agents={overview.agents} total={overview.total} />
      )}

      <div className="block">
        <h2>What lives here</h2>
        <ul>
          <li>
            <a href="/agents">/agents</a> — register, inspect, and revoke agent identities.
          </li>
          <li>
            <a href="/policies">/policies</a> — issue scoped, time-bounded permissions.
          </li>
          <li>
            <a href="/mcp-servers">/mcp-servers</a> — registered MCP servers and live invocation
            counts.
          </li>
          <li>
            <a href="http://localhost:4000/docs" target="_blank" rel="noreferrer">
              API docs
            </a>{' '}
            — interactive OpenAPI spec served from the API.
          </li>
        </ul>
      </div>
    </section>
  );
}

function OverviewBody({ agents, total }: { agents: AgentRow[]; total: number }) {
  const active = agents.filter((a) => a.status === 'ACTIVE').length;
  const flagged = agents.filter((a) => a.trustBand === 'FLAGGED').length;
  const trustAvg = agents.length > 0 ? agents.reduce((s, a) => s + a.trustScore, 0) / agents.length : 0;
  const flaggedRate = agents.length > 0 ? (flagged / agents.length) * 100 : 0;
  const recent = agents
    .slice()
    .sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime())
    .slice(0, 5);

  return (
    <>
      {total === 0 ? (
        <div className="okoro-panel" role="status">
          <h2 className="okoro-panel-title">Welcome — let's register your first agent</h2>
          <p className="muted">
            From a cold install, the path to a working <code>okoro.verify()</code> is six copy-paste
            steps. The Quickstart walks through keypair → register → handshake → policy → first
            verify, with copy-buttons on every snippet.
          </p>
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <a href="/quickstart" className="okoro-button">open quickstart →</a>
            <a href="/agents?action=register" className="okoro-button-ghost">register an agent</a>
          </div>
        </div>
      ) : null}

      <dl className="metric-strip" aria-label="Principal summary">
        <Metric label="agents" value={fmtNum(total)} />
        <Metric label="active" value={fmtNum(active)} tone={active < total ? 'warn' : 'ok'} />
        <Metric label="flagged" value={fmtPct(flaggedRate)} tone={flagged > 0 ? 'crit' : 'ok'} />
        <Metric label="trust avg" value={agents.length > 0 ? trustAvg.toFixed(0) : '–'} />
        <Metric label="scanned" value={`${agents.length} / ${total}`} tone={agents.length < total ? 'warn' : 'muted'} />
      </dl>

      {recent.length > 0 ? (
        <>
          <h2>Recently registered</h2>
          <table className="data-table dense" aria-label="Most recent agents">
            <thead>
              <tr>
                <th>id</th>
                <th>label</th>
                <th>runtime</th>
                <th>status</th>
                <th>band</th>
                <th>registered</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((a) => (
                <tr key={a.agentId}>
                  <td className="mono">
                    <a href={`/agents/${encodeURIComponent(a.agentId)}`}>{a.agentId}</a>
                  </td>
                  <td className="dim">{a.label ?? '–'}</td>
                  <td className="mono">{a.runtime.toLowerCase()}</td>
                  <td>
                    <span className={`badge badge-${statusTone(a.status)}`}>{a.status.toLowerCase()}</span>
                  </td>
                  <td>
                    <span className={`badge badge-${trustBandTone(a.trustBand)}`}>{a.trustBand}</span>
                  </td>
                  <td className="dim">{relativeTime(a.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'crit' | 'muted' }) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
