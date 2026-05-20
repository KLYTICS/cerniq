// Agents — registered identities owned by the calling principal. Bloomberg-
// density layout, server-rendered, no fabricated data on error.

import type { Metadata } from 'next';

import {
  AegisApiError,
  AegisAuthMissingError,
  listAgents,
  type AgentListParams,
  type AgentListResult,
} from '../../lib/api-client';
import { authConfigured } from '../../lib/auth';
import { loadPlan } from '../../lib/billing';
import { TrialCliffBanner } from '../billing/_components/TrialCliffBanner';
import { AgentMetricStrip } from './components/AgentMetricStrip';
import { AgentTable } from './components/AgentTable';
import { RegisterAgentForm } from './components/RegisterAgentForm';

export const metadata: Metadata = {
  title: 'Agents · AEGIS',
};

interface PageProps {
  searchParams: Promise<{ status?: string; runtime?: string; search?: string; cursor?: string }>;
}

interface FetchOutcome {
  result?: AgentListResult;
  error?: { code: string; message: string };
}

async function safeListAgents(params: AgentListParams): Promise<FetchOutcome> {
  try {
    return { result: await listAgents(params) };
  } catch (err) {
    if (err instanceof AegisAuthMissingError) {
      return { error: { code: err.code, message: 'Set AEGIS_DASHBOARD_API_KEY to populate this view.' } };
    }
    if (err instanceof AegisApiError) {
      return { error: { code: err.code, message: err.message } };
    }
    return { error: { code: 'UNKNOWN', message: 'Unexpected error contacting AEGIS API.' } };
  }
}

export default async function AgentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter: AgentListParams = {
    ...(params.status ? { status: params.status as AgentListParams['status'] } : {}),
    ...(params.runtime ? { runtime: params.runtime } : {}),
    ...(params.search ? { search: params.search } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
    limit: 50,
  };

  // Trial-cliff banner is best-effort: a plan-fetch failure must not block
  // the agents view (per dashboard CLAUDE.md "honest error states"). Render
  // the banner only when the plan loads cleanly.
  const [outcome, planLoad] = await Promise.all([
    safeListAgents(filter),
    loadPlan(),
  ]);

  return (
    <section className="aegis-page">
      <header className="aegis-page-header">
        <div className="aegis-page-header-row">
          <div>
            <h1>Agents</h1>
            <p className="muted">
              Cryptographic identities registered to your principal. AEGIS holds public keys
              only — private keys never leave the SDK (CLAUDE.md invariant 1).
            </p>
          </div>
          {authConfigured() ? <RegisterAgentForm /> : null}
        </div>
      </header>

      {planLoad.ok ? <TrialCliffBanner plan={planLoad.plan} compact /> : null}

      {outcome.error ? (
        <div className="data-empty error" role="alert">
          <p>
            <strong>{outcome.error.code}</strong> — {outcome.error.message}
          </p>
        </div>
      ) : outcome.result ? (
        <>
          <AgentMetricStrip agents={outcome.result.agents} total={outcome.result.total} />

          <FilterBar current={params} />

          <AgentTable agents={outcome.result.agents} />

          {outcome.result.nextCursor ? (
            <nav className="pagination" aria-label="Pagination">
              <a href={pageUrl({ ...params, cursor: outcome.result.nextCursor })}>next page →</a>
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function FilterBar({ current }: { current: { status?: string; runtime?: string; search?: string } }) {
  const statusOptions = ['', 'ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'REVOKED'];
  const runtimeOptions = ['', 'ANTHROPIC', 'OPENAI', 'GOOGLE', 'HUGGINGFACE', 'CUSTOM'];
  return (
    <form className="filter-bar" method="get">
      <label>
        <span>status</span>
        <select name="status" defaultValue={current.status ?? ''}>
          {statusOptions.map((s) => (
            <option key={s || 'any'} value={s}>
              {s ? s.toLowerCase() : 'any'}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>runtime</span>
        <select name="runtime" defaultValue={current.runtime ?? ''}>
          {runtimeOptions.map((r) => (
            <option key={r || 'any'} value={r}>
              {r ? r.toLowerCase() : 'any'}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>search</span>
        <input name="search" defaultValue={current.search ?? ''} placeholder="id, label, model…" />
      </label>
      <button type="submit" className="aegis-button-ghost">
        apply
      </button>
    </form>
  );
}

function pageUrl(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `/agents?${qs}` : '/agents';
}
