// Audit — principal-wide recent verify decisions. The audit API is
// per-agent (`/v1/agents/:id/audit`), so we fan out across agents with
// bounded concurrency and a small per-agent slice. For deep audit work
// (export, full pagination), use the per-agent page.

import type { Metadata } from 'next';

import {
  AegisApiError,
  AegisAuthMissingError,
  listAgents,
  listAudit,
  listAuditEvents,
  type AgentRow,
  type AuditEventWire,
  type AuditRow,
} from '../../lib/api-client';
import { authConfigured } from '../../lib/auth';
import { fmtNum, fmtPct, relativeTime, shortId } from '../../lib/format';

export const metadata: Metadata = {
  title: 'Audit · AEGIS',
};

interface AuditPageProps {
  searchParams?: Promise<{ stripeEventId?: string }> | { stripeEventId?: string };
}

function pickStripeEventId(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  // Stripe event ids are `evt_` followed by alphanumeric; accept that
  // shape strictly so a malformed input never reaches the API.
  if (!/^evt_[A-Za-z0-9]+$/.test(trimmed)) return null;
  return trimmed;
}

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

async function fetchAggregatedAudit(): Promise<Result | { error: { code: string; message: string } }> {
  let agentList;
  try {
    agentList = await listAgents({ limit: MAX_AGENT_FANOUT });
  } catch (err) {
    if (err instanceof AegisAuthMissingError) {
      return { error: { code: err.code, message: 'Set AEGIS_DASHBOARD_API_KEY to populate this view.' } };
    }
    if (err instanceof AegisApiError) return { error: { code: err.code, message: err.message } };
    return { error: { code: 'UNKNOWN', message: 'Unexpected error contacting AEGIS API.' } };
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

  combined.sort((a, b) => new Date(b.event.timestamp).getTime() - new Date(a.event.timestamp).getTime());

  return {
    rows: combined.slice(0, RENDER_LIMIT),
    agentsTotal: agentList.total,
    agentsScanned: agentList.agents.length,
    agentsWithErrors: errors,
  };
}

interface StripeFilterResult {
  events: AuditEventWire[];
  error?: { code: string; message: string };
}

async function fetchByStripeEventId(stripeEventId: string): Promise<StripeFilterResult> {
  try {
    const page = await listAuditEvents({ stripeEventId, limit: 100 });
    return { events: page.events };
  } catch (err) {
    if (err instanceof AegisAuthMissingError) {
      return {
        events: [],
        error: { code: err.code, message: 'Set AEGIS_DASHBOARD_API_KEY to populate this view.' },
      };
    }
    if (err instanceof AegisApiError) {
      return { events: [], error: { code: err.code, message: err.message } };
    }
    return { events: [], error: { code: 'UNKNOWN', message: 'Unexpected error contacting AEGIS API.' } };
  }
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  // Next 16 made `searchParams` async; await is a no-op if a plain object is passed.
  const sp = searchParams instanceof Promise ? await searchParams : searchParams;
  const stripeEventId = pickStripeEventId(sp?.stripeEventId);

  return (
    <section className="aegis-page">
      <header className="aegis-page-header">
        <h1>Audit</h1>
        <p className="muted">
          Recent verify decisions across all your agents. Each row is signed and chained
          (CLAUDE.md invariant 3) — the public key at <code>/.well-known/audit-signing-key</code>
          lets external auditors verify integrity offline.
        </p>
      </header>

      {!authConfigured() ? (
        <div className="data-empty">
          <p>Set <code>AEGIS_DASHBOARD_API_KEY</code> to populate this view.</p>
        </div>
      ) : (
        <>
          <StripeFilterBar current={stripeEventId} />
          {stripeEventId ? (
            <StripeFilteredView stripeEventId={stripeEventId} />
          ) : (
            <DefaultAuditView />
          )}
        </>
      )}
    </section>
  );
}

async function DefaultAuditView() {
  const data = await fetchAggregatedAudit();
  if ('error' in data) {
    return (
      <div className="data-empty error" role="alert">
        <p>
          <strong>{data.error.code}</strong> — {data.error.message}
        </p>
      </div>
    );
  }
  return <AuditBody data={data} />;
}

async function StripeFilteredView({ stripeEventId }: { stripeEventId: string }) {
  const result = await fetchByStripeEventId(stripeEventId);
  if (result.error) {
    return (
      <div className="data-empty error" role="alert">
        <p>
          <strong>{result.error.code}</strong> — {result.error.message}
        </p>
      </div>
    );
  }
  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>
        Showing {result.events.length} audit event{result.events.length === 1 ? '' : 's'} matching{' '}
        <code>{stripeEventId}</code>.
      </p>
      {result.events.length === 0 ? (
        <div className="data-empty">
          <p>No audit events found for this Stripe event id.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table dense" aria-label="Audit events for Stripe id">
            <thead>
              <tr>
                <th>when</th>
                <th>event id</th>
                <th>action</th>
                <th>decision</th>
                <th>agent</th>
              </tr>
            </thead>
            <tbody>
              {result.events.map((e) => (
                <tr key={e.eventId}>
                  <td className="dim">{relativeTime(e.timestamp)}</td>
                  <td className="mono">{shortId(e.eventId, 8, 4)}</td>
                  <td className="mono dim">{e.action ?? '–'}</td>
                  <td>
                    <span
                      className={`badge badge-${decisionTone(e.decision.toLowerCase())}`}
                    >
                      {e.decision.toLowerCase()}
                    </span>
                  </td>
                  <td className="mono dim">
                    {e.agentId
                      ? shortId(e.agentId, 6, 4)
                      : e.claimedAgentId
                        ? `(${shortId(e.claimedAgentId, 6, 4)})`
                        : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function StripeFilterBar({ current }: { current: string | null }) {
  return (
    <form
      method="get"
      className="filter-bar"
      aria-label="Filter by Stripe event id"
      style={{ marginBottom: 12 }}
    >
      <label>
        <span>stripe event id</span>
        <input
          name="stripeEventId"
          type="text"
          defaultValue={current ?? ''}
          placeholder="evt_…"
          pattern="evt_[A-Za-z0-9]+"
          title="Stripe event id starts with evt_ followed by alphanumeric characters."
          aria-label="Filter audit events by Stripe event id"
          style={{ minWidth: 240, fontFamily: 'var(--mono)' }}
        />
      </label>
      <button type="submit">filter</button>
      {current ? (
        <a href="/audit" aria-label="Clear stripeEventId filter">
          clear
        </a>
      ) : null}
    </form>
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
        <Metric label="denial rate" value={fmtPct(denialRate)} tone={denialRate > 1 ? 'warn' : 'ok'} />
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
                  <span className={`badge badge-${decisionTone(event.decision)}`}>{event.decision}</span>
                </td>
                <td className="mono dim">{event.decisionReason ?? '–'}</td>
                <td className="mono dim">{event.policyId ? shortId(event.policyId, 6, 4) : '–'}</td>
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

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'crit' | 'muted' }) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
