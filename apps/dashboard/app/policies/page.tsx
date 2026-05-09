// Policies — aggregated across the principal's agents. The API route is
// per-agent (`/v1/agents/:id/policies`), so we fan out server-side with a
// hard cap on parallelism + agent count to bound load. A future API addition
// (`GET /v1/policies?principalId`) would replace this fan-out.

import type { Metadata } from 'next';

import {
  AegisApiError,
  AegisAuthMissingError,
  listAgents,
  listPolicies,
  type AgentRow,
  type PolicyRow,
} from '../../lib/api-client';
import { authConfigured } from '../../lib/auth';
import { relativeTime, shortId, statusTone } from '../../lib/format';

export const metadata: Metadata = {
  title: 'Policies · AEGIS',
};

const MAX_AGENT_FANOUT = 50;
const FANOUT_CONCURRENCY = 6;

interface AggregatedPolicy {
  agent: AgentRow;
  policy: PolicyRow;
}

interface AggregatedResult {
  policies: AggregatedPolicy[];
  agentsScanned: number;
  agentsTotal: number;
  agentsWithErrors: number;
}

async function fetchAggregatedPolicies(): Promise<AggregatedResult | { error: { code: string; message: string } }> {
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

  const aggregated: AggregatedPolicy[] = [];
  let agentsWithErrors = 0;

  // Bounded-concurrency fan-out. We don't use Promise.all over the full
  // list because a principal with 50 agents would burst 50 concurrent
  // connections at the API on every page render.
  const queue = agentList.agents.slice();
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const agent = queue.shift();
      if (!agent) return;
      try {
        const policies = await listPolicies(agent.agentId);
        for (const p of policies) aggregated.push({ agent, policy: p });
      } catch {
        agentsWithErrors += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: FANOUT_CONCURRENCY }, () => worker()));

  // Newest first.
  aggregated.sort(
    (a, b) => new Date(b.policy.createdAt).getTime() - new Date(a.policy.createdAt).getTime(),
  );

  return {
    policies: aggregated,
    agentsScanned: agentList.agents.length,
    agentsTotal: agentList.total,
    agentsWithErrors,
  };
}

export default async function PoliciesPage() {
  const data = await fetchAggregatedPolicies();

  return (
    <section className="aegis-page">
      <header className="aegis-page-header">
        <h1>Policies</h1>
        <p className="muted">
          Scoped, time-bounded permissions. Each row is an AEGIS-signed JWT issued to a specific
          agent. Revoking propagates to the verify hot path within seconds.
        </p>
      </header>

      {!authConfigured() ? (
        <div className="data-empty">
          <p>Set <code>AEGIS_DASHBOARD_API_KEY</code> to populate this view.</p>
        </div>
      ) : 'error' in data ? (
        <div className="data-empty error" role="alert">
          <p>
            <strong>{data.error.code}</strong> — {data.error.message}
          </p>
        </div>
      ) : (
        <>
          <dl className="metric-strip" aria-label="Policies summary">
            <Metric label="policies" value={String(data.policies.length)} />
            <Metric
              label="active"
              value={String(data.policies.filter((p) => p.policy.status === 'active').length)}
              tone="ok"
            />
            <Metric
              label="revoked"
              value={String(data.policies.filter((p) => p.policy.status === 'revoked').length)}
              tone="muted"
            />
            <Metric
              label="expired"
              value={String(data.policies.filter((p) => p.policy.status === 'expired').length)}
              tone="warn"
            />
            <Metric
              label="agents scanned"
              value={`${data.agentsScanned} / ${data.agentsTotal}`}
              tone={data.agentsTotal > MAX_AGENT_FANOUT ? 'warn' : 'muted'}
            />
          </dl>

          {data.agentsWithErrors > 0 ? (
            <p className="form-warning" role="status">
              {data.agentsWithErrors} agent(s) failed to return policies — partial view.
            </p>
          ) : null}
          {data.agentsTotal > MAX_AGENT_FANOUT ? (
            <p className="form-warning" role="status">
              You have {data.agentsTotal} agents — only the most recent {MAX_AGENT_FANOUT} are
              scanned for policies on this page.
            </p>
          ) : null}

          {data.policies.length === 0 ? (
            <div className="data-empty">
              <p>No policies issued.</p>
              <pre className="hint">{`# from your terminal:
aegis policy create --agent agt_… --scope commerce.purchase --max 100USD --ttl 24h`}</pre>
            </div>
          ) : (
            <div className="table-scroll">
            <table className="data-table dense" aria-label="Active policies">
              <thead>
                <tr>
                  <th>policy id</th>
                  <th>agent</th>
                  <th>label</th>
                  <th>status</th>
                  <th>scopes</th>
                  <th>expires</th>
                  <th>created</th>
                </tr>
              </thead>
              <tbody>
                {data.policies.map(({ agent, policy }) => (
                  <tr key={policy.policyId}>
                    <td className="mono">{shortId(policy.policyId, 8, 4)}</td>
                    <td className="mono">
                      <a href={`/agents/${encodeURIComponent(agent.agentId)}`}>
                        {shortId(agent.agentId, 6, 4)}
                      </a>
                    </td>
                    <td className="dim">{policy.label ?? '–'}</td>
                    <td>
                      <span className={`badge badge-${statusTone(policy.status)}`}>{policy.status}</span>
                    </td>
                    <td className="num">{policy.scopes.length}</td>
                    <td className="dim">{relativeTime(policy.expiresAt)}</td>
                    <td className="dim">{relativeTime(policy.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </>
      )}
    </section>
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
