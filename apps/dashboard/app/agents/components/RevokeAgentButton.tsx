'use client';

import { useState, useTransition } from 'react';

import { useToast } from '../../../components/ToastProvider';
import { shortId } from '../../../lib/format';
import { revokeAgentAction } from '../actions';

interface Props {
  agentId: string;
}

export function RevokeAgentButton({ agentId }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const toast = useToast();

  function onClick(): void {
    if (!confirmed) {
      setConfirmed(true);
      // Auto-reset after 4s so a stray click doesn't leave the row armed.
      setTimeout(() => { setConfirmed(false); }, 4_000);
      return;
    }
    startTransition(async () => {
      const result = await revokeAgentAction(agentId);
      if (result.ok) {
        toast.push({
          title: 'Agent revoked',
          body: `${shortId(agentId, 6, 4)} — verify hot-path will stop accepting within seconds.`,
          tone: 'ok',
        });
      } else {
        toast.push({
          title: 'Revoke failed',
          body: result.error?.message ?? 'Unknown error.',
          tone: 'crit',
          ttl: 6_000,
        });
      }
      setConfirmed(false);
    });
  }

  return (
    <span className="row-action-cluster">
      <button
        type="button"
        className={`mini-btn ${confirmed ? 'mini-btn-danger' : ''}`}
        onClick={onClick}
        disabled={pending}
        aria-label={confirmed ? `Confirm revoke ${agentId}` : `Revoke ${agentId}`}
      >
        {pending ? '…' : confirmed ? 'confirm?' : 'revoke'}
      </button>
    </span>
  );
}
