'use client';

import { useEffect, useState, useTransition } from 'react';

import { CopyButton } from '../../../components/CopyButton';
import { useToast } from '../../../components/ToastProvider';
import { registerAgentAction, type RegisterAgentResult } from '../actions';

const RUNTIMES = ['ANTHROPIC', 'OPENAI', 'GOOGLE', 'HUGGINGFACE', 'CUSTOM'] as const;

export function RegisterAgentForm() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<RegisterAgentResult | null>(null);
  const toast = useToast();

  // ?action=register from the command palette opens the form directly.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('action') === 'register') setOpen(true);
  }, []);

  function onSubmit(form: FormData): void {
    setError(null);
    startTransition(async () => {
      const res = await registerAgentAction(form);
      if (!res.ok) {
        setError(res.error?.message ?? 'Registration failed.');
        toast.push({
          title: 'Registration failed',
          body: res.error?.message ?? 'Unknown error.',
          tone: 'crit',
          ttl: 6_000,
        });
        return;
      }
      setCreated(res.data ?? null);
      toast.push({
        title: 'Agent registered',
        body: 'Public key bound. Run handshake to lift trust to ≥600.',
        tone: 'ok',
      });
    });
  }

  function reset(): void {
    setOpen(false);
    setCreated(null);
    setError(null);
  }

  if (!open) {
    return (
      <button type="button" className="okoro-button" onClick={() => { setOpen(true); }}>
        + register agent
      </button>
    );
  }

  if (created) {
    return (
      <div className="okoro-panel" role="status" aria-live="polite">
        <h2 className="okoro-panel-title">Agent registered</h2>
        <p className="muted">
          The agent's public key has been associated with this principal. The Ed25519 private
          key remains client-side — OKORO never receives it (CLAUDE.md invariant 1).
        </p>
        <dl className="kv">
          <dt>agent id</dt>
          <dd className="mono">
            {created.agentId} <CopyButton value={created.agentId} label="agent id" />
          </dd>
          <dt>public key</dt>
          <dd className="mono break">
            {created.publicKey} <CopyButton value={created.publicKey} label="public key" />
          </dd>
        </dl>
        <div className="form-actions">
          <a className="okoro-button-ghost" href={`/agents/${encodeURIComponent(created.agentId)}`}>
            open detail →
          </a>
          <button type="button" className="okoro-button" onClick={reset}>
            done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="okoro-panel" action={onSubmit}>
      <h2 className="okoro-panel-title">Register a new agent</h2>
      <p className="muted">
        Provide an Ed25519 public key (base64url). Generate one locally with{' '}
        <code>okoro agents register --generate-keypair</code> or via{' '}
        <code>generateKeypair()</code> from <code>@okoro/sdk</code>.
      </p>

      <label className="field">
        <span>public key (base64url)</span>
        <input
          name="publicKey"
          required
          minLength={20}
          maxLength={200}
          spellCheck={false}
          autoComplete="off"
          placeholder="MCowBQYDK2VwAyEA…"
          className="mono"
        />
      </label>

      <label className="field">
        <span>runtime</span>
        <select name="runtime" required defaultValue="ANTHROPIC">
          {RUNTIMES.map((r) => (
            <option key={r} value={r}>
              {r.toLowerCase()}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>model (optional)</span>
        <input name="model" maxLength={120} placeholder="claude-sonnet-4-5" autoComplete="off" />
      </label>

      <label className="field">
        <span>label (optional)</span>
        <input name="label" maxLength={200} placeholder="shopper for alice@example.com" autoComplete="off" />
      </label>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <div className="form-actions">
        <button type="button" className="okoro-button-ghost" onClick={() => { setOpen(false); }} disabled={pending}>
          cancel
        </button>
        <button type="submit" className="okoro-button" disabled={pending}>
          {pending ? 'registering…' : 'register'}
        </button>
      </div>
    </form>
  );
}
