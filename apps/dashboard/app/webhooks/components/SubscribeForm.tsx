'use client';

import { useState, useTransition } from 'react';
import { subscribeWebhook, type SubscribeOutcome } from './actions';

const DEFAULT_EVENTS = [
  'aegis.agent.trust_score_changed',
  'aegis.agent.revoked',
  'aegis.policy.expired',
  'aegis.anomaly.detected',
];

export function SubscribeForm() {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<SubscribeOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(form: HTMLFormElement): void {
    const data = new FormData(form);
    setOutcome(null);
    startTransition(async () => {
      const result = await subscribeWebhook(data);
      setOutcome(result);
      if (result.ok) form.reset();
    });
  }

  if (!open) {
    return (
      <button type="button" className="aegis-button" onClick={() => setOpen(true)}>
        Subscribe a URL
      </button>
    );
  }

  return (
    <div className="aegis-panel" role="dialog" aria-label="Subscribe webhook">
      <p className="aegis-panel-title">New webhook subscription</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(e.currentTarget);
        }}
      >
        <label className="field">
          <span>URL (HTTPS)</span>
          <input
            name="url"
            type="url"
            required
            placeholder="https://api.example.com/webhooks/aegis"
            disabled={pending}
          />
        </label>
        <label className="field">
          <span>events (comma- or space-separated; or "*")</span>
          <input
            name="events"
            type="text"
            required
            defaultValue={DEFAULT_EVENTS.join(', ')}
            disabled={pending}
          />
        </label>

        {outcome && !outcome.ok ? (
          <p className="form-error" role="alert">
            {outcome.error}
          </p>
        ) : null}
        {outcome && outcome.ok ? (
          <div role="status">
            <p className="form-warning">
              Saved. <strong>Copy the secret below now</strong> — it is shown
              once and never recoverable.
            </p>
            <pre className="codeblock" aria-label="Webhook secret">
              {outcome.secret}
            </pre>
            <p className="muted">
              ID: <code>{outcome.id}</code>
            </p>
          </div>
        ) : null}

        <div className="form-actions">
          <button
            type="button"
            className="aegis-button-ghost"
            onClick={() => {
              setOpen(false);
              setOutcome(null);
            }}
            disabled={pending}
          >
            Close
          </button>
          <button type="submit" className="aegis-button" disabled={pending}>
            {pending ? 'Subscribing…' : 'Subscribe'}
          </button>
        </div>
      </form>
    </div>
  );
}
