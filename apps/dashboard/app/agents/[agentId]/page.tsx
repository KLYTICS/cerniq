// Single agent detail — combines /v1/agents/:id, /v1/agents/:id/policies and
// the most recent audit slice into one Bloomberg-density inspector.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CopyButton, Copyable } from '../../../components/CopyButton';
import { HandshakePanel } from '../../../components/HandshakePanel';
import { StatusDot } from '../../../components/StatusDot';
import {
  AegisApiError,
  getAgent,
  getHandshakeStatus,
  listAudit,
  listPolicies,
  type AgentRow,
  type AuditPage,
  type HandshakeStatus,
  type PolicyRow,
} from '../../../lib/api-client';
import { relativeTime, statusTone, trustBandTone } from '../../../lib/format';

export const metadata: Metadata = {
  title: 'Agent · AEGIS',
};

interface PageProps {
  params: Promise<{ agentId: string }>;
}

interface DetailBundle {
  agent: AgentRow;
  policies: PolicyRow[];
  audit: AuditPage;
  handshake: HandshakeStatus | null;
  policyError?: string;
  auditError?: string;
  handshakeError?: string;
}

async function loadDetail(agentId: string): Promise<DetailBundle | { notFound: true } | { error: string }> {
  let agent: AgentRow;
  try {
    agent = await getAgent(agentId);
  } catch (err) {
    if (err instanceof AegisApiError && (err.code === 'AGENT_NOT_FOUND' || err.status === 404)) {
      return { notFound: true };
    }
    if (err instanceof AegisApiError) return { error: `${err.code}: ${err.message}` };
    return { error: 'Unexpected error loading agent.' };
  }

  // Side panels are best-effort — the main agent record is the source of truth.
  const [policiesSettled, auditSettled, handshakeSettled] = await Promise.allSettled([
    listPolicies(agentId),
    listAudit(agentId, { limit: 25 }),
    getHandshakeStatus(agentId),
  ]);

  const bundle: DetailBundle = {
    agent,
    policies: policiesSettled.status === 'fulfilled' ? policiesSettled.value : [],
    audit:
      auditSettled.status === 'fulfilled'
        ? auditSettled.value
        : { events: [], nextCursor: null },
    handshake: handshakeSettled.status === 'fulfilled' ? handshakeSettled.value : null,
  };
  if (policiesSettled.status === 'rejected') {
    bundle.policyError =
      policiesSettled.reason instanceof AegisApiError
        ? `${policiesSettled.reason.code}: ${policiesSettled.reason.message}`
        : 'Failed to load policies.';
  }
  if (auditSettled.status === 'rejected') {
    bundle.auditError =
      auditSettled.reason instanceof AegisApiError
        ? `${auditSettled.reason.code}: ${auditSettled.reason.message}`
        : 'Failed to load audit.';
  }
  if (handshakeSettled.status === 'rejected') {
    bundle.handshakeError =
      handshakeSettled.reason instanceof AegisApiError
        ? `${handshakeSettled.reason.code}: ${handshakeSettled.reason.message}`
        : 'Failed to load handshake status.';
  }
  return bundle;
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { agentId } = await params;
  const detail = await loadDetail(agentId);

  if ('notFound' in detail) notFound();
  if ('error' in detail) {
    return (
      <section className="aegis-page">
        <header className="aegis-page-header">
          <h1>Agent</h1>
          <p className="muted">{agentId}</p>
        </header>
        <div className="data-empty error" role="alert">
          <p>{detail.error}</p>
        </div>
      </section>
    );
  }

  const { agent, policies, audit, handshake, policyError, auditError } = detail;
  const apiBaseUrl = process.env.AEGIS_API_BASE_URL ?? 'http://localhost:4000';

  return (
    <section className="aegis-page">
      <header className="aegis-page-header">
        <div className="aegis-page-header-row">
          <div>
            <h1 className="mono">
              <Copyable value={agent.agentId} label="agent id">
                {agent.agentId}
              </Copyable>
            </h1>
            <p className="muted">
              {agent.label ?? <em>no label</em>} · {agent.runtime.toLowerCase()}
              {agent.model ? ` · ${agent.model}` : ''}
            </p>
          </div>
          <a href="/agents" className="aegis-button-ghost">
            ← all agents
          </a>
        </div>
      </header>

      <dl className="metric-strip" aria-label="Agent vitals">
        <Metric
          label="status"
          value={agent.status.toLowerCase()}
          tone={statusTone(agent.status)}
          dotStatus={agent.status}
        />
        <Metric label="trust" value={String(agent.trustScore)} />
        <Metric label="band" value={agent.trustBand} tone={trustBandTone(agent.trustBand)} />
        <Metric label="last seen" value={relativeTime(agent.lastSeenAt)} />
        <Metric label="registered" value={relativeTime(agent.registeredAt)} />
      </dl>

      <h2>
        Public key <CopyButton value={agent.publicKey} label="public key" />
      </h2>
      <pre className="codeblock">{agent.publicKey}</pre>

      <HandshakePanel agentId={agent.agentId} status={handshake} apiBaseUrl={apiBaseUrl} />

      <h2>Active policies ({policies.length})</h2>
      {policyError ? (
        <p className="form-error" role="alert">
          {policyError}
        </p>
      ) : policies.length === 0 ? (
        <p className="muted">No policies issued for this agent yet.</p>
      ) : (
        <div className="table-scroll">
        <table className="data-table dense">
          <thead>
            <tr>
              <th>policy id</th>
              <th>label</th>
              <th>status</th>
              <th>scopes</th>
              <th>expires</th>
              <th>created</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.policyId}>
                <td className="mono">
                  <Copyable value={p.policyId} label="policy id">{p.policyId}</Copyable>
                </td>
                <td className="dim">{p.label ?? '–'}</td>
                <td>
                  <StatusDot
                    status={p.status}
                    label={<span className={`badge badge-${statusTone(p.status)}`}>{p.status}</span>}
                  />
                </td>
                <td className="num">{p.scopes.length}</td>
                <td className="dim">{relativeTime(p.expiresAt)}</td>
                <td className="dim">{relativeTime(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <h2>Recent audit ({audit.events.length})</h2>
      {auditError ? (
        <p className="form-error" role="alert">
          {auditError}
        </p>
      ) : audit.events.length === 0 ? (
        <p className="muted">No verify decisions recorded for this agent.</p>
      ) : (
        <div className="table-scroll">
        <table className="data-table dense">
          <thead>
            <tr>
              <th>when</th>
              <th>decision</th>
              <th>reason</th>
              <th>policy</th>
              <th className="num">amount</th>
              <th>domain</th>
            </tr>
          </thead>
          <tbody>
            {audit.events.map((e) => (
              <tr key={e.id}>
                <td className="dim">{relativeTime(e.timestamp)}</td>
                <td>
                  <span className={`badge badge-${decisionTone(e.decision)}`}>{e.decision}</span>
                </td>
                <td className="mono dim">{e.decisionReason ?? '–'}</td>
                <td className="mono dim">{e.policyId ?? '–'}</td>
                <td className="num mono">
                  {e.amount !== null && e.amount !== undefined ? `${e.amount} ${e.currency ?? ''}` : '–'}
                </td>
                <td className="dim">{e.domain ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
  dotStatus,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'crit' | 'muted';
  dotStatus?: string;
}) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>
        {dotStatus ? <StatusDot status={dotStatus} label={value} /> : value}
      </dd>
    </div>
  );
}

function decisionTone(decision: string): 'ok' | 'warn' | 'crit' | 'muted' {
  if (decision === 'approved') return 'ok';
  if (decision === 'denied') return 'crit';
  if (decision === 'flagged') return 'warn';
  return 'muted';
}
