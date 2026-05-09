'use client';

import { useState, useTransition } from 'react';
import { unsubscribeWebhook } from './actions';

export function UnsubscribeButton({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick(): void {
    if (!confirm(`Unsubscribe webhook ${id}? In-flight deliveries may still arrive briefly.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await unsubscribeWebhook(id);
      if (!result.ok) setError(result.error ?? 'Unsubscribe failed.');
    });
  }

  return (
    <span className="row-action-cluster">
      <button type="button" className="mini-btn mini-btn-danger" disabled={pending} onClick={onClick}>
        {pending ? 'Removing…' : 'Unsubscribe'}
      </button>
      {error ? <span className="row-action-error">{error}</span> : null}
    </span>
  );
}
