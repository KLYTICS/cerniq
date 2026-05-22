// Webhooks — registered subscriptions for the calling principal. Each
// subscription receives HMAC-signed deliveries on band-change, anomaly,
// and (post-G-3 sweep) policy.expired events.

import type { Metadata } from 'next';

import {
  OkoroApiError,
  OkoroAuthMissingError,
  listWebhooks,
  type WebhookSubscriptionRow,
} from '../../lib/api-client';
import { authConfigured } from '../../lib/auth';
import { fmtNum } from '../../lib/format';

import { SubscribeForm } from './components/SubscribeForm';
import { UnsubscribeButton } from './components/UnsubscribeButton';

export const metadata: Metadata = {
  title: 'Webhooks · OKORO',
};

interface Outcome {
  rows?: WebhookSubscriptionRow[];
  error?: { code: string; message: string };
}

async function safeListWebhooks(): Promise<Outcome> {
  try {
    return { rows: await listWebhooks() };
  } catch (err) {
    if (err instanceof OkoroAuthMissingError) {
      return { error: { code: err.code, message: 'Set OKORO_DASHBOARD_API_KEY to populate this view.' } };
    }
    if (err instanceof OkoroApiError) {
      return { error: { code: err.code, message: err.message } };
    }
    return { error: { code: 'UNKNOWN', message: 'Unexpected error contacting OKORO API.' } };
  }
}

export default async function WebhooksPage() {
  const outcome = await safeListWebhooks();

  return (
    <section className="okoro-page">
      <header className="okoro-page-header">
        <div className="okoro-page-header-row">
          <div>
            <h1>Webhooks</h1>
            <p className="muted">
              HTTPS callback URLs that receive OKORO events (
              <code>okoro.agent.trust_score_changed</code>,{' '}
              <code>okoro.agent.revoked</code>, <code>okoro.policy.expired</code>,{' '}
              <code>okoro.anomaly.detected</code>). Each delivery is signed with
              HMAC-SHA256 — verify <code>X-Okoro-Signature</code> on every inbound
              request.
            </p>
          </div>
          {authConfigured() ? <SubscribeForm /> : null}
        </div>
      </header>

      {!authConfigured() ? (
        <div className="data-empty">
          <p>
            Set <code>OKORO_DASHBOARD_API_KEY</code> to populate this view.
          </p>
        </div>
      ) : outcome.error ? (
        <div className="data-empty error" role="alert">
          <p>
            <strong>{outcome.error.code}</strong> — {outcome.error.message}
          </p>
        </div>
      ) : outcome.rows ? (
        <Body rows={outcome.rows} />
      ) : null}
    </section>
  );
}

function Body({ rows }: { rows: WebhookSubscriptionRow[] }) {
  const active = rows.filter((r) => r.active).length;
  return (
    <>
      <dl className="metric-strip" aria-label="Webhook summary">
        <Metric label="subscriptions" value={fmtNum(rows.length)} />
        <Metric label="active" value={fmtNum(active)} tone={active < rows.length ? 'warn' : 'ok'} />
        <Metric
          label="paused"
          value={fmtNum(rows.length - active)}
          tone={rows.length - active > 0 ? 'warn' : 'muted'}
        />
        <Metric
          label="event types subscribed"
          value={fmtNum(uniqueEventCount(rows))}
        />
        <Metric label="—" value="—" tone="muted" />
      </dl>

      {rows.length === 0 ? (
        <div className="data-empty">
          <p>No webhook subscriptions registered.</p>
          <span className="hint">
            Subscribe a URL above. OKORO sends an HMAC-signed POST on every matching event;
            verify the <code>X-Okoro-Signature</code> header against the secret returned at
            subscription time.
          </span>
        </div>
      ) : (
        <table className="data-table dense" aria-label="Webhook subscriptions">
          <thead>
            <tr>
              <th>id</th>
              <th>url</th>
              <th>events</th>
              <th>state</th>
              <th className="row-actions">actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono dim">{r.id}</td>
                <td className="mono break">{r.url}</td>
                <td className="mono">
                  {r.events.length === 0 ? <span className="dim">—</span> : r.events.join(', ')}
                </td>
                <td>
                  <span className={`badge badge-${r.active ? 'ok' : 'warn'}`}>
                    {r.active ? 'active' : 'paused'}
                  </span>
                </td>
                <td className="row-actions">
                  <UnsubscribeButton id={r.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function uniqueEventCount(rows: WebhookSubscriptionRow[]): number {
  const set = new Set<string>();
  for (const r of rows) {
    for (const e of r.events) set.add(e);
  }
  return set.size;
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
